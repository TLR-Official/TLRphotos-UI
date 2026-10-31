/**
 * @file loadGuard.ts（V4.9.0）
 * @description 单机并发闸门：限制同一高成本接口的在途请求数，保护 2 vCPU / 3.5GB
 *  服务器在高并发下不被 CPU 密集型任务（bcrypt、sharp）或大 Buffer 打满。
 *  超限立即返回 503 + Retry-After，不进入排队（排队只会拉长响应时间并占内存）。
 */
import type { Request, Response, NextFunction } from 'express';

export interface ConcurrencyGateOptions {
  /** 允许同时在途的最大请求数 */
  max: number;
  /** 超限提示语 */
  message?: string;
  /** 机器可识别错误码 */
  code?: string;
  /** 建议重试秒数（Retry-After） */
  retryAfterSeconds?: number;
  /** 拒绝回调（用于把过载拒绝计入指标失败数） */
  onReject?: () => void;
}

/**
 * 创建并发闸门中间件。
 * 在响应 finish/close 时释放令牌，确保异常断开也能归还名额。
 */
export function createConcurrencyGate(options: ConcurrencyGateOptions) {
  const max = Math.max(1, options.max);
  const message = options.message ?? '系统繁忙，请稍后重试';
  const code = options.code ?? 'SERVER_BUSY';
  const retryAfterSeconds = options.retryAfterSeconds ?? 5;
  const onReject = options.onReject;
  let inFlight = 0;

  return function concurrencyGate(_req: Request, res: Response, next: NextFunction): void {
    if (inFlight >= max) {
      try {
        onReject?.();
      } catch {
        /* 指标记录失败不影响拒绝响应 */
      }
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(503).json({ success: false, code, message });
      return;
    }

    inFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
