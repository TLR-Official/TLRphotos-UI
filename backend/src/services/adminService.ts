/**
 * @file 管理员服务
 * @description 提供管理员账号的登录验证、增删改查、操作日志记录与超级管理员初始化等能力。
 *              密码采用 bcrypt 加盐哈希，会话凭证使用 JWT 签发（含 iss/aud/tv 声明）。
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db';
import { maskTarget } from './otpService';

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
  must_change_password: number;
  token_version: number;
  phone?: string;
  phone_verified: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

/** 已公开的历史默认密码：用于暴露检测，绝不可再作为有效凭据使用 */
export const EXPOSED_DEFAULT_PASSWORD = 'TLRadmin2026!';

/** JWT 固定声明：限定本后端签发、仅后台前端可消费 */
const JWT_ISSUER = 'tlrphotos-backend';
const JWT_AUDIENCE = 'tlrphotos-admin';
/** JWT 有效期：8 小时 */
const JWT_TTL = '8h';

/**
 * 读取并校验管理员 JWT 密钥：缺失或 trim 后不足 32 字符一律 fail-closed。
 * 不提供任何硬编码回退。
 */
function loadJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('ADMIN_JWT_SECRET 未配置或长度不足 32 字符，拒绝签发/校验管理员凭证');
  }
  return secret;
}

/**
 * 启动时配置自检：密钥不合法时抛出，由调用方决定 fatal 退出。
 */
export function checkAdminJwtConfig(): void {
  loadJwtSecret();
}

/** 预生成的 dummy bcrypt 哈希：用户不存在时仍执行一次 compare，消除登录时序差 */
const DUMMY_HASH = bcrypt.hashSync(`dummy-${crypto.randomUUID()}`, 10);

/**
 * 为管理员签发 JWT（载荷含 tv 版本号，改密后旧 token 立即失效）
 */
export function signAdminToken(admin: AdminUser): string {
  return jwt.sign(
    { adminId: admin.id, role: admin.role, zone: admin.zone, tv: admin.token_version },
    loadJwtSecret(),
    { expiresIn: JWT_TTL, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

/**
 * 校验超管引导密码强度（用于 SUPER_ADMIN_PASSWORD）
 * 同时满足：字符串、trim 后 12–128 字符、不等于公开默认密码、不与用户名相同
 * @returns 合法返回 true，否则返回错误消息
 */
export function validateSuperAdminPassword(password: unknown, username: string): true | string {
  if (typeof password !== 'string') return '密码格式不合法';
  const trimmed = password.trim();
  if (trimmed.length < 12) return '密码长度至少 12 位';
  if (trimmed.length > 128) return '密码长度不可超过 128 位';
  if (trimmed === EXPOSED_DEFAULT_PASSWORD) return '不可使用已公开的默认密码';
  if (trimmed === username) return '密码不可与用户名相同';
  return true;
}

/**
 * 校验管理员用户名与密码（仅认证，不签发 JWT）。
 * 用户不存在时同样执行一次 bcrypt.compare（dummy），保证两条失败路径耗时一致。
 * 是否需要第二因素（超管短信验证码）由路由层按角色决定。
 * @param username 用户名
 * @param password 明文密码
 * @returns 成功返回管理员实体；失败返回通用错误消息（不可枚举用户）
 */
export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE username = ? AND is_active = 1', [username]);

  const hashToCheck = admin ? admin.password_hash : DUMMY_HASH;
  const passwordMatch = await bcrypt.compare(password, hashToCheck);

  if (!admin || !passwordMatch) {
    return { success: false, message: '用户名或密码错误' };
  }

  return { success: true, admin };
}

/** 超管短信第二因素票据有效期：5 分钟 */
const SMS_TICKET_TTL_MS = 5 * 60 * 1000;

interface SmsTicketPayload {
  adminId: string;
  username: string;
  ip: string;
  exp: number;
}

/**
 * 签发超管短信登录票据：密码与 Turnstile 通过后换取，
 * 供「发送/校验短信验证码」两步在 5 分钟内免重复人机验证。
 * 绑定 adminId、用户名与客户端 IP，HMAC-SHA256 防篡改。
 */
export function signAdminSmsTicket(admin: AdminUser, ip: string): string {
  const payload: SmsTicketPayload = {
    adminId: admin.id,
    username: admin.username,
    ip,
    exp: Date.now() + SMS_TICKET_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', loadJwtSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * 校验超管短信登录票据：恒时比对签名，核对用户名/IP/有效期，
 * 并确认对应超管账号仍活跃。任一条件不满足返回 null。
 */
export async function verifyAdminSmsTicket(
  ticket: unknown,
  username: string,
  ip: string
): Promise<AdminUser | null> {
  if (typeof ticket !== 'string') return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0 || dot === ticket.length - 1) return null;
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);

  const expected = crypto.createHmac('sha256', loadJwtSecret()).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: SmsTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SmsTicketPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.adminId !== 'string' ||
    typeof payload.username !== 'string' ||
    typeof payload.ip !== 'string' ||
    typeof payload.exp !== 'number' ||
    payload.username !== username ||
    payload.ip !== ip ||
    payload.exp < Date.now()
  ) {
    return null;
  }

  const admin = await db.get<AdminUser>(
    'SELECT * FROM admin_users WHERE id = ? AND username = ? AND role = "super" AND is_active = 1',
    [payload.adminId, username]
  );
  return admin || null;
}

/**
 * 校验 JWT 并返回对应管理员
 * - 强制校验签名、iss、aud、有效期
 * - tv 必须与库中 token_version 一致（改密后旧 token 立即失效）
 * - 要求账号仍处于活跃状态
 * @param token 客户端携带的 JWT
 * @returns 有效则返回 AdminUser，否则返回 null
 */
export async function verifyAdminToken(token: string): Promise<AdminUser | null> {
  try {
    const decoded = jwt.verify(token, loadJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }) as { adminId: string; tv?: number };

    const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ? AND is_active = 1', [decoded.adminId]);
    if (!admin) return null;
    // tv 缺失（旧 token）或版本不一致 → 一律无效
    if (typeof decoded.tv !== 'number' || decoded.tv !== admin.token_version) return null;
    return admin;
  } catch {
    return null;
  }
}

