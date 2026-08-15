/**
 * @file 认证路由集成测试
 * @description 测试用户注册、登录、登出、获取当前用户信息等核心认证流程
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

// 测试用 Express 应用
let app: express.Application;

// 测试前初始化数据库和路由
beforeAll(async () => {
  // 使用测试数据库
  const testDbPath = path.join(__dirname, '../../data/test-database.db');

  // 删除旧的测试数据库
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // 设置环境变量
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

  // 动态导入以使用正确的环境变量
  const { initDb } = await import('../../src/db');
  await initDb();

  const authRoutes = (await import('../../src/routes/auth')).default;

  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

describe('POST /api/auth/register', () => {
  it('应成功注册新用户', async () => {
    const uniqueEmail = `test-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail,
        password: 'Test123456',
        username: 'testuser',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.email).toBe(uniqueEmail);
    expect(res.body.data.username).toBe('testuser');
    // 不应返回密码
    expect(res.body.data).not.toHaveProperty('password_hash');
  });

  it('应拒绝缺少邮箱的注册', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        password: 'Test123456',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('应拒绝缺少密码的注册', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `test2-${Date.now()}@example.com`,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('应拒绝重复邮箱注册', async () => {
    const dupEmail = `dup-${Date.now()}@example.com`;
    // 先注册一个用户
    await request(app)
      .post('/api/auth/register')
      .send({
        email: dupEmail,
        password: 'Test123456',
        username: 'user1',
      });

    // 再用相同邮箱注册
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: dupEmail,
        password: 'Test123456',
        username: 'user2',
      });

    expect(res.body.success).toBe(false);
  });

  it('应允许不提供用户名注册', async () => {
    const uniqueEmail = `nousername-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail,
        password: 'Test123456',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    // 注册测试用户
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'login@example.com',
        password: 'Test123456',
        username: 'loginuser',
      });
  });

  it('应成功登录并返回 token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'Test123456',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data.user.email).toBe('login@example.com');
  });

  it('应拒绝错误密码', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'WrongPassword',
      });

    expect(res.body.success).toBe(false);
  });

  it('应拒绝不存在的用户', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nonexistent@example.com',
        password: 'Test123456',
      });

    expect(res.body.success).toBe(false);
  });

  it('应拒绝缺少邮箱的登录', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        password: 'Test123456',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/auth/me', () => {
  it('应在携带有效 token 时返回当前用户信息', async () => {
    // 先登录获取 token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'Test123456',
      });

    const token = loginRes.body.data.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('login@example.com');
  });

  it('应在无 token 时返回 401', async () => {
    const res = await request(app)
      .get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('应在 token 无效时返回 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('应在 token 格式错误时返回 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'InvalidFormat token');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('应成功登出', async () => {
    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('应在携带 session token 时登出并清除会话', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('x-session-token', 'some-session-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
