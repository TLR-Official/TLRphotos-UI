/**
 * @file metricsService.ts（V4.9.0）
 * @description 核心链路实时指标与多级告警：
 *  - 注册/图片上传的尝试、成功、失败（4xx 归为客户端错误，不计入成功率分母）与延迟分位；
 *  - CPU 使用率（进程差分）、系统负载、RSS 占用率；
 *  - 5 分钟滑动窗口统计，采样周期 30s；
 *  - 阈值评估（warn / critical），可选 webhook 告警（ALERT_WEBHOOK_URL，10 分钟去抖）。
 *  指标只存于进程内存，重启清零；用于峰值期的快速观测与告警，不做长期留存。
 */
import os from 'os';

/** 指标通道 */
export type MetricChannel = 'register' | 'upload';

/** 滑动窗口长度：5 分钟 */
const WINDOW_MS = 5 * 60 * 1000;
/** 单桶延迟样本上限，避免峰值期内存膨胀 */
const MAX_LATENCY_SAMPLES_PER_BUCKET = 200;
/** 成功率评估的最小样本量，避免启动初期小样本误报 */
const MIN_SAMPLES_FOR_RATE = 20;
/** 指标采样周期 30s */
const SAMPLE_INTERVAL_MS = 30_000;
/** 同一告警 key 的 webhook 去抖间隔 10 分钟 */
const ALERT_DEBOUNCE_MS = 10 * 60 * 1000;

interface MinuteBucket {
  minute: number;
  success: number;
  clientError: number;
  failure: number;
  latencies: number[];
}

type ChannelBuckets = Map<number, MinuteBucket>;

const buckets: Record<MetricChannel, ChannelBuckets> = {
  register: new Map(),
  upload: new Map(),
};

/** CPU 采样状态（进程级差分） */
let lastCpuUsage = process.cpuUsage();
let lastCpuSampledAt = Date.now();
let latestCpuPercent = 0;

/** 告警 webhook 去抖表 */
const alertSentAt = new Map<string, number>();
/** 上一轮处于告警状态的 key，用于恢复通知 */
const activeAlertKeys = new Set<string>();

let monitorTimer: NodeJS.Timeout | null = null;

/** 取当前分钟桶（并清理窗口外桶） */
function currentBucket(channel: MetricChannel, now: number): MinuteBucket {
  const map = buckets[channel];
  const minute = Math.floor(now / 60_000);
  const cutoff = now - WINDOW_MS;
  for (const [key, bucket] of map) {
    if (key * 60_000 < cutoff) map.delete(key);
  }
  let bucket = map.get(minute);
  if (!bucket) {
    bucket = { minute, success: 0, clientError: 0, failure: 0, latencies: [] };
    map.set(minute, bucket);
  }
  return bucket;
}

/**
 * 记录一次请求结果。
 * @param channel 指标通道
 * @param statusCode HTTP 状态码（2xx/3xx 成功；4xx 客户端错误；其余失败）
 * @param latencyMs 请求耗时（毫秒）
 */
export function recordOutcome(channel: MetricChannel, statusCode: number, latencyMs: number): void {
  const now = Date.now();
  const bucket = currentBucket(channel, now);
  if (statusCode >= 200 && statusCode < 400) {
    bucket.success += 1;
    if (bucket.latencies.length < MAX_LATENCY_SAMPLES_PER_BUCKET) {
      bucket.latencies.push(Math.max(0, Math.round(latencyMs)));
    }
  } else if (statusCode >= 400 && statusCode < 500) {
    bucket.clientError += 1;
  } else {
    bucket.failure += 1;
  }
}

/** 计算分位（输入已排序） */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

