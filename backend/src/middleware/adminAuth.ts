import express from 'express';
import { verifyAdminToken, type AdminUser, type AdminRole } from '../services/adminService';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

export async function adminAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未授权访问' });
  }

  const token = authHeader.substring(7);
  const admin = await verifyAdminToken(token);

  if (!admin) {
    return res.status(401).json({ success: false, message: '无效的令牌' });
  }

  req.admin = admin;
  next();
}

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

export function canManageZone(targetZone: string, admin: AdminUser): boolean {
  if (admin.role === 'super') return true;
  if (admin.role === 'zone_master' && admin.zone === targetZone) return true;
  return false;
}