/**
 * 修改管理员密码：校验当前密码与新密码强度，原子提交
 * 「password_hash 更新 + token_version+1 + must_change_password=0」，
 * 改密前所有已签发 JWT 立即失效。
 * @returns 成功返回更新后的管理员；失败返回错误消息
 */
export async function changeAdminPassword(
  adminId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const admin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ? AND is_active = 1', [adminId]);
  if (!admin) {
    return { success: false, message: '账号不存在或已停用' };
  }

  const currentMatch = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!currentMatch) {
    return { success: false, message: '当前密码错误' };
  }

  const validation = validateSuperAdminPassword(newPassword, admin.username);
  if (validation !== true) {
    return { success: false, message: validation };
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await db.run(
    'UPDATE admin_users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0, updated_at = ? WHERE id = ?',
    [newHash, new Date().toISOString(), adminId]
  );

  const updated = await db.get<AdminUser>('SELECT * FROM admin_users WHERE id = ?', [adminId]);
  return { success: true, admin: updated || undefined };
}

/**
 * 暴露密码检测：对超级管理员执行公开默认密码比对，命中则置强制改密标记。
 * 仅应在 ADMIN_FORCE_CHANGE_PASSWORD=on 时由启动流程调用。
 * @returns 是否命中（命中即已置位）
 */
