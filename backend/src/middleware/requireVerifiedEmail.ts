/**
 * @file requireVerifiedEmail.ts
 * @description 账户功能邮箱确权门（V2.0.0）。
 *              挂接在需要登录的账户类功能路由上：匿名访问 → 401；
 *              已登录但 email_verified=0（或 email 为空）→ 403 EMAIL_VERIFICATION_REQUIRED，
 *              由前端引导重新登录并完成邮箱验证码确权（或先绑定邮箱）。
 *              公开浏览路由不得挂接本中间件。
 */
import type { Request, Response, NextFunction } from 'express';
import { loadAuthUser } from '../services/authService';

export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { user, error } = await loadAuthUser(req);
  if (error) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message });
    return;
  }
  if (!user) {
    res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: '请先登录' });
    return;
  }
  if (!user.email || user.email_verified !== 1) {
    res.status(403).json({
      success: false,
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: '请先完成邮箱验证后再使用该功能',
    });
    return;
  }
  next();
}
