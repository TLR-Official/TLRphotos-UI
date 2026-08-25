/**
 * @file 照片路由集成测试
 * @description 测试照片列表查询、标签查询、图片代理安全检查等核心流程
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../../src/db';

let app: express.Application;

// 测试用户 ID 与对应的 JWT token
const TEST_USER_A = 'test-user-a-001';
const TEST_USER_B = 'test-user-b-002';
let tokenA: string;
let tokenB: string;
// 测试目标 photo id（运行时从已有 mock 数据中取一条）
let testPhotoId: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

  const { initDb } = await import('../../src/db');
  await initDb();

  const photoRoutes = (await import('../../src/routes/photos')).default;

  app = express();
  app.use(express.json());
  app.use('/api/photos', photoRoutes);

  // 用与 photos.ts 相同的 JWT_SECRET 签发测试 token
  tokenA = jwt.sign({ userId: TEST_USER_A }, process.env.JWT_SECRET!);
  tokenB = jwt.sign({ userId: TEST_USER_B }, process.env.JWT_SECRET!);

  // 取一条已审核照片作为测试目标，确保详情接口能返回
  const photo = await db.get<{ id: string }>("SELECT id FROM photos WHERE status = 'approved' LIMIT 1");
  if (!photo) throw new Error('测试数据库中没有已审核照片，无法执行统计/点赞测试');
  testPhotoId = photo.id;

  // 清理该照片上测试用户的历史点赞/浏览记录，保证测试初始状态干净
  await db.run('DELETE FROM photo_likes WHERE photo_id = ? AND user_id IN (?, ?)', testPhotoId, TEST_USER_A, TEST_USER_B);
  await db.run('DELETE FROM photo_views WHERE photo_id = ? AND viewer_key IN (?, ?)', testPhotoId, `user:${TEST_USER_A}`, `user:${TEST_USER_B}`);
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

// ============================================================================
// 图片统计与点赞 — V1.4.0 新增
// 覆盖：浏览去重（登录 user_id + 未登录 IP + 24h 窗口）、点赞强制登录、幂等、并发一致性
// ============================================================================

describe('图片统计与点赞', () => {
  it('未登录用户 GET /:id 应按 IP 去重，24h 内重复访问只 +1', async () => {
    // 清理该 IP 历史记录，保证测试从干净状态开始（避免之前测试运行残留）
    await db.run('DELETE FROM photo_views WHERE photo_id = ? AND viewer_key = ?', testPhotoId, 'ip:203.0.113.1');

    // 先取初始 views 数（详情接口内部会触发一次计数）
    const initial = await db.get<{ views: number }>('SELECT views FROM photos WHERE id = ?', testPhotoId);

    // 第一次访问：应该 +1（首次 IP）
    const res1 = await request(app)
      .get(`/api/photos/${testPhotoId}`)
      .set('X-Forwarded-For', '203.0.113.1'); // 模拟 Nginx 反代后的真实 IP
    expect(res1.status).toBe(200);
    expect(res1.body.data.views).toBe(initial.views + 1);

    // 第二次访问（同 IP，24h 内）：不应 +1
    const res2 = await request(app)
      .get(`/api/photos/${testPhotoId}`)
      .set('X-Forwarded-For', '203.0.113.1');
    expect(res2.body.data.views).toBe(initial.views + 1); // 仍是 +1，未再自增

    // 手动将 last_viewed_at 改为 25h 前，模拟窗口过期
    const oldTs = Date.now() - 25 * 60 * 60 * 1000;
    await db.run(
      "UPDATE photo_views SET last_viewed_at = ? WHERE photo_id = ? AND viewer_key = ?",
      oldTs, testPhotoId, 'ip:203.0.113.1'
    );

    // 第三次访问（窗口已过期）：应该 +1
    const res3 = await request(app)
      .get(`/api/photos/${testPhotoId}`)
      .set('X-Forwarded-For', '203.0.113.1');
    expect(res3.body.data.views).toBe(initial.views + 2);
  });

  it('登录用户 GET /:id 应按 user_id 去重', async () => {
    const initial = await db.get<{ views: number }>('SELECT views FROM photos WHERE id = ?', testPhotoId);

    // 第一次访问（带 JWT）
    const res1 = await request(app)
      .get(`/api/photos/${testPhotoId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res1.body.data.views).toBe(initial.views + 1);

    // 第二次访问（同 user，24h 内）：不应 +1
    const res2 = await request(app)
      .get(`/api/photos/${testPhotoId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res2.body.data.views).toBe(initial.views + 1);
  });

  it('GET /:id 响应包含 is_liked 字段：登录已点赞返回 true，未登录返回 false', async () => {
    // 未登录：is_liked 应为 false
    const res1 = await request(app).get(`/api/photos/${testPhotoId}`);
    expect(res1.body.data).toHaveProperty('is_liked');
    expect(res1.body.data.is_liked).toBe(false);

    // 用户 A 点赞
    await request(app)
      .post(`/api/photos/${testPhotoId}/like`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // 用户 A 查询详情：is_liked 应为 true
    const res2 = await request(app)
      .get(`/api/photos/${testPhotoId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res2.body.data.is_liked).toBe(true);

    // 清理点赞以便后续测试
    await request(app)
      .delete(`/api/photos/${testPhotoId}/like`)
      .set('Authorization', `Bearer ${tokenA}`);
  });

  it('未登录 POST /:id/like 返回 401 + code: AUTH_REQUIRED', async () => {
    const res = await request(app)
      .post(`/api/photos/${testPhotoId}/like`)
      .send({ userId: 'anonymous' }); // body 不再被使用，应被忽略

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('登录用户 POST /:id/like 第一次 +1，第二次幂等不变', async () => {
    const initial = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', testPhotoId);

    // 第一次点赞：likes +1，is_liked=true
    const res1 = await request(app)
      .post(`/api/photos/${testPhotoId}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res1.status).toBe(200);
    expect(res1.body.data.likes).toBe(initial.likes + 1);
    expect(res1.body.data.is_liked).toBe(true);

    // 第二次点赞（幂等）：likes 不变，is_liked=true
    const res2 = await request(app)
      .post(`/api/photos/${testPhotoId}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res2.body.data.likes).toBe(initial.likes + 1);
    expect(res2.body.data.is_liked).toBe(true);

    // 数据库 photo_likes 中应只有一条记录
    const likeRows = await db.all(
      'SELECT * FROM photo_likes WHERE photo_id = ? AND user_id = ?',
      testPhotoId, TEST_USER_B
    );
    expect(likeRows.length).toBe(1);
  });

  it('登录用户 DELETE /:id/like 已点赞时 -1，未点赞幂等不变', async () => {
    // 前置：用户 B 在上一用例中已点赞
    const initial = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', testPhotoId);

    // 取消点赞：likes -1，is_liked=false
    const res1 = await request(app)
      .delete(`/api/photos/${testPhotoId}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res1.status).toBe(200);
    expect(res1.body.data.likes).toBe(initial.likes - 1);
    expect(res1.body.data.is_liked).toBe(false);

    // 再次取消（幂等）：likes 不变
    const res2 = await request(app)
      .delete(`/api/photos/${testPhotoId}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res2.body.data.likes).toBe(initial.likes - 1);
    expect(res2.body.data.is_liked).toBe(false);

    // photo_likes 中应无记录
    const likeRows = await db.all(
      'SELECT * FROM photo_likes WHERE photo_id = ? AND user_id = ?',
      testPhotoId, TEST_USER_B
    );
    expect(likeRows.length).toBe(0);
  });

  it('并发点赞：100 个并发请求，最终 likes 数 == photo_likes 唯一行数', async () => {
    // 用 100 个不同用户 ID 并发点赞同一照片
    const userIds = Array.from({ length: 100 }, (_, i) => `concurrent-user-${i}`);
    const tokens = userIds.map(uid => jwt.sign({ userId: uid }, process.env.JWT_SECRET!));

    // 清理可能的历史记录
    await db.run(
      `DELETE FROM photo_likes WHERE photo_id = ? AND user_id IN (${userIds.map(() => '?').join(',')})`,
      testPhotoId, ...userIds
    );

    const initial = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', testPhotoId);

    // 并发发送 100 个点赞请求
    const responses = await Promise.all(
      tokens.map(t => request(app)
        .post(`/api/photos/${testPhotoId}/like`)
        .set('Authorization', `Bearer ${t}`)
      )
    );

    // 全部应成功
    responses.forEach(res => expect(res.status).toBe(200));

    // 最终 likes 数应等于初始值 + 100
    const finalPhoto = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', testPhotoId);
    expect(finalPhoto.likes).toBe(initial.likes + 100);

    // photo_likes 唯一行数应等于 100
    const likeCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM photo_likes WHERE photo_id = ?',
      testPhotoId
    );
    expect(likeCount.count).toBe(100);

    // 清理并发测试的点赞记录
    await db.run(`DELETE FROM photo_likes WHERE photo_id = ? AND user_id IN (${userIds.map(() => '?').join(',')})`,
      testPhotoId, ...userIds);
    await db.run('UPDATE photos SET likes = ? WHERE id = ?', initial.likes, testPhotoId);
  });

  it('POST /:id/view 响应包含 counted 字段，且 24h 内重复请求只计 1 次', async () => {
    // 清理 IP 历史记录
    await db.run('DELETE FROM photo_views WHERE photo_id = ? AND viewer_key = ?', testPhotoId, 'ip:198.51.100.1');

    const initial = await db.get<{ views: number }>('SELECT views FROM photos WHERE id = ?', testPhotoId);

    // 第一次：counted=true
    const res1 = await request(app)
      .post(`/api/photos/${testPhotoId}/view`)
      .set('X-Forwarded-For', '198.51.100.1');
    expect(res1.status).toBe(200);
    expect(res1.body.data.counted).toBe(true);
    expect(res1.body.data.views).toBe(initial.views + 1);

    // 第二次（同 IP，24h 内）：counted=false
    const res2 = await request(app)
      .post(`/api/photos/${testPhotoId}/view`)
      .set('X-Forwarded-For', '198.51.100.1');
    expect(res2.body.data.counted).toBe(false);
    expect(res2.body.data.views).toBe(initial.views + 1); // 未自增

    // 清理
    await db.run('DELETE FROM photo_views WHERE photo_id = ? AND viewer_key = ?', testPhotoId, 'ip:198.51.100.1');
    await db.run('UPDATE photos SET views = ? WHERE id = ?', initial.views, testPhotoId);
  });
});
