import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';
const SALT_ROUNDS = 10;

export interface User {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface LoginResult {
  user: User;
  token: string;
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

export async function login(email: string, password: string): Promise<LoginResult> {
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

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username || null,
      avatar_url: user.avatar_url || null,
      is_active: user.is_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    token,
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
  const user = await db.get('SELECT id, email, username, avatar_url, is_active, created_at, updated_at FROM users WHERE id = ?', userId);
  return user ? (user as User) : null;
}