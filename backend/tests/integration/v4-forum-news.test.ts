/**
 * @file V4.0.0 论坛治理 + 新闻区集成测试
 * @description 覆盖模块二（论坛治理）与模块三（新闻区）后端：
 *              - 角色体系扩展：forum_moderator 论坛管理权边界（可删评论/删帖，不可审核照片/管用户）、
 *                zone_master 创建新角色子账号被拒
 *              - 板块收敛：initDb 幂等 seed 三大板块（航空/铁路/公路）、创建第 4 板块 400 BOARD_LIMITED、
 *                基础板块删除保护 BOARD_PROTECTED、重复创建幂等
 *              - 新闻区：news_editor 创建/编辑/删除（授权确认、板块白名单、照片存在性校验）、
 *                公开列表与详情（配图代理 URL、copyright_notice）、文章 board_id 筛选
 *              - 论坛回复通知：二级回复产生 forum_reply、自回复不产生、photo 场景通用生效
 *              模式照抄 v4.test.ts：DB_PATH 测试库隔离 + TEST_BYPASS_TOKEN 人机验证绕过 + 直插 fixture。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

let app: express.Application;

// ── 测试账号 ────────────────────────────────────────────────────────────────
// USER_A：发帖者/回复者；USER_B：评论者/被回复人
const TEST_USER_A = 'v4fns-user-a';
const TEST_USER_B = 'v4fns-user-b';
let tokenA: string;
let tokenB: string;

// ── 管理员 ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN_ID = 'v4fns-super';
const ZONE_MASTER_ID = 'v4fns-zone-master';
const ZONE_AUDITOR_ID = 'v4fns-zone-auditor';
const FORUM_MOD_ID = 'v4fns-forum-mod';
const NEWS_EDITOR_ID = 'v4fns-news-editor';
let superAdminToken: string;
let zoneMasterToken: string;
let zoneAuditorToken: string;
let forumModToken: string;
let newsEditorToken: string;

// ── fixture 照片 ID ─────────────────────────────────────────────────────────
const PHOTO_NEWS_1 = 'v4fns-photo-1'; // approved，新闻首图
const PHOTO_NEWS_2 = 'v4fns-photo-2'; // approved，PUT 换图用
const PHOTO_PENDING = 'v4fns-photo-pending'; // pending，审核越权测试

// ── 新闻/帖子 ID（运行时生成） ──────────────────────────────────────────────
let newsId: string;
const createdNewsIds: string[] = []; // afterAll 清理正文文件用
let threadId: string; // 回复通知主帖

// db 句柄在 initDb 后动态获取，避免模块顶层 import 时读错 DB_PATH
let db: import('../../src/db').Database;

/** 插入照片 fixture 的最小字段 */
async function insertPhoto(opts: { id: string; title: string; status: string; user_id: string | null }) {
  await db.run(
    `INSERT OR REPLACE INTO photos
       (id, title, thumbnail_path, preview_url, original_url, status, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.id,
    opts.title,
    `photos/thumbnails/${opts.id}.webp`,
    `photos/previews/${opts.id}.webp`,
    `photos/original/${opts.id}.jpg`,
    opts.status,
    opts.user_id,
    new Date().toISOString()
  );
}

/** 查询某用户某类型通知数量 */
async function countNotifications(userId: string, type: string): Promise<number> {
  const row = await db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = ?',
    userId, type
  );
  return row?.c ?? 0;
}

beforeAll(async () => {
  // 测试库隔离，避免测试数据写进生产 database.db
  const testDbPath = path.join(__dirname, '../../data/test-v4-forum-news-database.db');
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
  }
  process.env.DB_PATH = testDbPath;

  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  // 管理员 JWT 密钥要求 trim 后 ≥32 字符
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-0123456789abcdef';
  // 测试环境人机验证绕过：isTestBypass 仅在 NODE_ENV=test 且令牌完全匹配时放行
  process.env.TEST_BYPASS_TOKEN = 'test-verification-bypass';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;

  const adminRoutes = (await import('../../src/routes/admin')).default;
  const adminForumRoutes = (await import('../../src/routes/adminForum')).default;
  const adminCommentsRoutes = (await import('../../src/routes/adminComments')).default;
  const commentsRoutes = (await import('../../src/routes/comments')).default;
  const forumRoutes = (await import('../../src/routes/forum')).default;
  const notificationsRoutes = (await import('../../src/routes/notifications')).default;
  const newsPublicRoutes = (await import('../../src/routes/news')).default;
  const { adminNewsRouter } = await import('../../src/routes/news');
  const articlesRoutes = (await import('../../src/routes/articles')).default;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  // 管理端具体路径先于 /api/admin 挂载（与 server.ts 同序）
  app.use('/api/admin/comments', adminCommentsRoutes);
  app.use('/api/admin/news', adminNewsRouter);
  app.use('/api/admin', adminRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/forum', forumRoutes);
  app.use('/api/admin/forum', adminForumRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/news', newsPublicRoutes);
  app.use('/api/articles', articlesRoutes);

  // 用与 photos.ts 相同的 JWT_SECRET 签发测试 token
  tokenA = jwt.sign({ userId: TEST_USER_A }, process.env.JWT_SECRET!);
  tokenB = jwt.sign({ userId: TEST_USER_B }, process.env.JWT_SECRET!);

  // 站点测试用户：is_active=1、邮箱已确权（requireVerifiedEmail 与 loadAuthUser 查 users 表）
  for (const u of [
    { id: TEST_USER_A, email: 'v4fns-a@test.local', username: 'V4UserA' },
    { id: TEST_USER_B, email: 'v4fns-b@test.local', username: 'V4UserB' },
  ]) {
    await db.run(
      'INSERT OR REPLACE INTO users (id, email, password_hash, username, is_active, banned_at, can_upload, can_view, can_download, can_like, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, 1, 1, 1, 1, 1, ?, ?)',
      u.id, u.email, '$2b$10$placeholderhashplaceholderhashplaceholderhashplaceholder', u.username,
      new Date().toISOString(), new Date().toISOString()
    );
  }

  // 管理员五角色：must_change_password=0 跳过强制改密门，经 /api/admin/login 签发 JWT
  const bcrypt = (await import('bcrypt')).default;
  const hash = await bcrypt.hash('V4FnsAdmin123456', 10);
  const admins = [
    { id: SUPER_ADMIN_ID, username: 'v4fnssuper', role: 'super', zone: null, name: 'V4超级管理员' },
    { id: ZONE_MASTER_ID, username: 'v4fnszmaster', role: 'zone_master', zone: 'landscape', name: 'V4分区总审核' },
    { id: ZONE_AUDITOR_ID, username: 'v4fnszauditor', role: 'zone_auditor', zone: 'landscape', name: 'V4分区审核员' },
    { id: FORUM_MOD_ID, username: 'v4fnsforummod', role: 'forum_moderator', zone: null, name: 'V4论坛管理员' },
    { id: NEWS_EDITOR_ID, username: 'v4fnsnewseditor', role: 'news_editor', zone: null, name: 'V4新闻编辑' },
  ];
  for (const a of admins) {
    await db.run(
      `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, datetime('now'), datetime('now'))`,
      a.id, a.username, hash, a.name, a.role, a.zone
    );
  }

  const loginTokens: Record<string, string> = {};
  for (const a of admins) {
    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: a.username, password: 'V4FnsAdmin123456' });
    expect(login.status).toBe(200);
    loginTokens[a.role] = login.body.token as string;
  }
  superAdminToken = loginTokens['super'];
  zoneMasterToken = loginTokens['zone_master'];
  zoneAuditorToken = loginTokens['zone_auditor'];
  forumModToken = loginTokens['forum_moderator'];
  newsEditorToken = loginTokens['news_editor'];

  // ── 插入照片 fixture ──────────────────────────────────────────────────────
  await insertPhoto({ id: PHOTO_NEWS_1, title: '新闻配图一', status: 'approved', user_id: TEST_USER_A });
  await insertPhoto({ id: PHOTO_NEWS_2, title: '新闻配图二', status: 'approved', user_id: TEST_USER_A });
  await insertPhoto({ id: PHOTO_PENDING, title: '待审核照片', status: 'pending', user_id: TEST_USER_A });

  // ── 发一帖作为回复通知主帖（顺带验证 seed 出的航空板块可用） ─────────────
  const threadRes = await request(app)
    .post('/api/forum/threads')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ board_id: 'aviation', title: '论坛回复通知测试帖', content_md: '正文内容' });
  expect(threadRes.status).toBe(201);
  threadId = threadRes.body.data.id;
});

afterAll(async () => {
  // 清理测试期间写入的新闻正文 Markdown 文件，避免污染仓库 articles/news 目录
  for (const id of createdNewsIds) {
    try {
      fs.unlinkSync(path.join(__dirname, '../../../articles/news', `${id}.md`));
    } catch {
      // 文件不存在：忽略
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 角色体系扩展（模块二）
// ═══════════════════════════════════════════════════════════════════════════
describe('角色体系扩展（V4.0.0）', () => {
  it('zone_master 尝试创建 forum_moderator 子账号应返回 403', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${zoneMasterToken}`)
      .send({
        username: 'v4fns-fm-attempt',
        password: 'Attempt123456',
        email: 'v4fns-fm-attempt@test.local',
        role: 'forum_moderator',
        zone: 'landscape',
      });
    expect(res.status).toBe(403);
    // 确认未真正落库
    const row = await db.get('SELECT id FROM admin_users WHERE username = ?', 'v4fns-fm-attempt');
    expect(row).toBeUndefined();
  });

  it('forum_moderator 可删除任意评论（200）', async () => {
    const commentRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ subject_type: 'thread', subject_id: threadId, content: '待论坛管理员删除的评论' });
    expect(commentRes.status).toBe(201);

    const res = await request(app)
      .delete(`/api/admin/comments/${commentRes.body.data.id}`)
      .set('Authorization', `Bearer ${forumModToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('forum_moderator 可删除帖子（200）', async () => {
    const threadRes = await request(app)
      .post('/api/forum/threads')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ board_id: 'aviation', title: '待论坛管理员删除的帖子', content_md: '正文' });
    expect(threadRes.status).toBe(201);

    const res = await request(app)
      .delete(`/api/admin/forum/threads/${threadRes.body.data.id}`)
      .set('Authorization', `Bearer ${forumModToken}`);
    expect(res.status).toBe(200);
    const gone = await db.get('SELECT id FROM forum_threads WHERE id = ?', threadRes.body.data.id);
    expect(gone).toBeUndefined();
  });

  it('forum_moderator 不可审核照片（PUT /photos/:id/approve → 403）', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${PHOTO_PENDING}/approve`)
      .set('Authorization', `Bearer ${forumModToken}`);
    expect(res.status).toBe(403);
    // 照片状态未被改动
    const photo = await db.get<{ status: string }>('SELECT status FROM photos WHERE id = ?', PHOTO_PENDING);
    expect(photo?.status).toBe('pending');
  });

  it('forum_moderator 不可访问用户管理（GET /admin/users → 403）', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${forumModToken}`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 板块收敛（模块二）
// ═══════════════════════════════════════════════════════════════════════════
describe('板块收敛（V4.0.0）', () => {
  it('initDb 后应存在且仅存在 航空/铁路/公路 三大板块', async () => {
    const res = await request(app).get('/api/forum/boards');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    const names = res.body.data.map((b: any) => b.name).sort();
    expect(names).toEqual(['公路', '航空', '铁路'].sort());
    const ids = res.body.data.map((b: any) => b.id).sort();
    expect(ids).toEqual(['aviation', 'railway', 'road'].sort());
  });

  it('创建第 4 个板块应返回 400 BOARD_LIMITED', async () => {
    const res = await request(app)
      .post('/api/admin/forum/boards')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ id: 'shipping', name: '船舶', description: '不应被创建' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOARD_LIMITED');
  });

  it('重复创建三大板块应幂等返回且不产生重复行', async () => {
    const res = await request(app)
      .post('/api/admin/forum/boards')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ id: 'whatever', name: '航空' });
    expect(res.status).toBe(200);
    expect(res.body.data.existed).toBe(true);

    const count = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM forum_boards');
    expect(count?.c).toBe(3);
  });

  it('删除三大基础板块应返回 400 BOARD_PROTECTED', async () => {
    const res = await request(app)
      .delete('/api/admin/forum/boards/aviation')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOARD_PROTECTED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 新闻区管理端（模块三）
// ═══════════════════════════════════════════════════════════════════════════
describe('新闻区管理端（V4.0.0）', () => {
  it('news_editor 创建合法新闻应返回 201 且 news_images 落库', async () => {
    const res = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({
        title: '首批航空新闻：注册号检索上线',
        content: '正文第一段\n\n正文第二段',
        board_id: 'aviation',
        images: [{ photo_id: PHOTO_NEWS_1, authorization_confirmed: true }],
      });
    expect(res.status).toBe(201);
    newsId = res.body.data.id;
    createdNewsIds.push(newsId);

    const article = await db.get<{ type: string; board_id: string; author: string }>(
      'SELECT type, board_id, author FROM articles WHERE id = ?',
      newsId
    );
    expect(article?.type).toBe('news');
    expect(article?.board_id).toBe('aviation');
    // 作者关联当前管理员（articles.author 存管理员展示名）
    expect(article?.author).toBe('V4新闻编辑');

    const imgCount = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM news_images WHERE article_id = ?',
      newsId
    );
    expect(imgCount?.c).toBe(1);
  });

  it('配图未勾选授权应返回 400 AUTHORIZATION_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({
        title: '未授权配图新闻',
        content: '正文',
        board_id: 'aviation',
        images: [{ photo_id: PHOTO_NEWS_1, authorization_confirmed: false }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTHORIZATION_REQUIRED');
  });

  it('非航空板块应返回 400 BOARD_NOT_ALLOWED', async () => {
    const res = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({
        title: '铁路板块新闻',
        content: '正文',
        board_id: 'railway',
        images: [{ photo_id: PHOTO_NEWS_1, authorization_confirmed: true }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOARD_NOT_ALLOWED');
  });

  it('配图照片不存在应返回 400 PHOTO_INVALID', async () => {
    const res = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({
        title: '幽灵配图新闻',
        content: '正文',
        board_id: 'aviation',
        images: [{ photo_id: 'no-such-photo', authorization_confirmed: true }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PHOTO_INVALID');
  });

  it('zone_auditor 创建新闻应返回 403', async () => {
    const res = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({
        title: '越权新闻',
        content: '正文',
        board_id: 'aviation',
        images: [{ photo_id: PHOTO_NEWS_1, authorization_confirmed: true }],
      });
    expect(res.status).toBe(403);
  });

  it('forum_moderator 创建新闻应返回 403（新闻编辑权不外溢）', async () => {
    const res = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${forumModToken}`)
      .send({
        title: '论坛管理员越权新闻',
        content: '正文',
        board_id: 'aviation',
        images: [{ photo_id: PHOTO_NEWS_1, authorization_confirmed: true }],
      });
    expect(res.status).toBe(403);
  });

  it('PUT 编辑新闻更换配图应全删全插', async () => {
    const res = await request(app)
      .put(`/api/admin/news/${newsId}`)
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({
        title: '首批航空新闻：注册号检索上线（修订）',
        content: '修订后的正文',
        board_id: 'aviation',
        images: [
          { photo_id: PHOTO_NEWS_2, authorization_confirmed: true },
          { photo_id: PHOTO_NEWS_1, authorization_confirmed: true },
        ],
      });
    expect(res.status).toBe(200);

    const imgs = await db.all<{ photo_id: string; sort_order: number }>(
      'SELECT photo_id, sort_order FROM news_images WHERE article_id = ? ORDER BY sort_order ASC',
      newsId
    );
    expect(imgs.length).toBe(2);
    expect(imgs[0].photo_id).toBe(PHOTO_NEWS_2); // 首图已更换
    expect(imgs[1].photo_id).toBe(PHOTO_NEWS_1);
  });

  it('管理列表应返回新闻条目并附带配图数（仅 super/news_editor）', async () => {
    const editorRes = await request(app)
      .get('/api/admin/news')
      .set('Authorization', `Bearer ${newsEditorToken}`);
    expect(editorRes.status).toBe(200);
    expect(editorRes.body.data.total).toBeGreaterThanOrEqual(1);
    const item = editorRes.body.data.items.find((i: any) => i.id === newsId);
    expect(item.image_count).toBe(2);

    const auditorRes = await request(app)
      .get('/api/admin/news')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);
    expect(auditorRes.status).toBe(403);
  });

  it('DELETE 删除新闻应级联清理 news_images', async () => {
    // 先建一条专门用于删除的新闻
    const createRes = await request(app)
      .post('/api/admin/news')
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({
        title: '待删除新闻',
        content: '正文',
        board_id: 'aviation',
        images: [{ photo_id: PHOTO_NEWS_1, authorization_confirmed: true }],
      });
    expect(createRes.status).toBe(201);
    const delId = createRes.body.data.id;
    createdNewsIds.push(delId);

    const delRes = await request(app)
      .delete(`/api/admin/news/${delId}`)
      .set('Authorization', `Bearer ${newsEditorToken}`);
    expect(delRes.status).toBe(200);

    const imgCount = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM news_images WHERE article_id = ?',
      delId
    );
    expect(imgCount?.c).toBe(0);
    const article = await db.get('SELECT id FROM articles WHERE id = ?', delId);
    expect(article).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 新闻区公开端（模块三）
// ═══════════════════════════════════════════════════════════════════════════
describe('新闻区公开端（V4.0.0）', () => {
  it('公开列表应返回 id/title/board_id/author_name/created_at/封面代理 URL', async () => {
    const res = await request(app).get('/api/news');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    const item = res.body.data.items.find((i: any) => i.id === newsId);
    expect(item).toBeTruthy();
    expect(item.title).toContain('注册号检索上线');
    expect(item.board_id).toBe('aviation');
    expect(item.author_name).toBe('V4新闻编辑');
    expect(item.created_at).toBeTruthy();
    // 封面为首图代理 URL（preview_url 存在 → 优先预览图）
    expect(item.cover_image).toContain('/api/photos/image/');
    expect(item.cover_image).toContain(`photoId=${PHOTO_NEWS_2}`);
  });

  it('公开详情应含 images 数组与 copyright_notice', async () => {
    const res = await request(app).get(`/api/news/${newsId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toContain('注册号检索上线');

    const images = res.body.data.images;
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBe(2);
    expect(images[0].photo_id).toBe(PHOTO_NEWS_2);
    expect(images[0].title).toBe('新闻配图二');
    expect(images[0].thumbnail_url).toContain('/api/photos/image/');
    expect(images[0].preview_url).toContain('/api/photos/image/');

    // 版权声明由后端拼好：@{作者名} ©TLRphotos {当前年} 版权所有
    expect(res.body.data.copyright_notice).toBe(
      `@V4新闻编辑 ©TLRphotos ${new Date().getFullYear()} 版权所有`
    );
  });

  it('访问不存在的新闻应返回 404', async () => {
    const res = await request(app).get('/api/news/no-such-news');
    expect(res.status).toBe(404);
  });

  it('公开文章列表应支持 ?board_id= 筛选', async () => {
    const aviationRes = await request(app).get('/api/articles').query({ board_id: 'aviation' });
    expect(aviationRes.status).toBe(200);
    const aviationIds = aviationRes.body.data.map((a: any) => a.id);
    expect(aviationIds).toContain(newsId);
    // 命中行应携带 type/board_id 字段供前端区分
    const newsRow = aviationRes.body.data.find((a: any) => a.id === newsId);
    expect(newsRow.type).toBe('news');

    const railwayRes = await request(app).get('/api/articles').query({ board_id: 'railway' });
    expect(railwayRes.status).toBe(200);
    expect(railwayRes.body.data.map((a: any) => a.id)).not.toContain(newsId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 论坛回复通知（模块二 Task 5.3 后端侧）
// ═══════════════════════════════════════════════════════════════════════════
describe('论坛回复通知（V4.0.0）', () => {
  it('二级回复应向被回复人产生 forum_reply 通知', async () => {
    // B 在主帖下发 L1 主评论
    const rootRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ subject_type: 'thread', subject_id: threadId, content: 'B 的主评论' });
    expect(rootRes.status).toBe(201);
    const rootId = rootRes.body.data.id;

    const before = await countNotifications(TEST_USER_B, 'forum_reply');

    // A 二级回复 B 的评论
    const replyRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ subject_type: 'thread', subject_id: threadId, parent_id: rootId, content: 'A 回复 B' });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.data.parent_id).toBe(rootId);

    const after = await countNotifications(TEST_USER_B, 'forum_reply');
    expect(after).toBe(before + 1);

    // 通知体格式与跳转字段
    const notice = await db.get<any>(
      "SELECT title, content, related_type, related_id FROM notifications WHERE user_id = ? AND type = 'forum_reply' ORDER BY created_at DESC LIMIT 1",
      TEST_USER_B
    );
    expect(notice.title).toBe('回复 @V4UserA');
    expect(notice.content).toBe('V4UserA 回复了你在《论坛回复通知测试帖》下的评论');
    expect(notice.related_type).toBe('thread');
    expect(notice.related_id).toBe(threadId);
  });

  it('自回复不应产生通知', async () => {
    // B 自己发主评论后自己回复自己
    const rootRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ subject_type: 'thread', subject_id: threadId, content: 'B 的自回复楼' });
    const rootId = rootRes.body.data.id;

    const before = await countNotifications(TEST_USER_B, 'forum_reply');

    const selfReply = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ subject_type: 'thread', subject_id: threadId, parent_id: rootId, content: 'B 回复自己' });
    expect(selfReply.status).toBe(201);

    const after = await countNotifications(TEST_USER_B, 'forum_reply');
    expect(after).toBe(before);
  });

  it('photo 主题的二级回复同样产生 forum_reply（通用实现）', async () => {
    // B 在照片下发主评论，A 回复
    const rootRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ subject_type: 'photo', subject_id: PHOTO_NEWS_1, content: 'B 评照片' });
    expect(rootRes.status).toBe(201);

    const before = await countNotifications(TEST_USER_B, 'forum_reply');

    const replyRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        subject_type: 'photo',
        subject_id: PHOTO_NEWS_1,
        parent_id: rootRes.body.data.id,
        content: 'A 回复照片评论',
      });
    expect(replyRes.status).toBe(201);

    const after = await countNotifications(TEST_USER_B, 'forum_reply');
    expect(after).toBe(before + 1);

    const notice = await db.get<any>(
      "SELECT content, related_type, related_id FROM notifications WHERE user_id = ? AND type = 'forum_reply' ORDER BY created_at DESC LIMIT 1",
      TEST_USER_B
    );
    expect(notice.content).toBe('V4UserA 回复了你在《新闻配图一》下的评论');
    expect(notice.related_type).toBe('photo');
    expect(notice.related_id).toBe(PHOTO_NEWS_1);
  });

  it('通知应出现在被回复人的通知列表中（未读）', async () => {
    const listRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listRes.status).toBe(200);
    const replyNotices = listRes.body.data.filter((n: any) => n.type === 'forum_reply');
    expect(replyNotices.length).toBeGreaterThanOrEqual(2);
    for (const n of replyNotices) {
      expect(n.is_read).toBe(0);
    }
  });
});
