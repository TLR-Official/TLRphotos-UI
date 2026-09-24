/**
 * @file errorHandler.ts
 * @description 全局错误处理与 404 中间件（V1.10.1 安全修复）。
 *  统一兜底：
 *   - body-parser 解析错误（畸形 JSON / 超限）→ 400 通用提示；
 *   - CORS 来源拒绝 → 403；
 *   - 数据库引擎 / ORM / multer 等内部错误 → 记录完整日志，客户端仅收到通用提示，
 *     不回显 SQLITE_*、errno、SQL 片段、磁盘路径等敏感细节。
 */
import type { Request, Response, NextFunction } from 'express';

/** 敏感错误特征：命中即对客户端脱敏 */
const SENSITIVE_PATTERN =
  /SQLITE_|SQL syntax|no such column|column index|database is locked|better-sqlite3|sqlite3|errno|\.db|\/opt\//i;

/** 未知 /api 路由兜底 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, message: '接口不存在' });
}

/**
 * Express 4 参数错误处理中间件（须挂载于所有路由之后）。
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  // 响应头发送后无法改写，交 Express 默认处理并仅记录日志
  if (res.headersSent) {
    next(err);
    return;
  }

  console.error('[UnhandledError]', err?.message || err);

  // CORS 来源不在白名单
  if (err?.code === 'CORS_BLOCKED') {
    res.status(403).json({ success: false, message: '来源不被允许', code: 'CORS_BLOCKED' });
    return;
  }

  // body-parser：请求体解析失败 / 体积超限
  if (err?.type?.startsWith?.('entity.')) {
    const status = err.status === 413 ? 413 : 400;
    res.status(status).json({
      success: false,
      message: status === 413 ? '请求内容过大' : '请求数据格式错误',
    });
    return;
  }

  // multer 错误（正常应已被 handleUploadError 捕获，此处兜底不外泄细节）
  if (err?.name === 'MulterError') {
    res.status(400).json({ success: false, message: '文件上传格式不正确' });
    return;
  }

  // 内部错误：数据库 / ORM / 磁盘路径等，统一脱敏
  const message = typeof err?.message === 'string' ? err.message : '';
  if (SENSITIVE_PATTERN.test(message)) {
    res.status(500).json({ success: false, message: '服务器内部错误' });
    return;
  }

  // 其余错误：仅接受安全的 4xx 状态透传，5xx 一律通用提示
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 400 && status < 500) {
    res.status(status).json({ success: false, message: message || '请求处理失败' });
    return;
  }
  res.status(500).json({ success: false, message: '服务器内部错误' });
}
