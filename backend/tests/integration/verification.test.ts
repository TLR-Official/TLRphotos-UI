/**
 * @file 人机验证流程集成测试（V1.8.0）
 * @description 覆盖 Cloudflare Turnstile 人机验证核心链路：
 *              1. 高危操作 fail-closed 拦截（未验证 + 未携带 tokens → 拒绝）
 *              2. 测试环境 tokens 参数合法绕过（NODE_ENV=test + TEST_BYPASS_TOKEN 匹配）
 *              3. 168h 验证状态：已验证用户免重复验证、状态可查询、verify 端点可刷新
 *              4. 退出登录验证状态立即失效
 *              5. IP 绑定：IP 变更后验证状态立即失效
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

const BYPASS_TOKEN = 'test-verification-bypass';

/** 无注入应用：走真实验证门（Turnstile 未配置 → fail-closed 拒绝） */
let appGate: express.Application;
/** 注入 tokens 的应用：测试环境合法绕过，用于建立正常流程数据 */
let appBypass: express.Application;

let token = '';
let sessionToken = '';

beforeAll(async () => {
  const testDbPath = path.join(__dirname, '../../data/test-verification-database.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  process.env.DB_PATH = testDbPath;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.TEST_BYPASS_TOKEN = BYPASS_TOKEN;
  // 显式移除 Turnstile 配置，验证 fail-closed 行为（vitest 不加载 .env，防御性兜底）
  delete process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_HOSTNAMES;

  const { initDb } = await import('../../src/db');
  await initDb();

  const authRoutes = (await import('../../src/routes/auth')).default;
  const verificationRoutes = (await import('../../src/routes/verification')).default;

  appGate = express();
  appGate.use(express.json());
  appGate.use('/api/auth', authRoutes);
  appGate.use('/api/verification', verificationRoutes);

  appBypass = express();
  appBypass.use(express.json());
  appBypass.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = BYPASS_TOKEN;
    next();
  });
  appBypass.use('/api/auth', authRoutes);
  appBypass.use('/api/verification', verificationRoutes);
});

describe('高危操作 fail-closed 验证门', () => {
  it('注册未携带 tokens 且 Turnstile 未配置时应被拦截（fail-closed）', async () => {
    const res = await request(appGate)
      .post('/api/auth/register')
      .send({ email: `gate-${Date.now()}@example.com`, password: 'Test123456' });

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('HUMAN_VERIFICATION_REQUIRED');
    // Turnstile 未配置时 siteverify 前置检查返回 503；配置存在但校验失败为 403
    expect([403, 503]).toContain(res.status);
  });

  it('登录在无验证状态且未携带 tokens 时应被拦截（fail-closed）', async () => {
    // 先经绕过通道准备用户（注册不建立验证状态）
    const reg = await request(appBypass)
      .post('/api/auth/register')
      .send({ email: 'gate-login@example.com', password: 'Test123456', username: 'gateuser' });
    expect(reg.status).toBe(201);

    const res = await request(appGate)
      .post('/api/auth/login')
      .send({ email: 'gate-login@example.com', password: 'Test123456' });

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('HUMAN_VERIFICATION_REQUIRED');
  });
});

describe('tokens 绕过与验证状态生命周期', () => {
  it('携带 tokens 注册并登录成功，登录即建立 168h 验证状态', async () => {
    const reg = await request(appBypass)
      .post('/api/auth/register')
      .send({ email: 'bypass@example.com', password: 'Test123456', username: 'bypassuser' });
    expect(reg.status).toBe(201);

    const login = await request(appBypass)
      .post('/api/auth/login')
      .send({ email: 'bypass@example.com', password: 'Test123456', remember: true });
    expect(login.status).toBe(200);
    expect(login.body.data.token).toBeTruthy();
    expect(login.body.data.session_token).toBeTruthy();

    token = login.body.data.token;
    sessionToken = login.body.data.session_token;
  });

  it('168h 内已验证用户未登出且 IP 未变时无需重复验证即可再次登录', async () => {
    // appGate 不注入 tokens：能成功登录说明验证门因有效验证状态放行
    const res = await request(appGate)
      .post('/api/auth/login')
      .send({ email: 'bypass@example.com', password: 'Test123456', remember: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/verification/status 返回已验证状态与到期时间', async () => {
    const res = await request(appBypass)
      .get('/api/verification/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.verified_at).toBeTruthy();
    expect(res.body.data.expires_at).toBeTruthy();
  });

  it('POST /api/verification/verify 携带 tokens 校验通过并刷新状态', async () => {
    const res = await request(appBypass)
      .post('/api/verification/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'photo_upload' });

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
  });

  it('POST /api/verification/verify 非法 action 返回 400', async () => {
    const res = await request(appBypass)
      .post('/api/verification/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'not_an_action' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('未登录调用验证接口返回 401', async () => {
    const res = await request(appBypass).get('/api/verification/status');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('退出登录后验证状态立即失效', async () => {
    const logout = await request(appBypass)
      .post('/api/auth/logout')
      .set('x-session-token', sessionToken);
    expect(logout.status).toBe(200);

    // JWT 仍有效（loadAuthUser 仅校验 JWT），但验证状态已被登出清除
    const res = await request(appBypass)
      .get('/api/verification/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(false);
  });

  it('验证状态绑定 IP：IP 变更后立即失效', async () => {
    // 重新登录建立状态
    const login = await request(appBypass)
      .post('/api/auth/login')
      .send({ email: 'bypass@example.com', password: 'Test123456', remember: true });
    expect(login.status).toBe(200);
    token = login.body.data.token;

    // 直接改库模拟 IP 变更
    const dbModule = await import('../../src/db');
    await dbModule.db.run("UPDATE user_verifications SET ip = '203.0.113.9'");

    const res = await request(appBypass)
      .get('/api/verification/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(false);
  });
});
