/**
 * @file 照片路由集成测试
 * @description 测试照片列表查询、标签查询、图片代理安全检查等核心流程
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

let app: express.Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

  const { initDb } = await import('../../src/db');
  await initDb();

  const photoRoutes = (await import('../../src/routes/photos')).default;

  app = express();
  app.use(express.json());
  app.use('/api/photos', photoRoutes);
});

describe('GET /api/photos', () => {
  it('应返回照片列表', async () => {
    const res = await request(app).get('/api/photos');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('应支持分页参数 page 和 limit', async () => {
    const res = await request(app)
      .get('/api/photos')
      .query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    if (res.body.data.length > 0) {
      expect(res.body.data.length).toBeLessThanOrEqual(10);
    }
  });

  it('应支持标签筛选', async () => {
    const res = await request(app)
      .get('/api/photos')
      .query({ tags: '风景' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('应支持搜索关键词', async () => {
    const res = await request(app)
      .get('/api/photos')
      .query({ search: '测试' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('应正确处理无效分页参数', async () => {
    const res = await request(app)
      .get('/api/photos')
      .query({ page: -1, limit: 0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/photos/tags', () => {
  it('应返回标签列表', async () => {
    const res = await request(app).get('/api/photos/tags');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/photos/image/* 安全检查', () => {
  it('应在请求不存在的图片时返回占位图', async () => {
    const res = await request(app)
      .get('/api/photos/image/nonexistent-key-12345.jpg');

    // 应返回占位图或 404，不应 500
    expect(res.status).toBeLessThan(500);
  });

  it('应在 photoId 指向不存在的照片时继续处理', async () => {
    const res = await request(app)
      .get('/api/photos/image/some-key.jpg')
      .query({ photoId: 'nonexistent-id' });

    expect(res.status).toBeLessThan(500);
  });

  it('应正确处理 URL 编码的 OSS Key', async () => {
    const encodedKey = encodeURIComponent('photos/thumbnails/001.jpg');
    const res = await request(app)
      .get(`/api/photos/image/${encodedKey}`);

    expect(res.status).toBeLessThan(500);
  });
});

describe('POST /api/photos/upload/complete', () => {
  it('应在缺少 key 参数时返回 400', async () => {
    const res = await request(app)
      .post('/api/photos/upload/complete')
      .send({
        title: '测试照片',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Key');
  });
});
