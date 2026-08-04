/**
 * @file Cookie/会话服务
 * @description 管理"记住我"长期会话：会话 token 由 crypto.randomBytes 生成，
 *              客户端 IP 经 AES-256-GCM 加密后入库，会话同时受绝对过期与不活跃过期双重约束。
 */

import { db } from '../db';
import { encrypt, decrypt } from '../utils/crypto';
import crypto from 'crypto';

/** 会话绝对存活天数（自创建起） */
const MAX_AGE_DAYS = 30;
/** 不活跃过期天数（自上次活跃起） */
const INACTIVITY_DAYS = 7;

/** 会话实体（解密后的呈现形态，对应 cookie 表） */
export interface Session {
  id: string;
  user_id: string;
  session_token: string;
  ip_address: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

/**
 * 创建新会话：生成随机 token，IP 加密入库
 * @param userId 用户 ID
 * @param ipAddress 客户端 IP
 * @returns 未加密的会话 token（供写入 Cookie）
 */
export async function createSession(userId: string, ipAddress: string): Promise<string> {
  // 32 字节随机串作为会话 token，不可猜测
  const sessionToken = crypto.randomBytes(32).toString('hex');
  // IP 加密后存储，避免明文泄露用户轨迹
  const encryptedIp = encrypt(ipAddress);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const id = `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

  await db.run(
    'INSERT INTO cookie (id, user_id, session_token, encrypted_ip, created_at, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    userId,
    sessionToken,
    encryptedIp,
    now.toISOString(),
    now.toISOString(),
    expiresAt.toISOString()
  );

  return sessionToken;
}

/**
 * 根据 token 查询会话：校验绝对过期与不活跃过期，过期则同步删除
 * @param sessionToken 会话 token
 * @returns 有效会话返回 Session；不存在或已过期返回 null
 */
export async function getSession(sessionToken: string): Promise<Session | null> {
  const row = await db.get('SELECT * FROM cookie WHERE session_token = ?', sessionToken);

  if (!row) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  const lastActiveAt = new Date(row.last_active_at);

  // 双重过期判定：超过 expires_at 或超过 INACTIVITY_DAYS 未活跃
  const isExpiredByTime = now > expiresAt;
  const isExpiredByInactivity = now.getTime() > lastActiveAt.getTime() + INACTIVITY_DAYS * 24 * 60 * 60 * 1000;

  if (isExpiredByTime || isExpiredByInactivity) {
    await deleteSession(sessionToken);
    return null;
  }

  // 解密 IP 失败时回退为占位字符串，不影响会话有效性
  let ipAddress = '';
  try {
    ipAddress = decrypt(row.encrypted_ip);
  } catch {
    ipAddress = 'encrypted';
  }

  return {
    id: row.id,
    user_id: row.user_id,
    session_token: row.session_token,
    ip_address: ipAddress,
    created_at: row.created_at,
    last_active_at: row.last_active_at,
    expires_at: row.expires_at,
  };
}

/**
 * 刷新会话最后活跃时间（用于"记住我"滑续）
 * @param sessionToken 会话 token
 */
export async function updateLastActive(sessionToken: string): Promise<void> {
  await db.run(
    'UPDATE cookie SET last_active_at = ? WHERE session_token = ?',
    new Date().toISOString(),
    sessionToken
  );
}

/**
 * 删除指定会话（登出时调用）
 * @param sessionToken 会话 token
 */
export async function deleteSession(sessionToken: string): Promise<void> {
  await db.run('DELETE FROM cookie WHERE session_token = ?', sessionToken);
}

/**
 * 清理所有过期会话（绝对过期或不活跃过期）
 * @returns 实际删除的行数
 */
export async function cleanupExpired(): Promise<number> {
  const now = new Date();
  const nowStr = now.toISOString();
  const inactivityLimit = new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.run(
    'DELETE FROM cookie WHERE expires_at < ? OR last_active_at < ?',
    nowStr,
    inactivityLimit
  );

  return result.changes || 0;
}

/**
 * 查询指定用户的全部会话（用于"已登录设备"列表）
 * @param userId 用户 ID
 * @returns 会话列表（IP 已解密）
 */
export async function getUserSessions(userId: string): Promise<Session[]> {
  const rows = await db.all('SELECT * FROM cookie WHERE user_id = ?', userId);

  return rows.map((row) => {
    let ipAddress = '';
    try {
      ipAddress = decrypt(row.encrypted_ip);
    } catch {
      ipAddress = 'encrypted';
    }

    return {
      id: row.id,
      user_id: row.user_id,
      session_token: row.session_token,
      ip_address: ipAddress,
      created_at: row.created_at,
      last_active_at: row.last_active_at,
      expires_at: row.expires_at,
    };
  });
}

/**
 * 删除指定用户的全部会话（修改密码、注销账号时调用）
 * @param userId 用户 ID
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  await db.run('DELETE FROM cookie WHERE user_id = ?', userId);
}
