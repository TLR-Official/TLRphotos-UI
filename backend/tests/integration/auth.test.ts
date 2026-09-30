/**
 * @file 认证路由集成测试
 * @description 测试用户注册、登录、登出、获取当前用户信息等核心认证流程
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

// V1.11.0：注册需先经 otp/send 获取验证码；Spug 通道打桩捕获明文码，不触达真实网络
const otpCapture = vi.hoisted(() => ({ codes: new Map<string, string>() }));
vi.mock('../../src/services/spugService', () => ({
  sendSmsCode: vi.fn(async (to: string, code: string) => {
    otpCapture.codes.set(to, code);
  }),
}));

vi.mock('../../src/services/aliMailService', () => ({
  sendMailCode: vi.fn(async (to: string, code: string) => {
    otpCapture.codes.set(to, code);
  }),
}));

// 测试用 Express 应用
let app: express.Application;
let createCodeRecord: typeof import('../../src/services/otpService').createCodeRecord;

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
  // V1.5.1：真正把测试库路径传给 db.ts（dbPath 读 DB_PATH 环境变量），
  // 原 bug：只算了 testDbPath 却没赋值，导致测试用户写进生产 database.db
  process.env.DB_PATH = testDbPath;

  // 动态导入以使用正确的环境变量
  const { initDb } = await import('../../src/db');
  await initDb();

  const authRoutes = (await import('../../src/routes/auth')).default;
  ({ createCodeRecord } = await import('../../src/services/otpService'));

  app = express();
  app.use(express.json());
  // V1.8.0：测试环境人机验证绕过 —— 为请求体注入 tokens 参数，
  // isTestBypass 仅在 NODE_ENV=test 且与 TEST_BYPASS_TOKEN 完全匹配时放行
  process.env.TEST_BYPASS_TOKEN = 'test-verification-bypass';
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  app.use('/api/auth', authRoutes);
});

/** V1.11.0：注册前必须先经 otp/send 获取 6 位验证码（Spug 通道已打桩捕获明文码） */
async function requestRegisterCode(target: string): Promise<string> {
  const res = await request(app).post('/api/auth/otp/send').send({ target, scene: 'register' });
  expect(res.status).toBe(200);
  return otpCapture.codes.get(target)!;
}

describe('POST /api/auth/register', () => {
  it('应成功注册新用户', async () => {
    const uniqueEmail = `test-${Date.now()}@example.com`;
    const code = await requestRegisterCode(uniqueEmail);
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail,
        password: 'Test123456',
        username: 'testuser',
        code,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // V1.11.0：响应结构调整为 data.user + token + session_token
    expect(res.body.data.user).toHaveProperty('id');
    expect(res.body.data.user.email).toBe(uniqueEmail);
    expect(res.body.data.user.username).toBe('testuser');
    expect(res.body.data.token).toBeTruthy();
    // 不应返回密码
    expect(res.body.data.user).not.toHaveProperty('password_hash');
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
    // 先注册一个用户（V1.11.0：携带验证码）
    const code1 = await requestRegisterCode(dupEmail);
    await request(app)
      .post('/api/auth/register')
      .send({
        email: dupEmail,
        password: 'Test123456',
        username: 'user1',
        code: code1,
      });

    // 再用相同邮箱注册：已注册邮箱经 otp/send(register) 取码会 409，
    // 直接写入验证码记录模拟并发间隙，走到底层唯一性校验
    const code2 = await createCodeRecord(dupEmail, 'mail', 'register', '127.0.0.1');
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: dupEmail,
        password: 'Test123456',
        username: 'user2',
        code: code2,
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('应允许不提供用户名注册', async () => {
    const uniqueEmail = `nousername-${Date.now()}@example.com`;
    const code = await requestRegisterCode(uniqueEmail);
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail,
        password: 'Test123456',
        code,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    // 注册测试用户（V1.11.0：需先获取验证码；登录走 tokens 绕过路径直接签发 JWT）
    const code = await requestRegisterCode('login@example.com');
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'login@example.com',
        password: 'Test123456',
        username: 'loginuser',
        code,
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

// V1.10.1 安全回归（ID:5）：非字符串字段不得进入 ORM 绑定，
// 响应不得回显 SQLITE_* 等引擎错误细节
describe('V1.10.1 入口类型校验（ID:5）', () => {
  const badPayloads = [
    { label: 'email 对象', body: { email: { $ne: 'x' }, password: 'x' } },
    { label: 'email 数组', body: { email: ['a@b.com'], password: 'x' } },
    { label: 'email null', body: { email: null, password: 'x' } },
    { label: 'password 对象', body: { email: `x-${Date.now()}@example.com`, password: { x: 1 } } },
  ];

  for (const { label, body } of badPayloads) {
    it(`login 应拒绝${label}且不泄露引擎信息`, async () => {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/SQLITE|column index|errno/i);
    });

    it(`register 应拒绝${label}且不泄露引擎信息`, async () => {
      const res = await request(app).post('/api/auth/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/SQLITE|column index|errno/i);
    });
  }

  it('应拒绝超长 email/password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `${'a'.repeat(260)}@b.com`, password: 'x' });
    expect(res.status).toBe(400);
  });
});
