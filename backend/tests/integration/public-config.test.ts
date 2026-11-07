/**
 * @file 公开配置接口集成测试（V4.10.1）
 * @description 验证高德地图 Key 的运行时下发：未配置返回 null、配置后原样返回、
 *              且响应只包含两个公开字段，不泄露其他环境变量。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

let app: express.Application;

beforeAll(async () => {
  const { default: publicConfigRouter } = await import('../../src/routes/publicConfig');
  app = express();
  app.use('/api/config', publicConfigRouter);
});

afterEach(() => {
  delete process.env.AMAP_JS_KEY;
  delete process.env.AMAP_JS_SECURITY_CODE;
});

describe('GET /api/config/public', () => {
  it('未配置时应返回 null', async () => {
    const res = await request(app).get('/api/config/public');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amap_js_key).toBeNull();
    expect(res.body.data.amap_security_code).toBeNull();
  });

  it('配置后应原样返回 Key 与安全密钥', async () => {
    process.env.AMAP_JS_KEY = 'test-amap-key';
    process.env.AMAP_JS_SECURITY_CODE = 'test-amap-security';

    const res = await request(app).get('/api/config/public');

    expect(res.status).toBe(200);
    expect(res.body.data.amap_js_key).toBe('test-amap-key');
    expect(res.body.data.amap_security_code).toBe('test-amap-security');
  });

  it('响应只应包含两个公开字段', async () => {
    process.env.AMAP_JS_KEY = 'test-amap-key';
    process.env.JWT_SECRET = 'should-not-leak';

    const res = await request(app).get('/api/config/public');

    expect(Object.keys(res.body.data).sort()).toEqual(['amap_js_key', 'amap_security_code']);
    expect(JSON.stringify(res.body)).not.toContain('should-not-leak');
  });
});
