import { db } from '../db';
import { encrypt, decrypt } from '../utils/crypto';
import crypto from 'crypto';

const MAX_AGE_DAYS = 30;
const INACTIVITY_DAYS = 7;

export interface Session {
  id: string;
  user_id: string;
  session_token: string;
  ip_address: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

export async function createSession(userId: string, ipAddress: string): Promise<string> {
  const sessionToken = crypto.randomBytes(32).toString('hex');
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

export async function getSession(sessionToken: string): Promise<Session | null> {
  const row = await db.get('SELECT * FROM cookie WHERE session_token = ?', sessionToken);
  
  if (!row) {
    return null;
  }
  
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  const lastActiveAt = new Date(row.last_active_at);
  
  const isExpiredByTime = now > expiresAt;
  const isExpiredByInactivity = now.getTime() > lastActiveAt.getTime() + INACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  
  if (isExpiredByTime || isExpiredByInactivity) {
    await deleteSession(sessionToken);
    return null;
  }
  
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

export async function updateLastActive(sessionToken: string): Promise<void> {
  await db.run(
    'UPDATE cookie SET last_active_at = ? WHERE session_token = ?',
    new Date().toISOString(),
    sessionToken
  );
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await db.run('DELETE FROM cookie WHERE session_token = ?', sessionToken);
}

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

export async function deleteUserSessions(userId: string): Promise<void> {
  await db.run('DELETE FROM cookie WHERE user_id = ?', userId);
}
