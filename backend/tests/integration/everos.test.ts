/**
 * @file EverOS 记忆层集成测试（V1.9.0）
 * @description 覆盖 /api/everos/memory 与 /api/everos/search 两个端点：
 *              1. 未配置 EVEROS_API_KEY → 503 快速失败
 *              2. 未登录 → 401
 *              3. 参数校验（content / role / method / top_k）
 *              4. 写入请求体契约：sender_id=userId、timestamp 毫秒、project_id、async_mode
 *              5. 检索响应信封映射（episodes/profiles/unprocessed_messages）
 *              6. EverOS 非 2xx 错误状态码与消息透传
 *
 *              外部 HTTP 全程通过 vi.stubGlobal 模拟 fetch，测试不依赖真实网络。
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

// V1.11.0：注册需验证码；Spug 通道打桩捕获明文码，不占用 fetchMock 也不触达真实网络
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

const BYPASS_TOKEN = 'test-everos-bypass';

let app: express.Application;
let appNoKey: express.Application;
let authToken = '';
let userId = '';

const fetchMock = vi.fn();

/** 构造模拟的 EverOS JSON 信封响应 */
function mockEnvelope(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ request_id: 'req_test', data }),
  };
}

beforeAll(async () => {
  const testDbPath = path.join(__dirname, '../../data/test-everos-database.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  process.env.DB_PATH = testDbPath;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.TEST_BYPASS_TOKEN = BYPASS_TOKEN;
  process.env.EVEROS_API_KEY = 'test-everos-key';
  delete process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_HOSTNAMES;

  vi.stubGlobal('fetch', fetchMock);

  const { initDb } = await import('../../src/db');
  await initDb();

  const authRoutes = (await import('../../src/routes/auth')).default;
  const everosRoutes = (await import('../../src/routes/everos')).default;

  app = express();
  app.use(express.json());
  // 仅对 auth 路由注入测试绕过 tokens，everos 路由走真实 JWT 鉴权
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/auth') && (!req.body || typeof req.body !== 'object')) {
      req.body = {};
    }
    if (req.path.startsWith('/api/auth')) {
      req.body = { ...(req.body || {}), tokens: BYPASS_TOKEN };
    }
    next();
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/everos', everosRoutes);

  // 已配置 Key 的应用共用同一路由模块；未配置场景通过临时清空环境变量验证
  appNoKey = app;

  // 注册并登录获取真实 JWT（V1.11.0：先经 otp/send 取码，再携带验证码注册）
  const email = `everos-${Date.now()}@example.com`;
  const send = await request(app).post('/api/auth/otp/send').send({ target: email, scene: 'register' });
  expect(send.status).toBe(200);
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'Test123456', username: 'everosuser', code: otpCapture.codes.get(email) });
  expect(reg.status).toBe(201);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'Test123456', remember: true });
  expect(login.status).toBe(200);
  authToken = login.body.data.token;

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${authToken}`);
  userId = me.body.data.id;
});

beforeEach(() => {
  fetchMock.mockReset();
  process.env.EVEROS_API_KEY = 'test-everos-key';
});

describe('配置与鉴权', () => {
  it('未配置 EVEROS_API_KEY 时写入返回 503', async () => {
    delete process.env.EVEROS_API_KEY;
    const res = await request(appNoKey)
      .post('/api/everos/memory')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: '测试记忆' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未登录写入返回 401', async () => {
    const res = await request(app).post('/api/everos/memory').send({ content: '测试记忆' });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未登录检索返回 401', async () => {
    const res = await request(app).post('/api/everos/search').send({ query: '关键词' });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('参数校验', () => {
  it('content 缺失或为空返回 400', async () => {
    const res = await request(app)
      .post('/api/everos/memory')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: '   ' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非法 role 返回 400', async () => {
    const res = await request(app)
      .post('/api/everos/memory')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: '测试', role: 'admin' });

    expect(res.status).toBe(400);
  });

  it('检索 top_k 越界返回 400', async () => {
    const res = await request(app)
      .post('/api/everos/search')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: '关键词', top_k: 200 });

    expect(res.status).toBe(400);
  });

  it('非法 method 返回 400', async () => {
    const res = await request(app)
      .post('/api/everos/search')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: '关键词', method: 'magic' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/everos/memory 写入契约', () => {
  it('用户轮次：请求体符合 v2 add 契约（sender_id=用户ID、毫秒时间戳、project_id）', async () => {
    fetchMock.mockResolvedValue(mockEnvelope({ message_count: 1, status: 'queued' }, 202));
    const before = Date.now();

    const res = await request(app)
      .post('/api/everos/memory')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ session_id: 'sess_test_1', content: '我喜欢黑白摄影', role: 'user' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('queued');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.evermind.ai/api/v2/memory/add');
    expect(options.headers.Authorization).toBe('Bearer test-everos-key');

    const body = JSON.parse(options.body);
    expect(body.session_id).toBe('sess_test_1');
    expect(body.project_id).toBe('tlrphotos');
    expect(body.async_mode).toBe(true);
    expect(body.messages).toHaveLength(1);
    const msg = body.messages[0];
    expect(msg.sender_id).toBe(userId);
    expect(msg.role).toBe('user');
    expect(typeof msg.timestamp).toBe('number');
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(String(msg.timestamp).length).toBe(13); // unix 毫秒
    expect(msg.content).toBe('我喜欢黑白摄影');
  });

  it('助手轮次使用固定 sender_id，缺省 session_id 按用户派生', async () => {
    fetchMock.mockResolvedValue(mockEnvelope({ message_count: 1, status: 'queued' }, 202));

    const res = await request(app)
      .post('/api/everos/memory')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: '好的，已记录你的偏好', role: 'assistant' });

    expect(res.status).toBe(200);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.session_id).toBe(`session_${userId}`);
    expect(body.messages[0].sender_id).toBe('tlrphotos_assistant');
    expect(body.messages[0].role).toBe('assistant');
  });
});

describe('POST /api/everos/search 检索映射', () => {
  it('检索响应映射为 episodes/profiles/unprocessed_messages', async () => {
    fetchMock.mockResolvedValue(
      mockEnvelope({
        episodes: [{ id: 'ep1', summary: '用户偏好黑白摄影', score: 0.91 }],
        profiles: [{ profile_data: { style: 'mono' } }],
        unprocessed_messages: [{ id: 'raw1', content: '最新一条' }],
      })
    );

    const res = await request(app)
      .post('/api/everos/search')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: '摄影偏好', method: 'hybrid', top_k: 5, include_profile: true });

    expect(res.status).toBe(200);
    expect(res.body.data.episodes).toHaveLength(1);
    expect(res.body.data.episodes[0].id).toBe('ep1');
    expect(res.body.data.profiles).toHaveLength(1);
    expect(res.body.data.unprocessed_messages).toHaveLength(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      query: '摄影偏好',
      user_id: userId,
      project_id: 'tlrphotos',
      method: 'hybrid',
      top_k: 5,
      include_profile: true,
    });
  });

  it('EverOS 返回 401 时状态码与错误消息透传', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ detail: 'Invalid API key' }),
    });

    const res = await request(app)
      .post('/api/everos/search')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: '测试' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid API key');
  });
});