interface ChannelSnapshot {
  attempts: number;
  success: number;
  client_error: number;
  failure: number;
  /** 成功率（失败/(成功+失败)）；样本不足或失败数为 0 时为 null */
  success_rate: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

/** 汇总单通道窗口数据 */
function channelSnapshot(channel: MetricChannel, now: number): ChannelSnapshot {
  const map = buckets[channel];
  const cutoff = now - WINDOW_MS;
  let success = 0;
  let clientError = 0;
  let failure = 0;
  const latencies: number[] = [];
  for (const [key, bucket] of map) {
    if (key * 60_000 < cutoff) continue;
    success += bucket.success;
    clientError += bucket.clientError;
    failure += bucket.failure;
    latencies.push(...bucket.latencies);
  }
  const denominator = success + failure;
  const sorted = latencies.sort((a, b) => a - b);
  return {
    attempts: success + clientError + failure,
    success,
    client_error: clientError,
    failure,
    success_rate: denominator >= MIN_SAMPLES_FOR_RATE ? Number((success / denominator).toFixed(4)) : null,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
  };
}

/** 采样进程 CPU 使用率（相对全部核心） */
function sampleCpu(): void {
  const now = Date.now();
  const usage = process.cpuUsage();
  const elapsedMs = now - lastCpuSampledAt;
  if (elapsedMs > 0) {
    const deltaMicros = (usage.user - lastCpuUsage.user) + (usage.system - lastCpuUsage.system);
    const cores = Math.max(1, os.cpus().length);
    latestCpuPercent = Math.min(100, Math.max(0, (deltaMicros / 1000 / elapsedMs / cores) * 100));
  }
  lastCpuUsage = usage;
  lastCpuSampledAt = now;
}

/** 资源快照 */
function resourceSnapshot() {
  const mem = process.memoryUsage();
  const total = os.totalmem();
  const rssPct = total > 0 ? (mem.rss / total) * 100 : 0;
  return {
    cpu_percent: Number(latestCpuPercent.toFixed(1)),
    cpu_count: os.cpus().length,
    load1: Number(os.loadavg()[0].toFixed(2)),
    rss_bytes: mem.rss,
    rss_pct: Number(rssPct.toFixed(1)),
    heap_used_bytes: mem.heapUsed,
    system_total_bytes: total,
    system_free_bytes: os.freemem(),
  };
}

/** 告警项 */
export interface MetricsAlert {
  key: string;
  level: 'warn' | 'critical';
  message: string;
}

/**
 * 评估多级告警阈值。
 * @param channels 预先计算的通道快照（避免重复汇总）
 * @param resources 预先计算的资源快照
 */
function evaluateWith(
  channels: Record<MetricChannel, ChannelSnapshot>,
  resources: ReturnType<typeof resourceSnapshot>
): MetricsAlert[] {
  const alerts: MetricsAlert[] = [];

  const registerRate = channels.register.success_rate;
  if (registerRate !== null) {
    if (registerRate < 0.99) {
      alerts.push({ key: 'register_success_rate', level: 'critical', message: `注册成功率 ${(registerRate * 100).toFixed(2)}%（低于 99%）` });
    } else if (registerRate < 0.999) {
      alerts.push({ key: 'register_success_rate', level: 'warn', message: `注册成功率 ${(registerRate * 100).toFixed(2)}%（目标 ≥99.9%）` });
    }
  }

  const uploadRate = channels.upload.success_rate;
  if (uploadRate !== null) {
    if (uploadRate < 0.98) {
      alerts.push({ key: 'upload_success_rate', level: 'critical', message: `图片上传成功率 ${(uploadRate * 100).toFixed(2)}%（低于 98%）` });
    } else if (uploadRate < 0.995) {
      alerts.push({ key: 'upload_success_rate', level: 'warn', message: `图片上传成功率 ${(uploadRate * 100).toFixed(2)}%（目标 ≥99.5%）` });
    }
  }

  if (resources.cpu_percent >= 90) {
    alerts.push({ key: 'cpu', level: 'critical', message: `服务 CPU 使用率 ${resources.cpu_percent}%（≥90%）` });
  } else if (resources.cpu_percent >= 70) {
    alerts.push({ key: 'cpu', level: 'warn', message: `服务 CPU 使用率 ${resources.cpu_percent}%（≥70%）` });
  }

  if (resources.rss_pct >= 90) {
    alerts.push({ key: 'memory', level: 'critical', message: `服务内存占用 ${resources.rss_pct}%（≥90%）` });
  } else if (resources.rss_pct >= 75) {
    alerts.push({ key: 'memory', level: 'warn', message: `服务内存占用 ${resources.rss_pct}%（≥75%）` });
  }

  return alerts;
}

/** 对外指标快照（含告警评估结果） */
export function takeMetricsSnapshot() {
  const now = Date.now();
  const channels: Record<MetricChannel, ChannelSnapshot> = {
    register: channelSnapshot('register', now),
    upload: channelSnapshot('upload', now),
  };
  const resources = resourceSnapshot();
  const alerts = evaluateWith(channels, resources);
  return {
    window_ms: WINDOW_MS,
    sampled_at: new Date(now).toISOString(),
    register: channels.register,
    upload: channels.upload,
    resources,
    alerts,
    degraded_mode: (process.env.DEGRADED_MODE || '').toLowerCase() === 'on',
  };
}

/** 供管理端健康检查复用的告警列表 */
export function evaluateAlerts(): MetricsAlert[] {
  const now = Date.now();
  const channels: Record<MetricChannel, ChannelSnapshot> = {
    register: channelSnapshot('register', now),
    upload: channelSnapshot('upload', now),
  };
  return evaluateWith(channels, resourceSnapshot());
}

/** 发送 webhook 告警（兼容飞书/企业微信群机器人的 text 字段） */
async function sendWebhook(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    console.warn(`[Metrics] ${text}`);
    return;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.warn('[Metrics] webhook 发送失败:', (error as Error).message);
  }
}

/** 每 30s 采样与评估；告警 10 分钟内同 key 不重复推送，指标恢复时发一次恢复通知 */
function monitorTick(): void {
  sampleCpu();
  const snapshot = takeMetricsSnapshot();
  const now = Date.now();
  const currentKeys = new Set<string>();

  for (const alert of snapshot.alerts) {
    currentKeys.add(alert.key);
    const lastSent = alertSentAt.get(alert.key) ?? 0;
    if (now - lastSent < ALERT_DEBOUNCE_MS) continue;
    alertSentAt.set(alert.key, now);
    void sendWebhook(`[TLRphotos][${alert.level}] ${alert.message}`);
  }

  for (const key of activeAlertKeys) {
    if (!currentKeys.has(key)) {
      void sendWebhook(`[TLRphotos][recovered] 指标恢复正常：${key}`);
    }
  }

  activeAlertKeys.clear();
  for (const key of currentKeys) activeAlertKeys.add(key);
}

/** 启动指标监控（幂等；定时器 unref 不阻塞退出） */
export function startMetricsMonitor(): void {
  if (monitorTimer) return;
  sampleCpu();
  monitorTimer = setInterval(monitorTick, SAMPLE_INTERVAL_MS);
  monitorTimer.unref();
}
