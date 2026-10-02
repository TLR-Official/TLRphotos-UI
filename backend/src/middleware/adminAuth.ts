/**
 * @file 管理员认证中间件
 * @description 提供 Bearer Token 校验、角色鉴权与区域管理权限判定，
 *              校验通过后将 AdminUser 挂载到 req.admin 供后续处理器使用。
 */

import express from 'express';
import { verifyAdminToken, type AdminUser, type AdminRole } from '../services/adminService';

// 扩展 Express Request 类型，注入 admin 字段
declare global {
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

/**
 * 管理员认证中间件：校验 Authorization 头中的 Bearer Token
 * @param req 请求对象
 * @param res 响应对象
 * @param next 下一个中间件
 * @returns 缺少/无效 token 时返回 401；通过则挂载 admin 并放行
 */
export async function adminAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;

  // 必须携带 Bearer 形式的 Authorization 头
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未授权访问' });
  }

  // 截取 "Bearer " 之后的 token 部分
  const token = authHeader.substring(7);
  const admin = await verifyAdminToken(token);

  if (!admin) {
    return res.status(401).json({ success: false, message: '无效的令牌' });
  }

  req.admin = admin;

  // 强制改密门：must_change_password=1 时，除查询自身信息与改密接口外一律拦截。
  // req.path 为相对 admin 路由挂载点的路径（如 /me、/me/password）。
  if (admin.must_change_password === 1) {
    const allowed =
      (req.method === 'GET' && req.path === '/me') ||
      (req.method === 'POST' && req.path === '/me/password');
    if (!allowed) {
      return res.status(403).json({
        success: false,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: '请先完成密码修改',
      });
    }
  }

  next();
}

/**
 * 角色鉴权工厂：返回一个仅允许指定角色通过的中间件
 * @param roles 允许访问的角色列表
 * @returns Express 中间件
 */
export function requireRole(roles: AdminRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: '未授权访问' });
    }

    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: '权限不足' });
    }

    next();
  };
}

/**
 * 判定管理员是否有权管理指定区域
 * - super：可管理任意区域
 * - zone_master：仅可管理其所属区域
 * - 其他角色：无权管理
 * @param targetZone 目标区域
 * @param admin 当前管理员
 * @returns 是否拥有管理权限
 */
export function canManageZone(targetZone: string, admin: AdminUser): boolean {
  if (admin.role === 'super') return true;
  if (admin.role === 'zone_master' && admin.zone === targetZone) return true;
  return false;
}
