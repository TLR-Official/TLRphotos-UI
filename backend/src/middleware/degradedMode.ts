/**
 * @file degradedMode.ts（V4.9.0）
 * @description 非核心功能降级开关：环境变量 DEGRADED_MODE=on 时（逐请求读取，热切换），
 *  对评论、论坛、AI 记忆、新闻、公告、申诉、通知等非核心模块的写请求返回 503，
 *  保留全部读请求与注册/登录/上传/浏览/图片代理/管理端等核心链路。
 *  用于流量峰值或故障期主动卸载非关键写入，优先保障核心可用性。
 */
import type { Request, Response, NextFunction } from 'express';

/** 参与降级的写方法 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 非核心模块路径前缀（挂载于 /api 之下） */
const NON_CORE_PREFIXES = [
  '/comments',
  '/forum',
  '/everos',
  '/news',
  '/announcements',
  '/my-appeals',
  '/notifications',
];

/** 当前是否处于降级模式（逐请求读取，修改 .env 后重启即可生效） */
export function isDegradedMode(): boolean {
  return (process.env.DEGRADED_MODE || '').toLowerCase() === 'on';
}

/**
 * 降级中间件：仅拦截非核心模块的写请求，读请求与核心链路一律放行。
 */
export function degradedModeMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isDegradedMode()) {
    next();
    return;
  }
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  const isNonCore = NON_CORE_PREFIXES.some(
    (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`)
  );
  if (!isNonCore) {
    next();
    return;
  }
  res.status(503).json({
    success: false,
    code: 'DEGRADED_MODE',
    message: '系统当前处于降级模式，该功能暂不可用，请稍后再试',
  });
}
