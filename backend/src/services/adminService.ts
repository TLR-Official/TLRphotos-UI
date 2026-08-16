/**
 * @file 管理员服务
 * @description 提供管理员账号的登录验证、增删改查、操作日志记录与超级管理员初始化等能力。
 *              密码采用 bcrypt 加盐哈希，会话凭证使用 JWT 签发。
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db';

/** 管理员角色：super（超级管理员）/ zone_master（区域管理员）/ zone_auditor（区域审计） */
export type AdminRole = 'super' | 'zone_master' | 'zone_auditor';

/** 管理员用户实体（对应 admin_users 表结构） */
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

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'tlrphotos-admin-secret-change-in-production';

/**
 * 管理员登录：校验用户名密码并签发 JWT
 * @param username 用户名
 * @param password 明文密码
 * @returns 成功返回 token 与管理员信息；失败返回错误消息
 */
export async function adminLogin(username: string, password: string): Promise<{ success: boolean; token?: string; admin?: AdminUser; message?: string }> {
  // 仅允许活跃账号登录
  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE username = ? AND is_active = 1', [username]);

  if (!admin) {
    return { success: false, message: '用户名或密码错误' };
  }

  const passwordMatch = await bcrypt.compare(password, admin.password_hash);

  if (!passwordMatch) {
    return { success: false, message: '用户名或密码错误' };
  }

  // JWT 载荷携带管理员 ID、角色与所属区域，有效期 24 小时
  const token = jwt.sign(
    { adminId: admin.id, role: admin.role, zone: admin.zone },
    ADMIN_JWT_SECRET,
    { expiresIn: '24h' }
  );

  return { success: true, token, admin };
}

/**
 * 校验 JWT 并返回对应管理员（要求账号仍处于活跃状态）
 * @param token 客户端携带的 JWT
 * @returns 有效则返回 AdminUser，否则返回 null
 */
export async function verifyAdminToken(token: string): Promise<AdminUser | null> {
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: string };
    const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ? AND is_active = 1', [decoded.adminId]);
    return admin || null;
  } catch {
    return null;
  }
}

/**
 * 创建管理员账号
 * @param data 账号信息（含明文密码，将由 bcrypt 加密后入库）
 * @returns 成功返回新账号；用户名或邮箱已存在则失败
 */
export async function createAdminUser(data: {
  username: string;
  password: string;
  email?: string;
  name?: string;
  role: AdminRole;
  zone: string;
  created_by: string;
}): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  // 唯一性校验：用户名与邮箱均不可重复
  const existing = await db.get('SELECT id FROM admin_users WHERE username = ? OR email = ?', [data.username, data.email || '']);
  if (existing) {
    return { success: false, message: '用户名或邮箱已存在' };
  }

  const id = crypto.randomUUID();
  // bcrypt cost factor = 10
  const passwordHash = await bcrypt.hash(data.password, 10);

  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, email, name, role, zone, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.username, passwordHash, data.email || null, data.name || null, data.role, data.zone, data.created_by, new Date().toISOString(), new Date().toISOString()]
  );

  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [id]);
  return { success: true, admin };
}

/**
 * 查询管理员列表，支持按角色与区域筛选
 * @param role 可选角色过滤
 * @param zone 可选区域过滤
 * @returns 活跃管理员列表（按创建时间倒序）
 */
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

/**
 * 按 ID 查询管理员
 * @param id 管理员主键
 * @returns 命中返回 AdminUser，否则 null
 */
export async function getAdminUserById(id: string): Promise<AdminUser | null> {
  const result = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [id]);
  return result || null;
}

/**
 * 更新管理员字段（动态拼接 SET 子句，仅更新传入字段）
 * @param id 管理员主键
 * @param data 待更新字段集合
 * @returns 成功返回更新后的账号；无字段可更新则失败
 */
export async function updateAdminUser(id: string, data: Partial<Pick<AdminUser, 'email' | 'name' | 'role' | 'zone' | 'is_active'>>): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  // 仅将显式传入的字段加入 SET 子句，未提供的字段保持原值
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

  // 同步刷新 updated_at，并将主键作为 WHERE 条件追加到参数末尾
  setClauses.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await db.run(`UPDATE admin_users SET ${setClauses.join(', ')} WHERE id = ?`, params);

  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [id]);
  return { success: true, admin };
}

/**
 * 软删除管理员：仅置 is_active=0，保留数据用于审计
 * @param id 管理员主键
 * @returns 始终返回 true
 */
export async function deleteAdminUser(id: string): Promise<boolean> {
  await db.run('UPDATE admin_users SET is_active = 0 WHERE id = ?', [id]);
  return true;
}

/**
 * 记录管理员操作日志
 * @param admin 操作执行者
 * @param action 动作标识
 * @param targetType 目标对象类型
 * @param targetId 目标对象 ID
 * @param details 详细信息（将序列化为 JSON）
 * @param ip 来源 IP
 */
export async function logAdminAction(admin: AdminUser, action: string, targetType?: string, targetId?: string, details?: object, ip?: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.run(
    'INSERT INTO admin_logs (id, admin_id, admin_name, action, target_type, target_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, admin.id, admin.username, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, ip || null, new Date().toISOString()]
  );
}

/**
 * 初始化超级管理员：进程启动时调用
 * - 若已存在超级管理员且密码为旧版 sha256（长度 64），则升级为 bcrypt
 * - 若不存在，则使用内置账号 admin / TLRadmin2026! 创建
 */
export async function initSuperAdmin(): Promise<void> {
  const existing = await db.get('SELECT id, password_hash FROM admin_users WHERE role = "super"');
  if (existing) {
    // sha256 hex 长度为 64，识别旧版哈希并升级
    if (existing.password_hash.length === 64) {
      const newHash = await bcrypt.hash('TLRadmin2026!', 10);
      await db.run('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?', [newHash, new Date().toISOString(), existing.id]);
      console.log('[Admin] 最高账户密码已升级为bcrypt格式');
    }
    return;
  }

  const id = 'super_admin_initial';
  const passwordHash = await bcrypt.hash('TLRadmin2026!', 10);

  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, name, role, zone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'admin', passwordHash, '系统管理员', 'super', 'default', 1, new Date().toISOString(), new Date().toISOString()]
  );

  console.log('[Admin] 最高账户已创建: admin / TLRadmin2026!');
}

/**
 * 分页查询管理员操作日志
 * @param adminId 可选：按操作者筛选
 * @param action 可选：按动作筛选
 * @param limit 每页条数，默认 100
 * @param offset 偏移量，默认 0
 * @returns 日志列表与总数
 */
export async function getAdminLogs(adminId?: string, action?: string, limit = 100, offset = 0): Promise<{ logs: any[]; total: number }> {
  let query = 'SELECT * FROM admin_logs';
  let countQuery = 'SELECT COUNT(*) as total FROM admin_logs';
  const params: (string | number)[] = [];

  // 动态拼接 WHERE 条件：adminId 与 action 同时存在时使用 AND 连接
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

  // count 查询不需要 limit/offset 参数，需剔除末尾两位
  const [logs, count] = await Promise.all([
    db.all(query, params),
    db.get(countQuery, adminId || action ? params.slice(0, -2) : [])
  ]);

  return { logs, total: count?.total || 0 };
}