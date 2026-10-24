/**
 * @file optionalAuth.ts
 * @description 可选认证工具：从请求头解析 JWT 获取当前用户 ID。
 *
 * 与 `requireAuth` 中间件不同，本函数**不阻断**请求：未登录、令牌缺失或无效时
 * 一律返回 null，由调用方决定如何降级（例如公开画廊按匿名处理、公开主页仅
 * 据此计算 is_self）。原实现分散在 photos 与 users 两个路由，逻辑完全相同，
 * 此处收敛为唯一实现。
 */
import express from 'express';
import jwt from 'jsonwebtoken';

/** JWT 密钥：用于校验可选携带的 Bearer Token（与认证主链路同源） */
const JWT_SECRET = process.env.JWT_SECRET || '';

/**
 * 从请求头解析 JWT 获取当前用户 ID（可选认证）。
 * @param req - Express 请求对象
 * @returns 解析成功返回 userId；未携带令牌或校验失败返回 null
 */
export function getOptionalUserId(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}
