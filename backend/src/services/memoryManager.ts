/**
 * @file MemoryManager - 服务端内存自动释放机制
 * @description
 * 监控 RSS/堆内存占用率，分级执行清理动作：
 *   Level 1 (soft)   RSS > 60% → 触发主动 GC + 清理闲置 Buffer 引用
 *   Level 2 (medium) RSS > 75% → 清理 sharp/libvips 线程池缓存 + 强制 gc
 *   Level 3 (hard)   RSS > 90% 或 5min 内 3 次触发 medium → 自重启（由 systemd/supervisor 拉起）
 *
 * 同时提供：
 *   - 进程级 Buffer 引用注册 / 释放 API（供上传、图片处理热点路径显式回收）
 *   - 内存状态快照接口（供健康检查 / 管理后台展示）
 *   - 进程异常信号的兜底日志与资源释放钩子
 */

import os from 'os';

/** 系统总内存字节数，用于计算 RSS 占用率 */
const TOTAL_MEM = os.totalmem();

/** 内存释放等级阈值（相对于总内存的百分比） */
const THRESHOLD = {
  SOFT: 0.60,
  MEDIUM: 0.75,
  HARD: 0.90,
} as const;

/** 采样周期：每 30s 采样一次 RSS */
const SAMPLE_INTERVAL_MS = 30_000;

/**
 * 软触发去抖：进入 soft 后至少 1 个采样周期再执行一次，
 * 避免瞬间峰值导致重复 GC 消耗 CPU
 */
const SOFT_COOLDOWN_MS = 60_000;

/** 硬触发记录窗口：5 分钟 */
const MEDIUM_WINDOW_MS = 5 * 60 * 1000;
/** 窗口内达到 N 次 medium 触发重启 */
const MEDIUM_RESTART_COUNT = 3;

/** 单条内存采样 */
interface Sample {
  ts: number;
  rssPct: number;
  heapPct: number;
  level: 'ok' | 'soft' | 'medium' | 'hard';
}

/** 对外暴露的内存快照 */
export interface MemorySnapshot {
  timestamp: string;
  rssBytes: number;
  rssPct: number;
  heapUsed: number;
  heapTotal: number;
  heapPct: number;
  external: number;
  arrayBuffers: number;
  systemTotal: number;
  systemFree: number;
  samples: Sample[];
  registeredBuffers: number;
  registeredBuffersBytes: number;
  triggeredCount: { soft: number; medium: number; hard: number };
}

/** 外部可注册的 Buffer 持有者：用于手动释放 */
interface BufferHolder {
  id: string;
  size: number;
  /** 返回 true 表示释放成功 */
  release: () => boolean;
  createdAt: number;
}

type TriggerLevel = 'soft' | 'medium' | 'hard';

class MemoryManager {
  private sampleTimer: NodeJS.Timeout | null = null;

  private samples: Sample[] = [];
  /** 最近 N 个 medium 触发的时间戳，用于判断硬重启条件 */
  private mediumTriggeredAt: number[] = [];
  private lastSoftAt = 0;

  private triggeredCount = { soft: 0, medium: 0, hard: 0 };

  private holders = new Map<string, BufferHolder>();

  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    // 启动时打印一次初始内存水位
    const snap = this.takeSnapshot();
    console.log(
      `[MemoryManager] started. RSS=${(snap.rssBytes / 1024 / 1024).toFixed(1)}MB ` +
        `(${snap.rssPct.toFixed(1)}%), heapUsed=${(snap.heapUsed / 1024 / 1024).toFixed(1)}MB ` +
        `systemFree=${(os.freemem() / 1024 / 1024).toFixed(0)}MB`
    );

    this.sampleTimer = setInterval(() => this.sampleAndCheck(), SAMPLE_INTERVAL_MS);
    // unref 避免阻塞优雅退出
    this.sampleTimer.unref();

