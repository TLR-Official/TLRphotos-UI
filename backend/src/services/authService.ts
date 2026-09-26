/**
 * @file 认证服务
 * @description 面向普通用户（非管理员）的认证与账户管理：注册、登录、令牌校验、
 *              资料更新、密码修改与头像更新。密码采用 bcrypt 加盐哈希，会话凭证使用 JWT。
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type express from 'express';
import { db } from '../db';
import { createSession, deleteUserSessions } from './cookieService';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';
const SALT_ROUNDS = 10;

/** 用户实体（对应 users 表结构） */
export interface User {
  id: string;
  // V1.11.0：email 可空（手机号注册用户无邮箱）
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  phone_verified: number;
  website: string | null;
  location: string | null;
  custom_fields: string | null;
  is_active: number;
  banned_at: string | null;
  can_upload: number;
  can_view: number;
  can_download: number;
  can_like: number;
  created_at: string;
  updated_at: string;
}

/** 登录账号识别结果：邮箱 / 手机号 */
export type IdentifierKind = 'email' | 'phone';

/**
 * 识别登录账号类型：/^1[3-9]\d{9}$/ 判定为手机号，其余含 @ 且域名含点的为邮箱。
 * 与 auth.ts 路由层识别规则保持一致（单点维护风险可控：两处均使用本函数）。
 */
export function detectIdentifier(identifier: string): IdentifierKind | null {
  if (/^1[3-9]\d{9}$/.test(identifier)) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return 'email';
  return null;
}

/**
 * 按登录账号（邮箱或手机号）查询用户。
 * 手机号查 phone 列、邮箱查 email 列；返回 null 表示未注册。
 */
export async function findUserByIdentifier(identifier: string): Promise<User | null> {
  const kind = detectIdentifier(identifier);
  if (!kind) return null;
  const user =
    kind === 'phone'
      ? await db.get(
          'SELECT id, email, password_hash, username, avatar_url, bio, phone, phone_verified, website, location, custom_fields, is_active, banned_at, can_upload, can_view, can_download, can_like, created_at, updated_at FROM users WHERE phone = ?',
          identifier
        )
      : await db.get(
          'SELECT id, email, password_hash, username, avatar_url, bio, phone, phone_verified, website, location, custom_fields, is_active, banned_at, can_upload, can_view, can_download, can_like, created_at, updated_at FROM users WHERE email = ?',
          identifier
        );
  return user ? (user as User) : null;
}

/** 登录结果：用户信息 + JWT + 可选的长期会话 token */
export interface LoginResult {
  user: User;
  token: string;
  session_token?: string;
}

/**
 * 用户注册：唯一性校验通过后写入新用户。
 * V1.11.0 扩展：支持邮箱注册（email 写入）与手机号注册（email=NULL、phone 写入、phone_verified=1，
 * username 缺省自动生成「用户+手机后4位」）。
 * @param identifier 邮箱或手机号（自动识别）
 * @param password 明文密码
 * @param username 可选用户名
 * @returns 新建用户信息（不含密码哈希）
 */
