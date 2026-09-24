/**
 * @file requireAuth.ts
 * @description JWT 强制认证中间件（V1.10.1 安全修复）。
 *  封装 loadAuthUser，在进入文件解析（multer）等重资源逻辑前完成身份核验：
 *   - token 有效但账号被封禁/禁用 → 返回对应 401；
 *   - 无 token / token 无效 / 用户不存在 → 401 AUTH_REQUIRED；
 *   - 认证通过 → 用户对象挂到 req.authUser 后放行。
 */
import type { Request, Response, NextFunction } from 'express';
import { loadAuthUser, type User } from '../services/authService';

declare global {
  namespace Express {
    interface Request {
      /** V1.10.1：经 requireAuth 认证后的用户对象 */
      authUser?: User;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { user, error } = await loadAuthUser(req);
    if (error) {
      res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return;
    }
    if (!user) {
      res.status(401).json({ success: false, message: '请先登录', code: 'AUTH_REQUIRED' });
      return;
    }
    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
