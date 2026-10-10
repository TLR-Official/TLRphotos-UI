/**
 * @file comments-api 集成测试（V3.0.0）
 * @description 通用评论路由与管理端评论端点 HTTP 全链路：
 *              TR-5.1 鉴权/参数校验/状态码与错误码；旧评论端点已移除
 *              TR-5.2 归档签名 URL 404/200；管理员 pin/unpin 与删除审计
 *              测试库经 DB_PATH 隔离；用户删除的人机门以"注入 tokens / 不注入"两个应用覆盖，
 *              归档索引仅作签名读取，不触真实 OSS 上传。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

const dbBase = path.join(__dirname, '../../data/test-comments-api.db');

/** 清空测试库文件；完整 schema 由 initDb 在 beforeAll 中创建 */
function resetDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbBase + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

resetDb();

let db: import('../../src/db').Database;
/** 全量应用：用户删除门注入测试 tokens 旁路 */
let app: express.Application;
/** 严格应用：不注入 tokens，用于断言人机门 403 */
let strictApp: express.Application;
/** 旧路由应用：验证旧评论端点已移除 */
let legacyApp: express.Application;

let tokenU1: string;
let tokenU2: string;
let tokenU3: string;
let adminToken: string;

beforeAll(async () => {
  process.env.DB_PATH = dbBase;
  process.env.JWT_SECRET = 'test-jwt-secret-api';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-api-secret-0123456789abcdef';
  process.env.TEST_BYPASS_TOKEN = 'test-api-bypass-token';
  process.env.OSS_BUCKET = 'test-bucket';
  process.env.OSS_REGION = 'oss-cn-hongkong';
  process.env.OSS_ENDPOINT = 'https://oss-cn-hongkong.aliyuncs.com';
  process.env.OSS_ACCESS_KEY_ID = 'test-access-key';
  process.env.OSS_ACCESS_KEY_SECRET = 'test-access-secret';
  delete process.env.COMMENT_RETAIN_DAYS;

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;

  // 插入测试用户（u3 邮箱未确权）、照片、文章（完整表结构，其余列走默认）
  await db.run(
    `INSERT INTO users (id, email, password_hash, username, is_active, email_verified)
     VALUES (?, ?, ?, ?, 1, ?)`,
    ['u1', 'u1@example.com', 'h', '用户甲', 1]
  );
  await db.run(
    `INSERT INTO users (id, email, password_hash, username, is_active, email_verified)
     VALUES (?, ?, ?, ?, 1, ?)`,
    ['u2', 'u2@example.com', 'h', '用户乙', 1]
  );
  await db.run(
    `INSERT INTO users (id, email, password_hash, username, is_active, email_verified)
     VALUES (?, ?, ?, ?, 1, ?)`,
    ['u3', 'u3@example.com', 'h', '用户丙', 0]
  );
  await db.run(
    "INSERT INTO photos (id, title, thumbnail_path, original_url) VALUES ('p1', 't', 't', 'o')"
  );
  await db.run(
    "INSERT INTO articles (id, title, content_path, author) VALUES ('a1', 't', 'p', '作者')"
  );

  const commentsRoutes = (await import('../../src/routes/comments')).default;
  const adminCommentsRoutes = (await import('../../src/routes/adminComments')).default;
  const articlesRoutes = (await import('../../src/routes/articles')).default;

  const buildApp = (withBypass: boolean) => {
    const a = express();
    a.use(express.json());
    if (withBypass) {
      a.use((req, _res, next) => {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
        req.body.tokens = 'test-api-bypass-token';
        next();
      });
    }
    a.use('/api/admin/comments', adminCommentsRoutes);
    a.use('/api/comments', commentsRoutes);
    return a;
  };

  app = buildApp(true);
  strictApp = buildApp(false);

  legacyApp = express();
  legacyApp.use(express.json());
  legacyApp.use('/api/articles', articlesRoutes);

  tokenU1 = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET!);
  tokenU2 = jwt.sign({ userId: 'u2' }, process.env.JWT_SECRET!);
  tokenU3 = jwt.sign({ userId: 'u3' }, process.env.JWT_SECRET!);

  // 管理员与签发 token
  const { signAdminToken } = await import('../../src/services/adminService');
  await db.run(
    `INSERT INTO admin_users (id, username, password_hash, name, role, zone, is_active,
       must_change_password, token_version, created_at, updated_at)
     VALUES ('admin1', 'admin1', 'h', '管理员', 'super', 'all', 1, 0, 1, ?, ?)`,
    [new Date().toISOString(), new Date().toISOString()]
  );
  const admin = (await db.get('SELECT * FROM admin_users WHERE id = ?', ['admin1'])) as Parameters<
    typeof signAdminToken
  >[0];
  adminToken = signAdminToken(admin);
});

