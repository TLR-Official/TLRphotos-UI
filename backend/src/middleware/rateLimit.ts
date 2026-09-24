/**
 * @file rateLimit.ts
 * @description 轻量内存固定窗口限速器（V1.10.1 安全修复）。
 *  按客户端 IP 计数，超限返回 429 + Retry-After；不引入外部依赖。
 *  IP 提取与 verificationService 同源：X-Forwarded-For 首段（CF/nginx 写入真实客户端）。
 *  测试环境（NODE_ENV=test）默认放行，避免污染测试套件；可用 RATE_LIMIT_ENABLED=1 显式开启。
 */
import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  /** 窗口长度毫秒，默认 60000 */
  windowMs?: number;
  /** 窗口内最大请求数 */
  max: number;
  /** 超限提示语 */
  message?: string;
  /** 自定义限流键（默认按客户端 IP） */
  keyFn?: (req: Request) => string;
}

interface Counter {
  count: number;
  resetAt: number;
}

/** 全局限流桶（key 内含限流器实例 ID 与挂载路径，互不干扰） */
const buckets = new Map<string, Counter>();
let lastSweep = 0;
/** 限流器实例自增序号 */
let instanceSeq = 0;

/**
 * 提取客户端真实 IP：XFF 首段优先，其次 X-Real-IP，兜底 socket 地址。
 */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const fromXff = Array.isArray(xff) ? xff[0] : xff;
  const first = fromXff?.split(',')[0]?.trim();
  if (first) return first;
  const xri = req.headers['x-real-ip'];
  return (Array.isArray(xri) ? xri[0] : xri) || req.socket.remoteAddress || 'unknown';
}

/** 周期清理已过期桶，防止 Map 无限增长 */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * 创建固定窗口限速中间件。
 */
export function createRateLimiter(options: RateLimitOptions) {
  const windowMs = options.windowMs ?? 60_000;
  const { max } = options;
  const message = options.message ?? '请求过于频繁，请稍后再试';
  const keyFn = options.keyFn ?? clientIp;
  // 测试环境默认关闭；显式 RATE_LIMIT_ENABLED=1 时生效
  const disabled = process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== '1';
  const instanceId = ++instanceSeq;

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    if (disabled) {
      next();
      return;
    }
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      sweep(now);
      lastSweep = now;
    }
    const key = `${instanceId}:${req.baseUrl}${req.path}:${keyFn(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ success: false, message, code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}