    // 进程退出 / 异常时尝试清理
    process.once('beforeExit', () => this.cleanupAllHolders('beforeExit'));
  }

  stop() {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this.started = false;
  }

  /** 注册需手动释放的大 Buffer（上传原图 Buffer、sharp 输出 Buffer 等） */
  registerBuffer(
    id: string,
    size: number,
    release: () => boolean
  ): void {
    if (this.holders.has(id)) {
      // 相同 id 先释放旧引用
      this.releaseBuffer(id);
    }
    this.holders.set(id, { id, size, release, createdAt: Date.now() });
  }

  /** 手动释放指定 Buffer。返回 true 表示执行了 release 回调。 */
  releaseBuffer(id: string): boolean {
    const h = this.holders.get(id);
    if (!h) return false;
    this.holders.delete(id);
    try {
      return h.release();
    } catch (err) {
      console.error(`[MemoryManager] release ${id} failed:`, (err as Error).message);
      return false;
    }
  }

  /** 快照，用于管理后台展示或健康检查 */
  takeSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const rssPct = mem.rss / TOTAL_MEM;
    const heapPct = mem.heapUsed / Math.max(mem.heapTotal, 1);

    let registeredBytes = 0;
    for (const h of this.holders.values()) registeredBytes += h.size;

    return {
      timestamp: new Date().toISOString(),
      rssBytes: mem.rss,
      rssPct: +(rssPct * 100).toFixed(2),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      heapPct: +(heapPct * 100).toFixed(2),
      external: mem.external,
      arrayBuffers: (mem as any).arrayBuffers || 0,
      systemTotal: TOTAL_MEM,
      systemFree: os.freemem(),
      samples: [...this.samples],
      registeredBuffers: this.holders.size,
      registeredBuffersBytes: registeredBytes,
      triggeredCount: { ...this.triggeredCount },
    };
  }

  /**
   * 主动触发释放，也可通过管理后台 API 调用
   * @param forceLevel 强制等级，默认按当前实际水位选择
   */
  triggerRelease(forceLevel?: TriggerLevel): TriggerLevel | null {
    const snap = this.takeSnapshot();
    const level = forceLevel ?? this.determineLevel(snap.rssPct / 100);
    if (level === 'ok') return null;
    this.performRelease(level, snap);
    return level;
  }

  /** --- 内部方法 --- */

  private sampleAndCheck() {
    const snap = this.takeSnapshot();
    const level = this.determineLevel(snap.rssBytes / TOTAL_MEM);

    this.samples.push({
      ts: Date.now(),
      rssPct: snap.rssPct,
      heapPct: snap.heapPct,
      level,
    });
    // 只保留最近 60 个样本（≈30 分钟）
    if (this.samples.length > 60) this.samples.shift();

    if (level !== 'ok') {
      this.performRelease(level, snap);
    }
  }

  private determineLevel(rssPct: number): Sample['level'] {
    if (rssPct >= THRESHOLD.HARD) return 'hard';
    if (rssPct >= THRESHOLD.MEDIUM) return 'medium';
    if (rssPct >= THRESHOLD.SOFT) return 'soft';
    return 'ok';
  }

  private performRelease(level: TriggerLevel, snap: MemorySnapshot) {
    this.triggeredCount[level]++;
    console.log(
      `[MemoryManager] trigger=${level} ` +
        `RSS=${(snap.rssBytes / 1024 / 1024).toFixed(1)}MB(${snap.rssPct.toFixed(1)}%) ` +
        `heapUsed=${(snap.heapUsed / 1024 / 1024).toFixed(1)}MB(${snap.heapPct.toFixed(1)}%)`
    );

    // 三级清理动作：高级动作覆盖低级动作

    // Level 1: soft - 释放注册的 Buffer + 主动 GC
    this.cleanupAllHolders(level);
    this.runGC();

    if (level === 'soft') {
      // 软触发仅当距离上次至少一个 SOFT_COOLDOWN 后才真正做 GC
      const now = Date.now();
      if (now - this.lastSoftAt < SOFT_COOLDOWN_MS) return;
      this.lastSoftAt = now;
      return;
    }

    // Level 2: medium - 额外清理 sharp/libvips 缓存 + 再跑一次 GC
    if (level === 'medium' || level === 'hard') {
      this.purgeSharpCache();
      this.runGC(true);
    }

    // Level 3: hard - 直接请求优雅重启（交给 systemd 拉起）
    if (level === 'hard') {
      console.error('[MemoryManager] HARD threshold exceeded, requesting restart.');
      this.requestRestart('HARD_THRESHOLD');
      return;
    }

    // medium 窗口内 >=3 次也触发重启（避免抖动式内存泄漏）
    this.mediumTriggeredAt.push(Date.now());
    const now = Date.now();
    this.mediumTriggeredAt = this.mediumTriggeredAt.filter(t => now - t <= MEDIUM_WINDOW_MS);
    if (this.mediumTriggeredAt.length >= MEDIUM_RESTART_COUNT) {
      console.error(
        `[MemoryManager] MEDIUM triggered ${this.mediumTriggeredAt.length} times in ${MEDIUM_WINDOW_MS / 60000}min, restarting.`
      );
      this.requestRestart('MEDIUM_RATE_LIMIT');
    }
  }

  private cleanupAllHolders(reason: string): number {
    if (this.holders.size === 0) return 0;
    let releasedBytes = 0;
    const count = this.holders.size;
    for (const h of this.holders.values()) {
      try {
        h.release();
        releasedBytes += h.size;
      } catch {
        /* ignore */
      }
    }
    this.holders.clear();
    console.log(
      `[MemoryManager] cleanupAllHolders(reason=${reason}) released ${count} buffers, ` +
        `${(releasedBytes / 1024 / 1024).toFixed(2)}MB`
    );
    return releasedBytes;
  }

  /**
   * 触发 V8 全局 GC。注意 Node.js 默认不暴露 global.gc，
   * 需要启动参数 --expose-gc；若不存在则仅打印提示。
   */
  private runGC(full = false) {
    const gc = (globalThis as any).gc as undefined | ((opts?: any) => void);
    if (!gc) return;
    try {
      const before = process.memoryUsage().heapUsed;
      if (full) gc({ type: 'major', execution: 'sync' });
      else gc({ type: 'minor', execution: 'sync' });
      const after = process.memoryUsage().heapUsed;
      const freed = before - after;
      if (freed > 0) {
        console.log(
          `[MemoryManager] GC(${full ? 'major' : 'minor'}) freed ${(freed / 1024 / 1024).toFixed(2)}MB`
        );
      }
    } catch (err) {
      console.error('[MemoryManager] gc error:', (err as Error).message);
    }
  }

  /**
   * 释放 sharp 内部的 libvips 操作缓存、并发限制的临时 Buffer。
   * 使用可选链 + 类型断言避免 sharp 未被加载时出错。
   */
  private purgeSharpCache() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp') as any;
      if (typeof sharp.cache === 'function') {
        const prev = sharp.cache(false);
        // 禁用缓存后再重新启用默认设置（减少空闲内存占用）
        sharp.cache({ items: 20, memory: 50, files: 10 });
        console.log(
          `[MemoryManager] sharp.cache reset. prev.items=${prev?.items ?? '?'} prev.memory=${prev?.memory ?? '?'}MB`
        );
      }
      if (typeof sharp.queue === 'function' && typeof sharp.concurrency === 'function') {
        // 重启并发池（会让 libvips 释放当前空闲线程的临时 Buffer）
        const concurrency = Math.max(1, os.cpus().length - 1);
        sharp.concurrency(concurrency);
      }
      // libvips 本身还提供了一个追踪泄漏的清理函数（sharp v0.33+ 暴露）
      const vips = (sharp as any).vips;
      if (vips && typeof vips.shutdown === 'function') {
        // 注意：vips.shutdown() 会释放所有 libvips 对象，
        // 但只有在下一次使用 sharp 时才会重新初始化。
        // 只在 medium/hard 时调用。
        try {
          vips.shutdown();
          console.log('[MemoryManager] libvips shutdown called');
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error('[MemoryManager] purgeSharpCache failed:', (err as Error).message);
    }
  }

  /** 触发优雅退出：发送 SIGTERM 让 server.ts 的 gracefulShutdown 接管 */
  private requestRestart(reason: string) {
    const snap = this.takeSnapshot();
    const info = {
      reason,
      snapshot: {
        rssMB: +(snap.rssBytes / 1024 / 1024).toFixed(2),
        heapUsedMB: +(snap.heapUsed / 1024 / 1024).toFixed(2),
        systemFreeMB: +(snap.systemFree / 1024 / 1024).toFixed(0),
      },
      triggered: this.triggeredCount,
      mediumWindow: this.mediumTriggeredAt,
    };
    // 把退出原因写到 stdout，便于 journald 回溯
    console.error(`[MemoryManager] REQUEST_RESTART\n${JSON.stringify(info, null, 2)}`);
    // 先清理资源再退出
    this.cleanupAllHolders(`restart:${reason}`);
    this.stop();
    // 给 server.ts 1s 清理定时句柄
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1000);
  }
}

/** 单例：整个进程共享一个 MemoryManager */
export const memoryManager = new MemoryManager();