export async function register(identifier: string, password: string, username?: string): Promise<User> {
  const kind = detectIdentifier(identifier);
  if (!kind) {
    throw new Error('登录账号格式不正确');
  }

  const existingUser =
    kind === 'phone'
      ? await db.get('SELECT id FROM users WHERE phone = ?', identifier)
      : await db.get('SELECT id FROM users WHERE email = ?', identifier);
  if (existingUser) {
    throw new Error(kind === 'phone' ? '该手机号已被注册' : '邮箱已被注册');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  // 用户 ID 采用 user_ + 时间戳，保证可读性与唯一性
  const userId = `user_${Date.now()}`;
  // 手机号注册缺省用户名：「用户+手机后4位」
  const finalUsername = username || (kind === 'phone' ? `用户${identifier.slice(-4)}` : null);

  await db.run(
    'INSERT INTO users (id, email, phone, phone_verified, password_hash, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId,
    kind === 'email' ? identifier : null,
    kind === 'phone' ? identifier : null,
    kind === 'phone' ? 1 : 0,
    passwordHash,
    finalUsername,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const newUser = await getUserById(userId);
  if (!newUser) {
    throw new Error('注册失败');
  }
  return newUser;
}

/**
 * 用户登录：校验账号密码并签发 JWT；勾选"记住我"时额外创建长期会话。
 * V1.11.0：账号查询统一走 findUserByIdentifier，支持邮箱 / 手机号；
 * JWT 签发与会话创建抽取为 issueLoginResult，供两段式登录的 verify 步复用。
 * @param email 登录账号（邮箱或手机号）
 * @param password 明文密码
 * @param remember 是否创建长期会话
 * @param ipAddress 客户端 IP（用于会话记录）
 * @returns 用户信息、JWT 及可选会话 token
 */
export async function login(email: string, password: string, remember?: boolean, ipAddress?: string): Promise<LoginResult> {
  const user = await verifyPasswordOnly(email, password);
  return issueLoginResult(user, remember, ipAddress);
}

/**
 * 仅校验账号密码（两段式登录第一步使用，不签发 JWT / 不创建会话）。
 * 按手机号或邮箱识别查询；用户不存在、被封禁、被禁用、密码错误分别抛出对应错误。
 * @param identifier 邮箱或手机号
 * @param password 明文密码
 * @returns 密码校验通过的用户实体
 */
export async function verifyPasswordOnly(identifier: string, password: string): Promise<User> {
  const user = await findUserByIdentifier(identifier);

  if (!user) {
    throw new Error('账号或密码错误');
  }

  // V1.7.0：先判封禁再判禁用，给出明确区分提示
  if (user.banned_at) {
    throw new Error('该账号已被封禁');
  }
  if (!user.is_active) {
    throw new Error('用户已被禁用');
  }

  const isPasswordValid = await bcrypt.compare(password, (user as any).password_hash);
  if (!isPasswordValid) {
    throw new Error('账号或密码错误');
  }

  return user;
}

/**
 * 签发 JWT 并按需创建长期会话（两段式登录第二步 / 注册完成 / 测试绕过路径复用）。
 * @param user 已完成校验的用户实体
 * @param remember 是否创建长期会话
 * @param ipAddress 客户端 IP（用于会话记录）
 */
export async function issueLoginResult(user: User, remember?: boolean, ipAddress?: string): Promise<LoginResult> {
  // JWT 载荷仅含 userId，有效期 24 小时
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  // 勾选"记住我"时创建独立的长期会话 token，便于跨设备保持登录
  let session_token: string | undefined;
  if (remember && ipAddress) {
    session_token = await createSession(user.id, ipAddress);
  }

  return {
    user: {
      id: user.id,
      email: user.email || null,
      username: user.username || null,
      avatar_url: user.avatar_url || null,
      bio: user.bio || null,
      phone: user.phone || null,
      phone_verified: user.phone_verified ?? 0,
      website: user.website || null,
      location: user.location || null,
      custom_fields: user.custom_fields || null,
      is_active: user.is_active,
      banned_at: null,
      can_upload: user.can_upload ?? 1,
      can_view: user.can_view ?? 1,
      can_download: user.can_download ?? 1,
      can_like: user.can_like ?? 1,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    token,
    session_token,
  };
}

/**
 * 校验 JWT 签名与有效期
 * @param token JWT 字符串
 * @returns 有效返回 { userId }，无效返回 null
 */
export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch {
    return null;
  }
}

/**
 * 按 ID 查询用户完整资料
 * @param userId 用户 ID
 * @returns 用户信息；不存在返回 null
 */
export async function getUserById(userId: string): Promise<User | null> {
  const user = await db.get('SELECT id, email, username, avatar_url, bio, phone, phone_verified, website, location, custom_fields, is_active, banned_at, can_upload, can_view, can_download, can_like, created_at, updated_at FROM users WHERE id = ?', userId);
  return user ? (user as User) : null;
}

/**
 * 认证错误信息（V1.7.0 新增）。
 * 用于 loadAuthUser 返回的 error 字段，供路由决定如何响应。
 */
export interface AuthError {
  code: string;
  message: string;
  status: number;
}

/**
 * 加载当前请求的认证用户（含封禁状态与功能权限）。
 * V1.7.0 新增：替代内联 jwt.verify，统一在认证流程查库检查 banned_at/is_active，
 * 实现封禁后现有 JWT 立即失效（任何需鉴权操作都返回 401）。
 *
 * - 无 token / token 无效 → { user: null, error: null }（匿名，公开路由放行）
 * - token 有效但 banned_at 非空 → { user: null, error: USER_BANNED }（强制下线）
 * - token 有效但 !is_active 且未封禁 → { user: null, error: USER_DISABLED }
 * - 正常 → { user, error: null }
 *
 * @param req Express 请求（读取 Authorization 头）
 * @returns { user, error }：user 含权限字段，error 为认证失败信息
 */
export async function loadAuthUser(req: express.Request): Promise<{ user: User | null; error: AuthError | null }> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: null };
  }
  const token = authHeader.substring(7);
  let userId: string;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch {
    return { user: null, error: null };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { user: null, error: null };
  }
  if (user.banned_at) {
    return { user: null, error: { code: 'USER_BANNED', message: '该账号已被封禁', status: 401 } };
  }
  if (!user.is_active) {
    return { user: null, error: { code: 'USER_DISABLED', message: '用户已被禁用', status: 401 } };
  }
  return { user, error: null };
}

/**
 * 更新用户资料（不含密码与邮箱）
 * @param userId 用户 ID
 * @param data 待更新字段集合
 * @returns 更新后的用户信息
 */
export async function updateUser(userId: string, data: Partial<User>): Promise<User> {
  const { username, avatar_url, bio, phone, website, location, custom_fields } = data;

  await db.run(
    'UPDATE users SET username = ?, avatar_url = ?, bio = ?, phone = ?, website = ?, location = ?, custom_fields = ?, updated_at = ? WHERE id = ?',
    username || null,
    avatar_url || null,
    bio || null,
    phone || null,
    website || null,
    location || null,
    custom_fields || null,
    new Date().toISOString(),
    userId
  );

  const updatedUser = await getUserById(userId);
  if (!updatedUser) {
    throw new Error('用户不存在');
  }
  return updatedUser;
}

/**
 * 修改密码：校验原密码后写入新哈希
 * @param userId 用户 ID
 * @param oldPassword 原密码
 * @param newPassword 新密码（长度 ≥ 6）
 */
export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const user = await db.get('SELECT password_hash FROM users WHERE id = ?', userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  const isPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);
  if (!isPasswordValid) {
    throw new Error('原密码错误');
  }

  if (newPassword.length < 6) {
    throw new Error('新密码长度至少为6位');
  }

  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    newPasswordHash,
    new Date().toISOString(),
    userId
  );
}

/**
 * 更新用户头像 URL
 * @param userId 用户 ID
 * @param avatarUrl 头像可访问 URL
 * @returns 更新后的用户信息
 */
export async function updateAvatar(userId: string, avatarUrl: string): Promise<User> {
  await db.run(
    'UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?',
    avatarUrl,
    new Date().toISOString(),
    userId
  );

  const updatedUser = await getUserById(userId);
  if (!updatedUser) {
    throw new Error('用户不存在');
  }
  return updatedUser;
}
