/**
 * @file uploadTimeout.ts（V4.9.0）
 * @description 按上传体积动态设置请求超时：文件越大，允许的上传与处理时间越长，
 *  避免小文件被长时间占用连接，也避免大文件在固定 120s 阈值下被误杀。
 *  公式：baseMs + 每 MB 追加 perMbMs，结果夹在 [minMs, maxMs]。
 */
import type { Request, Response, NextFunction } from 'express';

export interface UploadTimeoutOptions {
  /** 基础时长（毫秒），默认 60s */
  baseMs?: number;
  /** 每 MB 追加时长（毫秒），默认 3000 */
  perMbMs?: number;
  /** 下限（毫秒），默认 60s */
  minMs?: number;
  /** 上限（毫秒），默认 300s */
  maxMs?: number;
}

/**
 * 创建上传超时中间件。
 * 读取 Content-Length 估算体积；无法读取时按 baseMs 处理。
 */
export function createUploadTimeout(options: UploadTimeoutOptions = {}) {
  const baseMs = options.baseMs ?? 60_000;
  const perMbMs = options.perMbMs ?? 3_000;
  const minMs = options.minMs ?? 60_000;
  const maxMs = options.maxMs ?? 300_000;

  return function uploadTimeout(req: Request, res: Response, next: NextFunction): void {
    const rawLength = Number(req.headers['content-length'] ?? 0);
    const sizeMb = Number.isFinite(rawLength) && rawLength > 0 ? Math.ceil(rawLength / (1024 * 1024)) : 0;
    const timeoutMs = Math.min(maxMs, Math.max(minMs, baseMs + sizeMb * perMbMs));

    res.setTimeout(timeoutMs, () => {
      if (res.headersSent) return;
      console.warn(
        `[UploadTimeout] ${req.method} ${req.originalUrl} 超过 ${timeoutMs}ms（content-length=${rawLength}）`
      );
      res.status(408).json({
        success: false,
        code: 'UPLOAD_TIMEOUT',
        message: '上传处理超时，请压缩图片尺寸后重试',
      });
    });

    next();
  };
}