export async function detectExposedSuperPassword(): Promise<boolean> {
  const superAdmin = await db.get<AdminUser>('SELECT * FROM admin_users WHERE role = "super" AND is_active = 1');
  if (!superAdmin) return false;

  const isExposed = await bcrypt.compare(EXPOSED_DEFAULT_PASSWORD, superAdmin.password_hash);
  if (isExposed && superAdmin.must_change_password !== 1) {
    await db.run('UPDATE admin_users SET must_change_password = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), superAdmin.id]);
  }
  return isExposed;
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

  // 初始密码由上级设置，账号创建后首次登录必须自行改密
  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, email, name, role, zone, is_active, must_change_password, token_version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.username, passwordHash, data.email || null, data.name || null, data.role, data.zone, 1, 1, 0, data.created_by, new Date().toISOString(), new Date().toISOString()]
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
 * 按服务器配置引导超管手机号（V1.13.0 第二因素）。
 *
 * SUPER_ADMIN_PHONES 形如 `admin:13800000000,y:13900000000`（逗号分隔）：
 * - 号码须匹配中国大陆手机号口径（1[3-9] 开头 11 位），格式错误拒绝启动；
 * - 仅对 role=super 的活跃账号生效，用户名不存在时告警跳过；
 * - 号码变化或未验证时更新并置 phone_verified=1。
 *
 * 走配置通道而非应用界面，避免攻击者用公开默认密码登录后抢绑手机。
 */
export async function bootstrapSuperAdminPhones(): Promise<void> {
  const raw = process.env.SUPER_ADMIN_PHONES?.trim();
  if (!raw) return;

  for (const pair of raw.split(',')) {
    const item = pair.trim();
    if (!item) continue;

    const sep = item.lastIndexOf(':');
    if (sep <= 0 || sep === item.length - 1) {
      throw new Error(`SUPER_ADMIN_PHONES 配置项格式错误：「${item}」，应为 用户名:手机号`);
    }
    const username = item.slice(0, sep).trim();
    const phone = item.slice(sep + 1).trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      throw new Error(`SUPER_ADMIN_PHONES 中「${username}」的手机号格式不合法：${phone}`);
    }

    const admin = await db.get<AdminUser>(
      'SELECT * FROM admin_users WHERE username = ? AND role = "super" AND is_active = 1',
      [username]
    );
    if (!admin) {
      console.warn(`[Admin] SUPER_ADMIN_PHONES 未找到活跃超管账号「${username}」，已跳过`);
      continue;
    }

    if (admin.phone !== phone || admin.phone_verified !== 1) {
      await db.run(
        'UPDATE admin_users SET phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?',
        [phone, new Date().toISOString(), admin.id]
      );
      console.log(`[Admin] 超管「${username}」手机号已按配置绑定（${maskTarget(phone)}）`);
    }
  }
}

/**
 * 初始化超级管理员：进程启动时调用，按以下精确分支处理：
 *
 * 1. 不存在超管（全新库）：必须提供达标 SUPER_ADMIN_PASSWORD，否则 fatal 拒绝启动
 * 2. 存在且为 bcrypt：永不 fatal、不重置密码（暴露检测由 detectExposedSuperPassword 处理）
 * 3. 存在旧 sha256 哈希：必须提供达标 SUPER_ADMIN_PASSWORD 才能替换，否则 fatal
 *
 * 引导/替换成功的账号一律置 must_change_password=1。
 */
export async function initSuperAdmin(): Promise<void> {
  const existing = await db.get<AdminUser>('SELECT * FROM admin_users WHERE role = "super"');
  const bootPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (existing) {
    // bcrypt 哈希以 $2 开头；sha256 hex 长度为 64
    const isLegacyHash = !existing.password_hash.startsWith('$2') && existing.password_hash.length === 64;
    if (!isLegacyHash) {
      // 正常 bcrypt 账户：不做任何密码改动
      return;
    }

    const validation = validateSuperAdminPassword(bootPassword, existing.username);
    if (validation !== true) {
      throw new Error(`超级管理员密码为旧版哈希，需配置达标 SUPER_ADMIN_PASSWORD 后启动：${validation}`);
    }

    const newHash = await bcrypt.hash(bootPassword!.trim(), 10);
    await db.run(
      'UPDATE admin_users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?',
      [newHash, new Date().toISOString(), existing.id]
    );
    console.log('[Admin] 超级管理员旧版哈希已替换为 bcrypt，需登录后完成改密');
    return;
  }

  // 全新库引导
  const validation = validateSuperAdminPassword(bootPassword, 'admin');
  if (validation !== true) {
    throw new Error(`未检测到超级管理员，需配置达标 SUPER_ADMIN_PASSWORD 后启动：${validation}`);
  }

  const id = 'super_admin_initial';
  const passwordHash = await bcrypt.hash(bootPassword!.trim(), 10);

  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'admin', passwordHash, '系统管理员', 'super', 'default', 1, 1, 0, new Date().toISOString(), new Date().toISOString()]
  );

  console.log('[Admin] 超级管理员已引导创建，需首次登录后完成改密');
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
