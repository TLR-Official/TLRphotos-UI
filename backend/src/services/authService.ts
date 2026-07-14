import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { createSession, deleteUserSessions } from './cookieService';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';
const SALT_ROUNDS = 10;

export interface User {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  custom_fields: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface LoginResult {
  user: User;
  token: string;
  session_token?: string;
}

export async function register(email: string, password: string, username?: string): Promise<User> {
  const existingUser = await db.get('SELECT id FROM users WHERE email = ?', email);
  if (existingUser) {
    throw new Error('邮箱已被注册');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = `user_${Date.now()}`;

  await db.run(
    'INSERT INTO users (id, email, password_hash, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    email,
    passwordHash,
    username || null,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const newUser = await db.get('SELECT id, email, username, avatar_url, is_active, created_at, updated_at FROM users WHERE id = ?', userId);
  return newUser as User;
}

export async function login(email: string, password: string, remember?: boolean, ipAddress?: string): Promise<LoginResult> {
  const user = await db.get('SELECT id, email, password_hash, username, avatar_url, is_active, created_at, updated_at FROM users WHERE email = ?', email);
  
  if (!user) {
    throw new Error('邮箱或密码错误');
  }

  if (!user.is_active) {
    throw new Error('用户已被禁用');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error('邮箱或密码错误');
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  let session_token: string | undefined;
  if (remember && ipAddress) {
    session_token = await createSession(user.id, ipAddress);
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username || null,
      avatar_url: user.avatar_url || null,
      bio: null,
      phone: null,
      website: null,
      location: null,
      custom_fields: null,
      is_active: user.is_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    token,
    session_token,
  };
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch {
    return null;
  }
}

export async function getUserById(userId: string): Promise<User | null> {
  const user = await db.get('SELECT id, email, username, avatar_url, bio, phone, website, location, custom_fields, is_active, created_at, updated_at FROM users WHERE id = ?', userId);
  return user ? (user as User) : null;
}

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