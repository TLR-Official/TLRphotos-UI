import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';

export type AdminRole = 'super' | 'zone_master' | 'zone_auditor';

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  email?: string;
  name?: string;
  role: AdminRole;
  zone: string;
  is_active: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'admin-secret-key-change-in-production';

export async function adminLogin(username: string, password: string): Promise<{ success: boolean; token?: string; admin?: AdminUser; message?: string }> {
  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE username = ? AND is_active = 1', [username]);
  
  if (!admin) {
    return { success: false, message: '用户名或密码错误' };
  }

  const passwordMatch = crypto.timingSafeEqual(
    Buffer.from(crypto.createHash('sha256').update(password).digest('hex')),
    Buffer.from(admin.password_hash)
  );

  if (!passwordMatch) {
    return { success: false, message: '用户名或密码错误' };
  }

  const token = jwt.sign(
    { adminId: admin.id, role: admin.role, zone: admin.zone },
    ADMIN_JWT_SECRET,
    { expiresIn: '24h' }
  );

  return { success: true, token, admin };
}

export async function verifyAdminToken(token: string): Promise<AdminUser | null> {
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: string };
    const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ? AND is_active = 1', [decoded.adminId]);
    return admin || null;
  } catch {
    return null;
  }
}

export async function createAdminUser(data: {
  username: string;
  password: string;
  email?: string;
  name?: string;
  role: AdminRole;
  zone: string;
  created_by: string;
}): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const existing = await db.get('SELECT id FROM admin_users WHERE username = ? OR email = ?', [data.username, data.email || '']);
  if (existing) {
    return { success: false, message: '用户名或邮箱已存在' };
  }

  const id = crypto.randomUUID();
  const passwordHash = crypto.createHash('sha256').update(data.password).digest('hex');

  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, email, name, role, zone, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.username, passwordHash, data.email || null, data.name || null, data.role, data.zone, data.created_by, new Date().toISOString(), new Date().toISOString()]
  );

  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [id]);
  return { success: true, admin };
}

export async function getAdminUsers(role?: AdminRole, zone?: string): Promise<AdminUser[]> {
  let query = 'SELECT * FROM admin_users WHERE is_active = 1';
  const params: (string | number)[] = [];

  if (role) {
    query += ' AND role = ?';
    params.push(role);
  }

  if (zone) {
    query += ' AND zone = ?';
    params.push(zone);
  }

  query += ' ORDER BY created_at DESC';
  return db.all<AdminUser[]>(query, params);
}

export async function getAdminUserById(id: string): Promise<AdminUser | null> {
  const result = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [id]);
  return result || null;
}

export async function updateAdminUser(id: string, data: Partial<Pick<AdminUser, 'email' | 'name' | 'role' | 'zone' | 'is_active'>>): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.email !== undefined) {
    setClauses.push('email = ?');
    params.push(data.email || null);
  }
  if (data.name !== undefined) {
    setClauses.push('name = ?');
    params.push(data.name || null);
  }
  if (data.role !== undefined) {
    setClauses.push('role = ?');
    params.push(data.role);
  }
  if (data.zone !== undefined) {
    setClauses.push('zone = ?');
    params.push(data.zone);
  }
  if (data.is_active !== undefined) {
    setClauses.push('is_active = ?');
    params.push(data.is_active);
  }

  if (setClauses.length === 0) {
    return { success: false, message: '没有需要更新的字段' };
  }

  setClauses.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await db.run(`UPDATE admin_users SET ${setClauses.join(', ')} WHERE id = ?`, params);

  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [id]);
  return { success: true, admin };
}

export async function deleteAdminUser(id: string): Promise<boolean> {
  await db.run('UPDATE admin_users SET is_active = 0 WHERE id = ?', [id]);
  return true;
}

export async function logAdminAction(admin: AdminUser, action: string, targetType?: string, targetId?: string, details?: object, ip?: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.run(
    'INSERT INTO admin_logs (id, admin_id, admin_name, action, target_type, target_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, admin.id, admin.username, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, ip || null, new Date().toISOString()]
  );
}

export async function initSuperAdmin(): Promise<void> {
  const existing = await db.get('SELECT id FROM admin_users WHERE role = "super"');
  if (existing) return;

  const id = 'super_admin_initial';
  const passwordHash = crypto.createHash('sha256').update('TLRadmin2026!').digest('hex');

  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, name, role, zone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'admin', passwordHash, '系统管理员', 'super', 'default', 1, new Date().toISOString(), new Date().toISOString()]
  );

  console.log('[Admin] 最高账户已创建: admin / TLRadmin2026!');
}

export async function getAdminLogs(adminId?: string, action?: string, limit = 100, offset = 0): Promise<{ logs: any[]; total: number }> {
  let query = 'SELECT * FROM admin_logs';
  let countQuery = 'SELECT COUNT(*) as total FROM admin_logs';
  const params: (string | number)[] = [];

  if (adminId) {
    query += ' WHERE admin_id = ?';
    countQuery += ' WHERE admin_id = ?';
    params.push(adminId);
  }

  if (action) {
    query += adminId ? ' AND' : ' WHERE';
    countQuery += adminId ? ' AND' : ' WHERE';
    query += ' action = ?';
    countQuery += ' action = ?';
    params.push(action);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [logs, count] = await Promise.all([
    db.all(query, params),
    db.get(countQuery, adminId || action ? params.slice(0, -2) : [])
  ]);

  return { logs, total: count?.total || 0 };
}