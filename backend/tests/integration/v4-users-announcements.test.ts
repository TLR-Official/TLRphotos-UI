/**
 * @file V4.1.0 公开用户主页 + 公告横幅集成测试
 * @description 覆盖 Wave 2B 后端三端点与公告路由：
 *              - GET /api/users/:id/profile：公开档案字段齐全且不含 email/IP/banned_until 等管理字段、
 *                is_self 判定（本人返回 pending/rejected 计数）、不存在用户 404 USER_NOT_FOUND、
 *                region「未知」兜底、public_penalties 仅含活跃处罚（revoked/expired 不返回）
 *              - GET /api/users/:id/photos：仅 approved、category 分区筛选、分页、404
 *              - GET /api/users/:id/threads：仅本人已发布帖子、字段正确、404
 *              - GET /api/announcements：仅 is_active=1、下线后消失、不含 created_by
 *              - /api/admin/announcements CRUD：匿名 401、zone_auditor 403 ANNOUNCEMENT_DENIED、
 *                super/news_editor 可管理、字段校验 400、toggle 翻转、删除 404
 *              模式照抄 v4-forum-news.test.ts：DB_PATH 测试库隔离 + TEST_BYPASS_TOKEN 绕过 + 直插 fixture。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

let app: express.Application;

// ── 测试账号 ────────────────────────────────────────────────────────────────
// USER_A：本人视角（is_self）；USER_B：公开主页目标用户（含处罚/作品/帖子）
const TEST_USER_A = 'v4ua-self';
const TEST_USER_B = 'v4ua-public';
let tokenA: string;
let tokenB: string;

// ── 管理员 ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN_ID = 'v4ua-super';
const ZONE_AUDITOR_ID = 'v4ua-zone-auditor';
const NEWS_EDITOR_ID = 'v4ua-news-editor';
let superAdminToken: string;
let zoneAuditorToken: string;
let newsEditorToken: string;

// ── fixture 主键 ────────────────────────────────────────────────────────────
const PHOTO_AVIATION = 'v4ua-photo-aviation'; // approved aviation views=10
const PHOTO_RAILWAY = 'v4ua-photo-railway'; // approved railway views=20
const PHOTO_ROAD = 'v4ua-photo-road'; // approved road views=30
const PHOTO_PENDING = 'v4ua-photo-pending'; // pending（不公开）
const PHOTO_REJECTED = 'v4ua-photo-rejected'; // rejected（不公开）
const THREAD_1 = 'v4ua-thread-1';
const THREAD_2 = 'v4ua-thread-2';
const THREAD_OTHER = 'v4ua-thread-other'; // USER_A 的帖子，不应出现在 USER_B 主页
const PENALTY_ACTIVE = 'v4ua-penalty-active'; // 活跃 L1：应公开
const PENALTY_REVOKED = 'v4ua-penalty-revoked'; // 已撤销：不公开
const PENALTY_EXPIRED = 'v4ua-penalty-expired'; // 已过期：不公开

const DAY_MS = 24 * 60 * 60 * 1000;

// db 句柄在 initDb 后动态获取，避免模块顶层 import 时读错 DB_PATH
let db: import('../../src/db').Database;

/** 插入照片 fixture（含 views/category/status） */
async function insertPhoto(opts: {
  id: string;
  title: string;
  status: string;
  user_id: string;
  category: string;
  views: number;
  createdAt: string;
}) {
  await db.run(
    `INSERT OR REPLACE INTO photos
       (id, title, thumbnail_path, preview_url, original_url, status, user_id, category, views, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.id,
    opts.title,
    `photos/thumbnails/${opts.id}.webp`,
    `photos/previews/${opts.id}.webp`,
    `photos/original/${opts.id}.jpg`,
    opts.status,
    opts.user_id,
    opts.category,
    opts.views,
    opts.createdAt
  );
}

/** 插入论坛帖子 fixture */
async function insertThread(opts: {
  id: string;
  title: string;
  author_id: string;
  author_name: string;
  reply_count: number;
  like_count: number;
  createdAt: string;
}) {
  await db.run(
    `INSERT OR REPLACE INTO forum_threads
       (id, board_id, title, content_md, author_id, author_name, status, reply_count, like_count, created_at, updated_at)
     VALUES (?, ?, ?, '正文', ?, ?, 'published', ?, ?, ?, ?)`,
    opts.id,
    'aviation',
    opts.title,
    opts.author_id,
    opts.author_name,
    opts.reply_count,
    opts.like_count,
    opts.createdAt,
    opts.createdAt
  );
}

/** 插入处罚记录 fixture */
async function insertPenalty(opts: {
  id: string;
  user_id: string;
  level: number;
  reason: string;
  expires_at: string | null;
  revoked_at: string | null;
  createdAt: string;
}) {
  await db.run(
    `INSERT OR REPLACE INTO penalties
       (id, user_id, level, reason, days, expires_at, capabilities, created_by, created_at, revoked_at, revoked_by)
     VALUES (?, ?, ?, ?, NULL, ?, '[]', 'admin-x', ?, ?, NULL)`,
    opts.id,
    opts.user_id,
    opts.level,
    opts.reason,
    opts.expires_at,
    opts.createdAt,
    opts.revoked_at
  );
}

beforeAll(async () => {
  // 测试库隔离，避免测试数据写进生产 database.db
  const testDbPath = path.join(__dirname, '../../data/test-v4-users-announcements-database.db');
  for ( const suffix of ['', '-wal', '-shm']) {
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

  const usersRoutes = (await import('../../src/routes/users')).default;
  const announcementsPublicRoutes = (await import('../../src/routes/announcements')).default;
  const { adminAnnouncementsRouter } = await import('../../src/routes/announcements');
  const adminRoutes = (await import('../../src/routes/admin')).default;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  // 公告管理端先于 /api/admin 挂载（与 server.ts 同序）
  app.use('/api/admin/announcements', adminAnnouncementsRouter);
  app.use('/api/admin', adminRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/announcements', announcementsPublicRoutes);

  // 用与 photos.ts 相同的 JWT_SECRET 签发测试 token
  tokenA = jwt.sign({ userId: TEST_USER_A }, process.env.JWT_SECRET!);
  tokenB = jwt.sign({ userId: TEST_USER_B }, process.env.JWT_SECRET!);

  // 站点测试用户：USER_B region 置 NULL（断言「未知」兜底），USER_A 给定省份
  const tenDaysAgo = new Date(Date.now() - 10 * DAY_MS).toISOString();
  await db.run(
    'INSERT OR REPLACE INTO users (id, email, password_hash, username, avatar_url, region, is_active, banned_at, can_upload, can_view, can_download, can_like, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 1, 1, 1, 1, 1, ?, ?)',
    TEST_USER_A, 'v4ua-a@test.local', '$2b$10$placeholderhashplaceholderhashplaceholderhashplaceholder',
    '主页本人', 'https://cdn.test.local/a.png', '广东', tenDaysAgo, tenDaysAgo
  );
  await db.run(
    'INSERT OR REPLACE INTO users (id, email, password_hash, username, avatar_url, region, is_active, banned_at, can_upload, can_view, can_download, can_like, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, NULL, 1, 1, 1, 1, 1, ?, ?)',
    TEST_USER_B, 'v4ua-b@test.local', '$2b$10$placeholderhashplaceholderhashplaceholderhashplaceholder',
    '公开摄影师', 'https://cdn.test.local/b.png', tenDaysAgo, tenDaysAgo
  );

  // 管理员三角色：must_change_password=0 跳过强制改密门，经 /api/admin/login 签发 JWT
  const bcrypt = (await import('bcrypt')).default;
  const hash = await bcrypt.hash('V4UaAdmin123456', 10);
  const admins = [
    { id: SUPER_ADMIN_ID, username: 'v4uasuper', role: 'super', zone: null, name: 'V4UA超级管理员' },
    { id: ZONE_AUDITOR_ID, username: 'v4uazauditor', role: 'zone_auditor', zone: 'landscape', name: 'V4UA分区审核员' },
    { id: NEWS_EDITOR_ID, username: 'v4uanewseditor', role: 'news_editor', zone: null, name: 'V4UA新闻编辑' },
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
      .send({ username: a.username, password: 'V4UaAdmin123456' });
    expect(login.status).toBe(200);
    loginTokens[a.role] = login.body.token as string;
  }
  superAdminToken = loginTokens['super'];
  zoneAuditorToken = loginTokens['zone_auditor'];
  newsEditorToken = loginTokens['news_editor'];

  // ── 照片 fixture：USER_B 名下 approved×3（覆盖三分区）+ pending/rejected 各 1 ──
  const base = Date.now();
  await insertPhoto({ id: PHOTO_AVIATION, title: '航空作品', status: 'approved', user_id: TEST_USER_B, category: 'aviation', views: 10, createdAt: new Date(base - 3 * DAY_MS).toISOString() });
  await insertPhoto({ id: PHOTO_RAILWAY, title: '铁路作品', status: 'approved', user_id: TEST_USER_B, category: 'railway', views: 20, createdAt: new Date(base - 2 * DAY_MS).toISOString() });
  await insertPhoto({ id: PHOTO_ROAD, title: '公路作品', status: 'approved', user_id: TEST_USER_B, category: 'road', views: 30, createdAt: new Date(base - 1 * DAY_MS).toISOString() });
  await insertPhoto({ id: PHOTO_PENDING, title: '待审作品', status: 'pending', user_id: TEST_USER_B, category: 'aviation', views: 0, createdAt: new Date(base).toISOString() });
  await insertPhoto({ id: PHOTO_REJECTED, title: '未通过作品', status: 'rejected', user_id: TEST_USER_B, category: 'aviation', views: 0, createdAt: new Date(base).toISOString() });

  // ── 帖子 fixture：USER_B×2 + USER_A×1 ─────────────────────────────────────
  await insertThread({ id: THREAD_1, title: 'B 的第一帖', author_id: TEST_USER_B, author_name: '公开摄影师', reply_count: 3, like_count: 5, createdAt: new Date(base - 2 * DAY_MS).toISOString() });
  await insertThread({ id: THREAD_2, title: 'B 的第二帖', author_id: TEST_USER_B, author_name: '公开摄影师', reply_count: 1, like_count: 2, createdAt: new Date(base - 1 * DAY_MS).toISOString() });
  await insertThread({ id: THREAD_OTHER, title: 'A 的帖子', author_id: TEST_USER_A, author_name: '主页本人', reply_count: 0, like_count: 0, createdAt: new Date(base).toISOString() });

  // ── 处罚 fixture：活跃 L1 / 已撤销 / 已过期 ───────────────────────────────
  await insertPenalty({ id: PENALTY_ACTIVE, user_id: TEST_USER_B, level: 1, reason: '首违警告：描述不当', expires_at: null, revoked_at: null, createdAt: new Date(base - DAY_MS).toISOString() });
  await insertPenalty({ id: PENALTY_REVOKED, user_id: TEST_USER_B, level: 1, reason: '已撤销的警告', expires_at: null, revoked_at: new Date(base).toISOString(), createdAt: new Date(base - 2 * DAY_MS).toISOString() });
  await insertPenalty({ id: PENALTY_EXPIRED, user_id: TEST_USER_B, level: 1, reason: '已过期的警告', expires_at: new Date(base - DAY_MS).toISOString(), revoked_at: null, createdAt: new Date(base - 3 * DAY_MS).toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════
// 公开用户主页 /profile
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/users/:id/profile', () => {
  it('匿名访问返回 200：公开字段齐全且不含 email/IP/banned_until 等管理字段', async () => {
    const res = await request(app).get(`/api/users/${TEST_USER_B}/profile`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.id).toBe(TEST_USER_B);
    expect(data.username).toBe('公开摄影师');
    expect(data.avatar_url).toBe('https://cdn.test.local/b.png');
    expect(data.is_self).toBe(false);
    expect(data.approved_count).toBe(3);
    expect(data.total_views).toBe(60); // 10+20+30（仅 approved）
    expect(data.joined_days).toBe(10);
    // 隐私红线：管理/敏感字段一律不出现
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('ip');
    expect(data).not.toHaveProperty('banned_at');
    expect(data).not.toHaveProperty('banned_until');
    expect(data).not.toHaveProperty('can_ban_manage');
    expect(data).not.toHaveProperty('pending_count');
    expect(data).not.toHaveProperty('rejected_count');
    // 活跃处罚仅一条（已撤销/已过期均不返回），且不含 capabilities/revoked 内部字段
    expect(data.public_penalties.length).toBe(1);
    expect(data.public_penalties[0]).toEqual({
      level: 1,
      reason: '首违警告：描述不当',
      expires_at: null,
      created_at: expect.any(String),
    });
  });

  it('本人带 token 访问自己主页：is_self=true 且额外返回 pending/rejected 计数', async () => {
    const res = await request(app)
      .get(`/api/users/${TEST_USER_A}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.is_self).toBe(true);
    expect(data.pending_count).toBe(0);
    expect(data.rejected_count).toBe(0);
    // 本人视角同样不泄露管理字段
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('banned_until');
    // region 已采集时原样返回
    expect(data.region).toBe('广东');
  });

  it('本人 B 访问自己：pending/rejected 计数正确（1 待审 / 1 未通过）', async () => {
    const res = await request(app)
      .get(`/api/users/${TEST_USER_B}/profile`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_self).toBe(true);
    expect(res.body.data.pending_count).toBe(1);
    expect(res.body.data.rejected_count).toBe(1);
  });

  it('他人带 token 访问 B 主页：is_self=false 且无 pending/rejected 计数', async () => {
    const res = await request(app)
      .get(`/api/users/${TEST_USER_B}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.is_self).toBe(false);
    expect(res.body.data).not.toHaveProperty('pending_count');
    expect(res.body.data).not.toHaveProperty('rejected_count');
  });

  it('region 为 NULL 时返回「未知」兜底', async () => {
    const res = await request(app).get(`/api/users/${TEST_USER_B}/profile`);
    expect(res.status).toBe(200);
    expect(res.body.data.region).toBe('未知');
  });

  it('用户不存在应返回 404 USER_NOT_FOUND', async () => {
    const res = await request(app).get('/api/users/no-such-user/profile');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 公开用户作品 /photos
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/users/:id/photos', () => {
  it('仅返回 approved 作品（pending/rejected 不出现），缩略/预览为代理 URL', async () => {
    const res = await request(app).get(`/api/users/${TEST_USER_B}/photos`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    const ids = res.body.data.items.map((p: any) => p.id);
    expect(ids).toContain(PHOTO_AVIATION);
    expect(ids).toContain(PHOTO_RAILWAY);
    expect(ids).toContain(PHOTO_ROAD);
    expect(ids).not.toContain(PHOTO_PENDING);
    expect(ids).not.toContain(PHOTO_REJECTED);

    const first = res.body.data.items[0];
    expect(first.thumbnail_path).toContain('/api/photos/image/');
    expect(first.preview_url).toContain('/api/photos/image/');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('created_at');
    expect(Array.isArray(first.tags)).toBe(true);
  });

  it('category 分区筛选生效（aviation 仅返回航空作品）', async () => {
    const res = await request(app)
      .get(`/api/users/${TEST_USER_B}/photos`)
      .query({ category: 'aviation' });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].id).toBe(PHOTO_AVIATION);
    expect(res.body.data.items[0].category).toBe('aviation');
  });

  it('分页生效：page_size=2&page=2 返回第 3 条（created_at 倒序）', async () => {
    const res = await request(app)
      .get(`/api/users/${TEST_USER_B}/photos`)
      .query({ page: 2, page_size: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.page_size).toBe(2);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.length).toBe(1);
    // 倒序：最新为 road（-1d）→ railway（-2d）→ aviation（-3d），第 2 页首条为 aviation
    expect(res.body.data.items[0].id).toBe(PHOTO_AVIATION);
  });

  it('用户不存在应返回 404', async () => {
    const res = await request(app).get('/api/users/no-such-user/photos');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 公开论坛发帖记录 /threads
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/users/:id/threads', () => {
  it('仅返回该用户已发布帖子且字段正确（created_at 倒序）', async () => {
    const res = await request(app).get(`/api/users/${TEST_USER_B}/threads`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    const ids = res.body.data.items.map((t: any) => t.id);
    expect(ids).toEqual([THREAD_2, THREAD_1]); // 倒序：新的在前
    expect(ids).not.toContain(THREAD_OTHER); // 他人帖子不混入

    const first = res.body.data.items[0];
    expect(first.title).toBe('B 的第二帖');
    expect(first.board_id).toBe('aviation');
    expect(first.reply_count).toBe(1);
    expect(first.like_count).toBe(2);
    expect(first.created_at).toBeTruthy();
  });

  it('用户不存在应返回 404', async () => {
    const res = await request(app).get('/api/users/no-such-user/threads');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 公告公开端
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/announcements', () => {
  let annA: string; // 保持上线
  let annB: string; // 将被下线
  let annC: string; // 将被删除

  it('匿名创建公告应返回 401', async () => {
    const res = await request(app)
      .post('/api/admin/announcements')
      .send({ title: '匿名公告', content: '正文' });
    expect(res.status).toBe(401);
  });

  it('zone_auditor 创建/管理公告应返回 403 ANNOUNCEMENT_DENIED', async () => {
    const postRes = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({ title: '越权公告', content: '正文' });
    expect(postRes.status).toBe(403);
    expect(postRes.body.code).toBe('ANNOUNCEMENT_DENIED');

    const listRes = await request(app)
      .get('/api/admin/announcements')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);
    expect(listRes.status).toBe(403);
    expect(listRes.body.code).toBe('ANNOUNCEMENT_DENIED');
  });

  it('super 与 news_editor 均可创建公告（201，创建即上线）', async () => {
    const superRes = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ title: '站点公测上线公告', content: 'TLRphotos 正式进入公测阶段。', cover_url: 'https://cdn.test.local/cover.png' });
    expect(superRes.status).toBe(201);
    annA = superRes.body.data.id;

    const editorRes = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({ title: '注册号检索优化公告', content: '检索体验优化。' });
    expect(editorRes.status).toBe(201);
    annB = editorRes.body.data.id;

    const row = await db.get<{ is_active: number; created_by: string }>(
      'SELECT is_active, created_by FROM announcements WHERE id = ?',
      annA
    );
    expect(row?.is_active).toBe(1);
    expect(row?.created_by).toBe(SUPER_ADMIN_ID);
  });

  it('title 超长（>100 字）应返回 400 ANNOUNCEMENT_FIELDS_INVALID', async () => {
    const res = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ title: 'x'.repeat(101), content: '正文' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ANNOUNCEMENT_FIELDS_INVALID');
  });

  it('content 为空应返回 400 ANNOUNCEMENT_FIELDS_INVALID', async () => {
    const res = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ title: '无正文公告', content: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ANNOUNCEMENT_FIELDS_INVALID');
  });

  it('cover_url 非 http(s) 开头应返回 400', async () => {
    const res = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ title: '非法封面公告', content: '正文', cover_url: 'ftp://cdn.test.local/x.png' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ANNOUNCEMENT_FIELDS_INVALID');
  });

  it('公开列表仅返回 is_active=1 且不含 created_by 内部字段', async () => {
    const res = await request(app).get('/api/announcements');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((a: any) => a.id);
    expect(ids).toContain(annA);
    expect(ids).toContain(annB);
    for (const item of res.body.data) {
      expect(item).not.toHaveProperty('created_by');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('content');
      expect(item).toHaveProperty('cover_url');
      expect(item).toHaveProperty('created_at');
      expect(item).toHaveProperty('updated_at');
    }
    // 按创建时间倒序：annA 先创建应排在 annB 之后
    expect(ids.indexOf(annA)).toBeGreaterThan(ids.indexOf(annB));
  });

  it('PUT 编辑公告更新内容；编辑不存在的公告返回 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const putRes = await request(app)
      .put(`/api/admin/announcements/${annB}`)
      .set('Authorization', `Bearer ${newsEditorToken}`)
      .send({ title: '注册号检索优化公告（修订）', content: '修订后的正文。', cover_url: '' });
    expect(putRes.status).toBe(200);

    const row = await db.get<{ title: string; content: string; cover_url: string | null }>(
      'SELECT title, content, cover_url FROM announcements WHERE id = ?',
      annB
    );
    expect(row?.title).toBe('注册号检索优化公告（修订）');
    expect(row?.cover_url).toBeNull(); // 空串归一化为 NULL

    const missingRes = await request(app)
      .put('/api/admin/announcements/no-such-ann')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ title: '幽灵公告', content: '正文' });
    expect(missingRes.status).toBe(404);
    expect(missingRes.body.code).toBe('ANNOUNCEMENT_NOT_FOUND');
  });

  it('toggle 下线后公开列表不再返回；重新上线后恢复', async () => {
    const offRes = await request(app)
      .put(`/api/admin/announcements/${annB}/toggle`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(offRes.status).toBe(200);
    expect(offRes.body.data.is_active).toBe(0);

    const offList = await request(app).get('/api/announcements');
    expect(offList.body.data.map((a: any) => a.id)).not.toContain(annB);

    const onRes = await request(app)
      .put(`/api/admin/announcements/${annB}/toggle`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(onRes.status).toBe(200);
    expect(onRes.body.data.is_active).toBe(1);

    const onList = await request(app).get('/api/announcements');
    expect(onList.body.data.map((a: any) => a.id)).toContain(annB);
  });

  it('toggle 不存在的公告返回 404 ANNOUNCEMENT_NOT_FOUND', async () => {
    const res = await request(app)
      .put('/api/admin/announcements/no-such-ann/toggle')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ANNOUNCEMENT_NOT_FOUND');
  });

  it('管理列表返回全部公告（含已下线）且分页字段齐全', async () => {
    // 建一条后下线，验证管理列表仍可见
    const createRes = await request(app)
      .post('/api/admin/announcements')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ title: '待下线公告', content: '正文' });
    expect(createRes.status).toBe(201);
    annC = createRes.body.data.id;
    await request(app).put(`/api/admin/announcements/${annC}/toggle`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    const res = await request(app)
      .get('/api/admin/announcements')
      .set('Authorization', `Bearer ${newsEditorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
    const ids = res.body.data.items.map((a: any) => a.id);
    expect(ids).toContain(annA);
    expect(ids).toContain(annC); // 已下线仍在管理列表
    const itemC = res.body.data.items.find((a: any) => a.id === annC);
    expect(itemC.is_active).toBe(0);
    expect(itemC).toHaveProperty('created_by');
    expect(res.body.data).toHaveProperty('page');
    expect(res.body.data).toHaveProperty('page_size');
  });

  it('DELETE 删除公告成功；重复删除返回 404', async () => {
    const delRes = await request(app)
      .delete(`/api/admin/announcements/${annC}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(delRes.status).toBe(200);

    const gone = await db.get('SELECT id FROM announcements WHERE id = ?', annC);
    expect(gone).toBeUndefined();

    const delAgain = await request(app)
      .delete(`/api/admin/announcements/${annC}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(delAgain.status).toBe(404);
    expect(delAgain.body.code).toBe('ANNOUNCEMENT_NOT_FOUND');
  });
});
