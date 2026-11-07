/**
 * @file PerfOverlay - 管理后台性能自检浮层（V4.10.0）
 * @description
 *  仅挂载于管理后台，用于在真实审核环境中复测流畅度：
 *    - 当前 FPS 与近 5 秒最低 FPS（requestAnimationFrame 采样）
 *    - 近 30 秒长任务数量与最长耗时（PerformanceObserver longtask）
 *    - 审核详情页「详情加载 → 图片可见」耗时（自定义 performance mark）
 *    - 页面 domInteractive（Navigation Timing）
 *  默认收起，展开状态记录在 localStorage；不引入任何第三方依赖。
 */
import { useEffect, useState } from 'react';
import { Activity, Copy, ChevronDown, ChevronUp } from 'lucide-react';

interface PerfMetrics {
  fps: number;
  minFps: number;
  longTasks: number;
  maxLongTask: number;
  detailToImageMs: number | null;
  domInteractiveMs: number | null;
}

const EMPTY_METRICS: PerfMetrics = {
  fps: 0,
  minFps: 0,
  longTasks: 0,
  maxLongTask: 0,
  detailToImageMs: null,
  domInteractiveMs: null,
};

const STORAGE_KEY = 'admin_perf_overlay';

export function PerfOverlay() {
  const [open, setOpen] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
  const [metrics, setMetrics] = useState<PerfMetrics>(EMPTY_METRICS);
  const [copied, setCopied] = useState(false);

  // FPS 采样：每秒统计一次帧数，保留近 5 秒最低值
  useEffect(() => {
    if (!open) return;
    let rafId = 0;
    let frames = 0;
    let lastTick = performance.now();
    const samples: number[] = [];

    const tick = (now: number) => {
      frames++;
      const elapsed = now - lastTick;
      if (elapsed >= 1000) {
        const fps = Math.round((frames * 1000) / elapsed);
        frames = 0;
        lastTick = now;
        samples.push(fps);
        if (samples.length > 5) samples.shift();
        setMetrics((prev) => ({ ...prev, fps, minFps: Math.min(...samples) }));
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  // 长任务统计：保留近 30 秒的 longtask 记录
  useEffect(() => {
    if (!open || typeof PerformanceObserver === 'undefined') return;

    const records: Array<{ start: number; duration: number }> = [];
    let observer: PerformanceObserver | null = null;

    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          records.push({ start: entry.startTime, duration: entry.duration });
        }
        const cutoff = performance.now() - 30000;
        const recent = records.filter((r) => r.start >= cutoff);
        // 清理 1 分钟前的旧记录，避免数组无限增长
        while (records.length > 0 && records[0].start < performance.now() - 60000) {
          records.shift();
        }
        setMetrics((prev) => ({
          ...prev,
          longTasks: recent.length,
          maxLongTask: Math.round(recent.reduce((max, r) => Math.max(max, r.duration), 0)),
        }));
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // 浏览器不支持 longtask 时静默降级
    }

    return () => observer?.disconnect();
  }, [open]);

  // 读取审核详情页埋点与导航计时（每秒刷新一次）
  useEffect(() => {
    if (!open) return;

    const refresh = () => {
      const detailMark = performance.getEntriesByName('photo-detail:detail-loaded', 'mark').pop();
      const imageMark = performance.getEntriesByName('photo-detail:image-loaded', 'mark').pop();
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

      setMetrics((prev) => ({
        ...prev,
        detailToImageMs:
          detailMark && imageMark && imageMark.startTime >= detailMark.startTime
            ? Math.round(imageMark.startTime - detailMark.startTime)
            : null,
        domInteractiveMs: nav ? Math.round(nav.domInteractive) : null,
      }));
    };

    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [open]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  /** 复制诊断摘要，便于审核员直接反馈 */
  const copySummary = async () => {
    const text = [
      '审核后台性能诊断',
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `当前 FPS：${metrics.fps}`,
      `近 5 秒最低 FPS：${metrics.minFps}`,
      `近 30 秒长任务：${metrics.longTasks} 个，最长 ${metrics.maxLongTask} ms`,
      `详情加载 → 图片可见：${metrics.detailToImageMs ?? '—'} ms`,
      `页面 domInteractive：${metrics.domInteractiveMs ?? '—'} ms`,
      `UA：${navigator.userAgent}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时退化为控制台输出
      console.info(text);
    }
  };

  const fpsColor =
    metrics.fps >= 50 ? 'text-green-700' : metrics.fps >= 30 ? 'text-yellow-700' : 'text-red-700';

  return (
    <div className="fixed right-4 bottom-4 z-40">
      {open ? (
        <div className="w-72 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
              <Activity className="w-3.5 h-3.5 text-blue-700" />
              性能自检
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={copySummary}
                title="复制诊断摘要"
                className="p-1 rounded hover:bg-gray-200 text-gray-500"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={toggle}
                title="收起"
                className="p-1 rounded hover:bg-gray-200 text-gray-500"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="px-3 py-2 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">当前 FPS</span>
              <span className={`font-mono font-semibold ${fpsColor}`}>{metrics.fps}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">近 5 秒最低 FPS</span>
              <span className={`font-mono ${metrics.minFps >= 30 ? 'text-gray-700' : 'text-red-700'}`}>
                {metrics.minFps}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">近 30 秒长任务</span>
              <span className="font-mono text-gray-700">
                {metrics.longTasks} 个 / 最长 {metrics.maxLongTask}ms
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">详情 → 图片可见</span>
              <span className="font-mono text-gray-700">
                {metrics.detailToImageMs === null ? '—' : `${metrics.detailToImageMs}ms`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">domInteractive</span>
              <span className="font-mono text-gray-700">
                {metrics.domInteractiveMs === null ? '—' : `${metrics.domInteractiveMs}ms`}
              </span>
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-gray-400">
              达标：平均 FPS ≥ 50、最低 ≥ 30；开图长任务 ≤ 2 个且最长 ≤ 200ms
            </p>
            {copied && <p className="text-[11px] text-green-700">诊断摘要已复制</p>}
          </div>
        </div>
      ) : (
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-full shadow-md text-xs font-medium text-gray-600 hover:text-blue-700 hover:border-blue-300 transition-colors"
          title="展开性能自检"
        >
          <Activity className="w-3.5 h-3.5" />
          性能
          <ChevronUp className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