describe('TR-5.1 GET /api/comments 列表', () => {
  it('正常返回 L1 分页结构（items/archiveThreads/分页字段）', async () => {
    const res = await request(app)
      .get('/api/comments')
      .query({ subject_type: 'photo', subject_id: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(Array.isArray(res.body.data.archiveThreads)).toBe(true);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('缺 subject_type → 400 INVALID_PARAMS', async () => {
    const res = await request(app).get('/api/comments').query({ subject_id: 'p1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PARAMS');
  });

  it('非法 subject_type → 400', async () => {
    const res = await request(app)
      .get('/api/comments')
      .query({ subject_type: 'video', subject_id: 'p1' });
    expect(res.status).toBe(400);
  });

  it('空 subject_id → 400', async () => {
    const res = await request(app)
      .get('/api/comments')
      .query({ subject_type: 'photo', subject_id: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('TR-5.1 POST /api/comments 发表', () => {
  it('匿名 → 401 AUTH_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/comments')
      .send({ subject_type: 'photo', subject_id: 'p1', content: '匿名评论' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('未邮箱确权用户 → 403 EMAIL_VERIFICATION_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU3}`)
      .send({ subject_type: 'photo', subject_id: 'p1', content: '未确权评论' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('主题不存在 → 404 SUBJECT_NOT_FOUND', async () => {
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'no-photo', content: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SUBJECT_NOT_FOUND');
  });

  it('空内容 → 400 COMMENT_CONTENT_EMPTY；超 1000 字 → 400 TOO_LONG', async () => {
    const empty = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'p1', content: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('COMMENT_CONTENT_EMPTY');

    const long = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'p1', content: 'a'.repeat(1001) });
    expect(long.status).toBe(400);
    expect(long.body.code).toBe('COMMENT_CONTENT_TOO_LONG');
  });

  it('全链路：发表 L1 → L2 → L3（连续再回复 depth 封顶为 3）', async () => {
    const root = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'p1', content: 'L1 主评论' });
    expect(root.status).toBe(201);
    expect(root.body.data.depth).toBe(1);
    const rootId = root.body.data.id;

    const reply2 = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU2}`)
      .send({ subject_type: 'photo', subject_id: 'p1', parent_id: rootId, content: 'L2 回复' });
    expect(reply2.body.data.depth).toBe(2);

    const reply3 = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({
        subject_type: 'photo',
        subject_id: 'p1',
        parent_id: reply2.body.data.id,
        content: 'L3 回复',
      });
    expect(reply3.body.data.depth).toBe(3);
    expect(reply3.body.data.reply_to_user_name).toBe('用户乙');

    // 对 depth=3 再回复：depth 仍为 3，永不出现 4
    const replyFlat = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU2}`)
      .send({
        subject_type: 'photo',
        subject_id: 'p1',
        parent_id: reply3.body.data.id,
        content: 'L3 平铺回复',
      });
    expect(replyFlat.body.data.depth).toBe(3);
    expect(replyFlat.body.data.reply_to_user_name).toBe('用户甲');
  });

  it('跨主题回复 → 400 PARENT_SUBJECT_MISMATCH', async () => {
    // 取照片 p1 上一个 L1，尝试以 article 主题回复
    const list = await request(app)
      .get('/api/comments')
      .query({ subject_type: 'photo', subject_id: 'p1' });
    const someRoot = list.body.data.items[0].id;

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'article', subject_id: 'a1', parent_id: someRoot, content: '跨主题' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PARENT_SUBJECT_MISMATCH');
  });

  it('回复不存在 parent → 404 PARENT_NOT_FOUND', async () => {
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'p1', parent_id: 'missing', content: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PARENT_NOT_FOUND');
  });
});

describe('TR-5.1 回复二次加载与点赞', () => {
  it('不存在 root 的 replies → 404 COMMENT_NOT_FOUND', async () => {
    const res = await request(app).get('/api/comments/missing-root/replies');
    expect(res.status).toBe(404);
  });

  it('点赞不存在评论 → 404；点赞/重复/取消点赞计数与状态正确', async () => {
    const missing = await request(app)
      .post('/api/comments/no-such/like')
      .set('Authorization', `Bearer ${tokenU1}`);
    expect(missing.status).toBe(404);

    const list = await request(app)
      .get('/api/comments')
      .query({ subject_type: 'photo', subject_id: 'p1' });
    const target = list.body.data.items[0].id;

    const liked = await request(app)
      .post(`/api/comments/${target}/like`)
      .set('Authorization', `Bearer ${tokenU1}`);
    expect(liked.status).toBe(200);
    expect(liked.body.data.like_count).toBeGreaterThanOrEqual(1);
    expect(liked.body.data.is_liked).toBe(true);

    // 重复点赞幂等
    const again = await request(app)
      .post(`/api/comments/${target}/like`)
      .set('Authorization', `Bearer ${tokenU1}`);
    expect(again.body.data.like_count).toBe(liked.body.data.like_count);

    const unliked = await request(app)
      .delete(`/api/comments/${target}/like`)
      .set('Authorization', `Bearer ${tokenU1}`);
    expect(unliked.body.data.is_liked).toBe(false);
    expect(unliked.body.data.like_count).toBe(liked.body.data.like_count - 1);
  });
});

describe('TR-5.1 DELETE 删除权限与人机门', () => {
  it('非作者 → 403 COMMENT_DELETE_FORBIDDEN', async () => {
    // u1 建楼，u2 尝试删除 L1
    const root = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'article', subject_id: 'a1', content: 'u1 的楼' });

    // 用带 tokens 旁路的应用：越过人机门后到达领域权限检查
    const res = await request(app)
      .delete(`/api/comments/${root.body.data.id}`)
      .set('Authorization', `Bearer ${tokenU2}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMENT_DELETE_FORBIDDEN');
  });

  it('本人删除但无人机验证状态 → 403 HUMAN_VERIFICATION_REQUIRED', async () => {
    const root = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'article', subject_id: 'a1', content: '待本人删' });

    const res = await request(strictApp)
      .delete(`/api/comments/${root.body.data.id}`)
      .set('Authorization', `Bearer ${tokenU1}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HUMAN_VERIFICATION_REQUIRED');
  });

  it('本人删除（tokens 旁路）→ 200，整楼消失', async () => {
    const root = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'article', subject_id: 'a1', content: '本人删除楼' });

    const res = await request(app)
      .delete(`/api/comments/${root.body.data.id}`)
      .set('Authorization', `Bearer ${tokenU1}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deletedThread).toBe(true);
    expect(res.body.data.removedCount).toBe(1);

    const row = await db.get('SELECT id FROM comments WHERE id = ?', [root.body.data.id]);
    expect(row).toBeUndefined();
  });
});

describe('TR-5.2 归档签名 URL', () => {
  it('归档不存在 → 404 ARCHIVE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/comments/archives/missing-root/url');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ARCHIVE_NOT_FOUND');
  });

  it('归档索引存在 → 200 返回可读取签名 URL 与元信息', async () => {
    // 直接写归档索引（URL 端点只校验索引并签名，不验证对象存在）
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO comment_archives
         (root_id, subject_type, subject_id, oss_key, archived_at, root_created_at,
          reply_count, heat_tier, last_reply_at)
       VALUES ('archived-root-1', 'photo', 'p1', 'comments-archive/archived-root-1.json',
               ?, ?, 3, 'normal', ?)`,
      [now, now, now]
    );

    const res = await request(app).get('/api/comments/archives/archived-root-1/url');
    expect(res.status).toBe(200);
    expect(res.body.data.url.startsWith('http')).toBe(true);
    expect(res.body.data.reply_count).toBe(3);
    expect(res.body.data.archived_at).toBe(now);
  });
});

describe('TR-5.2 管理员 pin/unpin', () => {
  it('未带管理员 token → 401', async () => {
    const res = await request(app).put('/api/admin/comments/any-root/pin').send({ pinned: true });
    expect(res.status).toBe(401);
  });

  it('不存在线程 → 404 COMMENT_NOT_FOUND', async () => {
    const res = await request(app)
      .put('/api/admin/comments/no-such-root/pin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pinned: true });
    expect(res.status).toBe(404);
  });

  it('置顶 → pinned=1 且有审计；取消置顶 → pinned=0', async () => {
    const root = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'p1', content: '待置顶' });

    const pin = await request(app)
      .put(`/api/admin/comments/${root.body.data.id}/pin`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pinned: true });
    expect(pin.status).toBe(200);
    expect(pin.body.data.pinned).toBe(true);

    const heatRow = (await db.get('SELECT pinned FROM comment_heat WHERE root_id = ?', [
      root.body.data.id,
    ])) as { pinned: number };
    expect(heatRow.pinned).toBe(1);

    const log = await db.get(
      "SELECT action FROM admin_logs WHERE action = 'comment_pin' AND target_id = ?",
      [root.body.data.id]
    );
    expect(log).not.toBeUndefined();

    // 缺省 body 也视为置顶（幂等）；显式 false 取消
    const unpin = await request(app)
      .put(`/api/admin/comments/${root.body.data.id}/pin`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pinned: false });
    expect(unpin.body.data.pinned).toBe(false);
    const heatRow2 = (await db.get('SELECT pinned FROM comment_heat WHERE root_id = ?', [
      root.body.data.id,
    ])) as { pinned: number };
    expect(heatRow2.pinned).toBe(0);
  });
});

describe('TR-5.2 管理员删除与审计', () => {
  it('管理员删除任意评论：200 + admin_logs 留痕', async () => {
    const root = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU2}`)
      .send({ subject_type: 'photo', subject_id: 'p1', content: '管理员删除楼' });
    await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenU1}`)
      .send({ subject_type: 'photo', subject_id: 'p1', parent_id: root.body.data.id, content: 'L2' });

    const res = await request(app)
      .delete(`/api/admin/comments/${root.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deletedThread).toBe(true);
    expect(res.body.data.removedCount).toBe(2);

    const log = (await db.get(
      "SELECT details FROM admin_logs WHERE action = 'comment_delete' AND target_id = ?",
      [root.body.data.id]
    )) as { details: string };
    expect(log).not.toBeUndefined();
    expect(JSON.parse(log.details)).toMatchObject({ deletedThread: true, removedCount: 2 });
  });

  it('管理员删除无 token → 401', async () => {
    const res = await request(app).delete('/api/admin/comments/whatever');
    expect(res.status).toBe(401);
  });
});

describe('TR-5.1 旧评论端点移除', () => {
  it('GET /api/articles/:id/comments → 404（已由通用 /api/comments 取代）', async () => {
    const res = await request(legacyApp).get('/api/articles/a1/comments');
    expect(res.status).toBe(404);
  });
});
