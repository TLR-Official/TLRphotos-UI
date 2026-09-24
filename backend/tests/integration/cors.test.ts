/**
 * @file CORS 白名单集成测试（V1.10.1 安全回归 ID:3/6/7）
 * @description 验证跨域策略：非白名单来源不获 ACAO、白名单来源回显、方法仅实际使用集合。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { corsWhitelist } from '../../src/middleware/corsWhitelist';
import { errorHandler } from '../../src/middleware/errorHandler';

let app: express.Application;

beforeAll(() => {
  app = express();
  app.use(corsWhitelist);
  app.get('/ping', (req, res) => res.json({ ok: true }));
  app.post('/ping', (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
});

describe('CORS 白名单', () => {
  it('非白名单 Origin 的简单请求不返回 Access-Control-Allow-Origin', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body.code).toBe('CORS_BLOCKED');
  });

  it('白名单 Origin 回显该来源', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://tlrphotos.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://tlrphotos.com');
  });

  it('无 Origin 请求（同源/服务端）正常放行', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('预检仅允许实际注册的方法（不含 PATCH）', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://admin.tlrphotos.com')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(res.headers['access-control-allow-methods']).not.toMatch(/PATCH/);
  });

  it('非白名单预检不通过', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
