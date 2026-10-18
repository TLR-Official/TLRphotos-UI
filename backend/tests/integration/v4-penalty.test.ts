/**
 * @file V4.1.0 处罚分级集成测试
 * @description 覆盖三级处罚端点语义（L1 警告 / L2 功能封禁 / L3 账号封禁）、
 *              四项执法点（上传/评论/论坛发帖/下载）、处罚撤销权限与生效时效、
 *              L2 过期自动放行、L3 限时解禁时间落库、用户列表新字段。
 *              模式照抄 v4.test.ts：DB_PATH 测试库隔离 + TEST_BYPASS_TOKEN 人机验证绕过 + 直插 fixture。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

let app: express.Application;

// ── 测试账号（每个场景独立用户，避免处罚状态互相污染）────────────────────────
// A：对照/照片所有者；B：L2 上传封禁；C：L2 评论封禁；D：L2 发帖封禁；E：L2 下载封禁；
// F：L2 过期放行；G：L1 警告+撤销；H：L3 永久+撤销恢复；I：L3 限时；J：L2 撤销时效；K：L2 参数校验
const USER_A = 'v4p-user-a';
const USER_B = 'v4p-user-b';
const USER_C = 'v4p-user-c';
const USER_D = 'v4p-user-d';
const USER_E = 'v4p-user-e';
const USER_F = 'v4p-user-f';
const USER_G = 'v4p-user-g';
const USER_H = 'v4p-user-h';
const USER_I = 'v4p-user-i';
const USER_J = 'v4p-user-j';
const USER_K = 'v4p-user-k';
const ALL_USERS = [USER_A, USER_B, USER_C, USER_D, USER_E, USER_F, USER_G, USER_H, USER_I, USER_J, USER_K];
const tokens = new Map<string, string>();

// ── 管理员 ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN_ID = 'v4p-super-admin';
const ZONE_MASTER_ID = 'v4p-zone-master';
const ZONE_AUDITOR_ID = 'v4p-zone-auditor';
let superAdminToken: string;
let zoneMasterToken: string;
let zoneAuditorToken: string;

// ── fixture ────────────────────────────────────────────────────────────────
const PHOTO_COMMENT = 'v4p-photo-comment'; // A 所有，approved：评论主题 + 下载目标

// db 句柄在 initDb 后动态获取，避免模块顶层 import 时读错 DB_PATH
let db: import('../../src/db').Database;

/** 发表处罚的快捷封装（super 身份） */
function createPenalty(userId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/admin/users/${userId}/penalty`)
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send(body);
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
  const testDbPath = path.join(__dirname, '../../data/test-v4-penalty-database.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  process.env.DB_PATH = testDbPath;
  process.env.NODE_ENV = 'test';

  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  // 管理员 JWT 密钥要求 trim 后 ≥32 字符
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-0123456789abcdef';
  // 测试环境人机验证绕过：isTestBypass 仅在 NODE_ENV=test 且令牌完全匹配时放行
  process.env.TEST_BYPASS_TOKEN = 'test-verification-bypass';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;

  const photoRoutes = (await import('../../src/routes/photos')).default;
  const adminRoutes = (await import('../../src/routes/admin')).default;
  const commentsRoutes = (await import('../../src/routes/comments')).default;
  const forumRoutes = (await import('../../src/routes/forum')).default;
  const notificationsRoutes = (await import('../../src/routes/notifications')).default;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  app.use('/api/photos', photoRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/forum', forumRoutes);
  app.use('/api/notifications', notificationsRoutes);

  // 用与 photos.ts 相同的 JWT_SECRET 签发测试 token
  for (const id of ALL_USERS) {
    tokens.set(id, jwt.sign({ userId: id }, process.env.JWT_SECRET!));
  }

  // 站点测试用户：is_active=1、权限全开、邮箱已确权（loadAuthUser 查 users 表）
  for (const id of ALL_USERS) {
    await db.run(
      'INSERT OR REPLACE INTO users (id, email, password_hash, username, is_active, banned_at, can_upload, can_view, can_download, can_like, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, 1, 1, 1, 1, 1, ?, ?)',
      id, `${id}@test.local`, '$2b$10$placeholderhashplaceholderhashplaceholderhashplaceholder', id,
      new Date().toISOString(), new Date().toISOString()
    );
  }

  // 管理员：super + zone_master + zone_auditor（zone=landscape），经 /api/admin/login 签发 JWT
  const bcrypt = (await import('bcrypt')).default;
  const superHash = await bcrypt.hash('V4PSuper123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, datetime('now'), datetime('now'))`,
    SUPER_ADMIN_ID, 'v4psuperadmin', superHash, 'V4P超级管理员'
  );
  const masterHash = await bcrypt.hash('V4PMaster123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_master', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    ZONE_MASTER_ID, 'v4pzonemaster', masterHash, 'V4P分区总审核'
  );
  const auditorHash = await bcrypt.hash('V4PAuditor123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    ZONE_AUDITOR_ID, 'v4pzoneauditor', auditorHash, 'V4P分区审核员'
  );

  const superLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'v4psuperadmin', password: 'V4PSuper123456' });
  superAdminToken = superLogin.body.token as string;
  const masterLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'v4pzonemaster', password: 'V4PMaster123456' });
  zoneMasterToken = masterLogin.body.token as string;
  const auditorLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'v4pzoneauditor', password: 'V4PAuditor123456' });
  zoneAuditorToken = auditorLogin.body.token as string;
  expect(superAdminToken).toBeTruthy();
  expect(zoneMasterToken).toBeTruthy();
  expect(zoneAuditorToken).toBeTruthy();

  // 照片 fixture：approved，作为评论主题与下载目标
  await db.run(
    `INSERT OR REPLACE INTO photos
       (id, title, thumbnail_path, original_url, status, user_id, created_at)
     VALUES (?, ?, ?, ?, 'approved', ?, ?)`,
    PHOTO_COMMENT, '处罚测试作品', `photos/thumbnails/${PHOTO_COMMENT}.webp`, `photos/original/${PHOTO_COMMENT}.jpg`, USER_A, new Date().toISOString()
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// a) L2 参数校验
// ═══════════════════════════════════════════════════════════════════════════
describe('L2 参数校验（V4.1.0）', () => {
  it('capabilities 为空数组应返回 400 PENALTY_CAPS_INVALID', async () => {
    const res = await createPenalty(USER_K, { level: 2, reason: '测试', capabilities: [], days: 30 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PENALTY_CAPS_INVALID');
  });

  it('capabilities 含非法项应返回 400 PENALTY_CAPS_INVALID', async () => {
    const res = await createPenalty(USER_K, { level: 2, reason: '测试', capabilities: ['upload', 'fly'], days: 30 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PENALTY_CAPS_INVALID');
  });

  it('days 29 / 361 应返回 400 PENALTY_DAYS_INVALID', async () => {
    const low = await createPenalty(USER_K, { level: 2, reason: '测试', capabilities: ['upload'], days: 29 });
    expect(low.status).toBe(400);
    expect(low.body.code).toBe('PENALTY_DAYS_INVALID');

    const high = await createPenalty(USER_K, { level: 2, reason: '测试', capabilities: ['upload'], days: 361 });
    expect(high.status).toBe(400);
    expect(high.body.code).toBe('PENALTY_DAYS_INVALID');
  });

  it('days 30 / 360 边界应创建成功', async () => {
    const ok30 = await createPenalty(USER_K, { level: 2, reason: '下限测试', capabilities: ['upload'], days: 30 });
    expect(ok30.status).toBe(200);
    expect(ok30.body.data.days).toBe(30);
    expect(ok30.body.data.capabilities).toEqual(['upload']);
    expect(ok30.body.data.expires_at).toBeTruthy();
    expect(ok30.body.data.revoked_at).toBeNull();

    const ok360 = await createPenalty(USER_K, { level: 2, reason: '上限测试', capabilities: ['comment'], days: 360 });
    expect(ok360.status).toBe(200);
    expect(ok360.body.data.days).toBe(360);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// b) L2 仅勾 upload：上传拦截，其余能力不受影响
// ═══════════════════════════════════════════════════════════════════════════
describe('L2 仅封禁上传（V4.1.0）', () => {
  it('上传 403 UPLOAD_BANNED 且 message 含解禁时间', async () => {
    const create = await createPenalty(USER_B, { level: 2, reason: '上传违规素材', capabilities: ['upload'], days: 45 });
    expect(create.status).toBe(200);

    const res = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_B)}`)
      .send({ fileName: 'banned.jpg' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UPLOAD_BANNED');
    expect(res.body.message).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('评论不受影响（201）', async () => {
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokens.get(USER_B)}`)
      .send({ subject_type: 'photo', subject_id: PHOTO_COMMENT, content: '拍得真不错' });
    expect(res.status).toBe(201);
  });

  it('论坛发帖不受影响（201）', async () => {
    const res = await request(app)
      .post('/api/forum/threads')
      .set('Authorization', `Bearer ${tokens.get(USER_B)}`)
      .send({ board_id: 'aviation', title: '交流帖', content_md: '# 大家好' });
    expect(res.status).toBe(201);
  });

  it('下载不受影响（非 403 DOWNLOAD_BANNED）', async () => {
    const res = await request(app)
      .get(`/api/photos/image/photos%2Foriginal%2F${PHOTO_COMMENT}.jpg`)
      .query({ download: '1', photoId: PHOTO_COMMENT })
      .set('Authorization', `Bearer ${tokens.get(USER_B)}`);
    expect(res.body.code).not.toBe('DOWNLOAD_BANNED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// c) L2 勾 comment：评论拦截，上传不受影响
// ═══════════════════════════════════════════════════════════════════════════
describe('L2 封禁评论（V4.1.0）', () => {
  it('发评论 403 COMMENT_BANNED', async () => {
    const create = await createPenalty(USER_C, { level: 2, reason: '恶意刷评', capabilities: ['comment'], days: 30 });
    expect(create.status).toBe(200);

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokens.get(USER_C)}`)
      .send({ subject_type: 'photo', subject_id: PHOTO_COMMENT, content: '测试评论' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMENT_BANNED');
  });

  it('上传不受影响（非 403 UPLOAD_BANNED）', async () => {
    const res = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_C)}`)
      .send({ fileName: 'ok.jpg' });
    expect(res.body.code).not.toBe('UPLOAD_BANNED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// d) L2 勾 forum_post
// ═══════════════════════════════════════════════════════════════════════════
describe('L2 封禁论坛发帖（V4.1.0）', () => {
  it('发帖 403 FORUM_POST_BANNED', async () => {
    const create = await createPenalty(USER_D, { level: 2, reason: '灌水刷帖', capabilities: ['forum_post'], days: 30 });
    expect(create.status).toBe(200);

    const res = await request(app)
      .post('/api/forum/threads')
      .set('Authorization', `Bearer ${tokens.get(USER_D)}`)
      .send({ board_id: 'aviation', title: '被封禁帖', content_md: '正文' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORUM_POST_BANNED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// e) L2 勾 download
// ═══════════════════════════════════════════════════════════════════════════
describe('L2 封禁下载（V4.1.0）', () => {
  it('带 token 下载 ?download=1 应 403 DOWNLOAD_BANNED', async () => {
    const create = await createPenalty(USER_E, { level: 2, reason: '批量爬取图片', capabilities: ['download'], days: 30 });
    expect(create.status).toBe(200);

    const res = await request(app)
      .get(`/api/photos/image/photos%2Foriginal%2F${PHOTO_COMMENT}.jpg`)
      .query({ download: '1', photoId: PHOTO_COMMENT })
      .set('Authorization', `Bearer ${tokens.get(USER_E)}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOWNLOAD_BANNED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// f) L2 过期放行
// ═══════════════════════════════════════════════════════════════════════════
describe('L2 过期自动放行（V4.1.0）', () => {
  it('expires_at 过去时间后四项能力全部恢复', async () => {
    const create = await createPenalty(USER_F, {
      level: 2,
      reason: '全能力封禁',
      capabilities: ['upload', 'comment', 'forum_post', 'download'],
      days: 30,
    });
    expect(create.status).toBe(200);
    const penaltyId = create.body.data.id as string;

    // 封禁生效 sanity：上传被拦
    const blocked = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_F)}`)
      .send({ fileName: 'banned.jpg' });
    expect(blocked.body.code).toBe('UPLOAD_BANNED');

    // 直接把期限改为过去时间（模拟到期）
    await db.run('UPDATE penalties SET expires_at = ? WHERE id = ?', [
      new Date(Date.now() - 1000).toISOString(),
      penaltyId,
    ]);

    const upload = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_F)}`)
      .send({ fileName: 'ok.jpg' });
    expect(upload.body.code).not.toBe('UPLOAD_BANNED');

    const comment = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokens.get(USER_F)}`)
      .send({ subject_type: 'photo', subject_id: PHOTO_COMMENT, content: '解封后评论' });
    expect(comment.status).toBe(201);

    const thread = await request(app)
      .post('/api/forum/threads')
      .set('Authorization', `Bearer ${tokens.get(USER_F)}`)
      .send({ board_id: 'aviation', title: '解封后发帖', content_md: '正文' });
    expect(thread.status).toBe(201);

    const download = await request(app)
      .get(`/api/photos/image/photos%2Foriginal%2F${PHOTO_COMMENT}.jpg`)
      .query({ download: '1', photoId: PHOTO_COMMENT })
      .set('Authorization', `Bearer ${tokens.get(USER_F)}`);
    expect(download.body.code).not.toBe('DOWNLOAD_BANNED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// g) L1 警告 + 撤销权限
// ═══════════════════════════════════════════════════════════════════════════
describe('L1 警告与撤销权限（V4.1.0）', () => {
  it('L1 创建后不落 users 表且各能力正常', async () => {
    const create = await createPenalty(USER_G, { level: 1, reason: '首次轻微违规' });
    expect(create.status).toBe(200);
    expect(create.body.data.level).toBe(1);
    expect(create.body.data.capabilities).toEqual([]);
    expect(create.body.data.days).toBeNull();
    expect(create.body.data.expires_at).toBeNull();

    const penalty = await db.get<any>(
      'SELECT level, capabilities, days, expires_at FROM penalties WHERE user_id = ?',
      USER_G
    );
    expect(penalty.level).toBe(1);
    expect(JSON.parse(penalty.capabilities)).toEqual([]);
    expect(penalty.days).toBeNull();
    expect(penalty.expires_at).toBeNull();

    const user = await db.get<any>(
      'SELECT upload_banned_until, banned_at FROM users WHERE id = ?',
      USER_G
    );
    expect(user.upload_banned_until).toBeNull();
    expect(user.banned_at).toBeNull();

    // 上传与评论均正常
    const upload = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_G)}`)
      .send({ fileName: 'ok.jpg' });
    expect(upload.body.code).not.toBe('UPLOAD_BANNED');

    const comment = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${tokens.get(USER_G)}`)
      .send({ subject_type: 'photo', subject_id: PHOTO_COMMENT, content: '警告不影响发言' });
    expect(comment.status).toBe(201);

    expect(await countNotifications(USER_G, 'penalty')).toBe(1);
  });

  it('zone_master 撤销 L1 应 403 BAN_MANAGE_DENIED，super 撤销成功并通知', async () => {
    const record = await db.get<any>('SELECT id FROM penalties WHERE user_id = ?', USER_G);
    expect(record).toBeTruthy();

    const denied = await request(app)
      .post(`/api/admin/penalties/${record.id}/revoke`)
      .set('Authorization', `Bearer ${zoneMasterToken}`)
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('BAN_MANAGE_DENIED');

    const before = await countNotifications(USER_G, 'penalty');
    const ok = await request(app)
      .post(`/api/admin/penalties/${record.id}/revoke`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.revoked_at).toBeTruthy();
    expect(ok.body.data.revoked_by).toBe(SUPER_ADMIN_ID);

    const revoked = await db.get<any>('SELECT revoked_at, revoked_by FROM penalties WHERE id = ?', record.id);
    expect(revoked.revoked_at).toBeTruthy();
    expect(revoked.revoked_by).toBe(SUPER_ADMIN_ID);

    // 撤销通知产生
    expect(await countNotifications(USER_G, 'penalty')).toBe(before + 1);
    const notice = await db.get<any>(
      "SELECT title FROM notifications WHERE user_id = ? AND type = 'penalty' ORDER BY created_at DESC LIMIT 1",
      USER_G
    );
    expect(notice.title).toBe('处罚已撤销');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// h) L3 永久 / 限时
// ═══════════════════════════════════════════════════════════════════════════
describe('L3 账号封禁（V4.1.0）', () => {
  it('L3 永久应写 banned_at 且访问 401 USER_BANNED，撤销后恢复', async () => {
    const create = await createPenalty(USER_H, { level: 3, reason: '严重违规' });
    expect(create.status).toBe(200);
    expect(create.body.data.capabilities).toEqual(['all']);
    expect(create.body.data.expires_at).toBeNull();

    const user = await db.get<any>('SELECT banned_at, banned_until FROM users WHERE id = ?', USER_H);
    expect(user.banned_at).toBeTruthy();
    expect(user.banned_until).toBeNull();

    const bannedRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokens.get(USER_H)}`);
    expect(bannedRes.status).toBe(401);
    expect(bannedRes.body.code).toBe('USER_BANNED');

    // super 撤销：L3 封禁来源清除，账号恢复
    const penalty = await db.get<any>('SELECT id FROM penalties WHERE user_id = ?', USER_H);
    const revoke = await request(app)
      .post(`/api/admin/penalties/${penalty.id}/revoke`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(revoke.status).toBe(200);

    const restored = await db.get<any>(
      'SELECT banned_at, banned_until, is_active FROM users WHERE id = ?',
      USER_H
    );
    expect(restored.banned_at).toBeNull();
    expect(restored.banned_until).toBeNull();
    expect(restored.is_active).toBe(1);

    const okRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokens.get(USER_H)}`);
    expect(okRes.status).toBe(200);
  });

  it('L3 限时 30 天应写 banned_until', async () => {
    const before = Date.now();
    const create = await createPenalty(USER_I, { level: 3, reason: '短期违规', days: 30 });
    expect(create.status).toBe(200);
    expect(create.body.data.expires_at).toBeTruthy();

    const user = await db.get<any>('SELECT banned_at, banned_until FROM users WHERE id = ?', USER_I);
    expect(user.banned_at).toBeTruthy();
    const untilMs = new Date(user.banned_until).getTime();
    expect(untilMs).toBeGreaterThan(before + 29 * 86400000);
    expect(untilMs).toBeLessThan(before + 31 * 86400000);
    expect(new Date(create.body.data.expires_at).getTime()).toBe(untilMs);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// i) / j) 撤销时效与边界
// ═══════════════════════════════════════════════════════════════════════════
describe('处罚撤销时效与边界（V4.1.0）', () => {
  it('revoke 后 L2 执法立即失效；zone_auditor 撤销 L2 应 403', async () => {
    const create = await createPenalty(USER_J, { level: 2, reason: '临时封禁上传', capabilities: ['upload'], days: 30 });
    expect(create.status).toBe(200);
    const penaltyId = create.body.data.id as string;

    const blocked = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_J)}`)
      .send({ fileName: 'banned.jpg' });
    expect(blocked.body.code).toBe('UPLOAD_BANNED');

    // zone_auditor 无解除权限
    const denied = await request(app)
      .post(`/api/admin/penalties/${penaltyId}/revoke`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('BAN_MANAGE_DENIED');

    // super 解除后执法立即失效
    const revoke = await request(app)
      .post(`/api/admin/penalties/${penaltyId}/revoke`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(revoke.status).toBe(200);

    const restored = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokens.get(USER_J)}`)
      .send({ fileName: 'ok.jpg' });
    expect(restored.body.code).not.toBe('UPLOAD_BANNED');
  });

  it('撤销不存在的处罚应 404，重复撤销应 400 PENALTY_ALREADY_REVOKED', async () => {
    const missing = await request(app)
      .post('/api/admin/penalties/nonexistent-penalty-id/revoke')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(missing.status).toBe(404);

    const record = await db.get<any>('SELECT id FROM penalties WHERE user_id = ?', USER_J);
    const repeat = await request(app)
      .post(`/api/admin/penalties/${record.id}/revoke`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(repeat.status).toBe(400);
    expect(repeat.body.code).toBe('PENALTY_ALREADY_REVOKED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 用户列表新字段
// ═══════════════════════════════════════════════════════════════════════════
describe('用户列表扩展字段（V4.1.0）', () => {
  it('/users/list 应返回 region / banned_until / can_ban_manage', async () => {
    const res = await request(app)
      .get('/api/admin/users/list')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((u: any) => u.id === USER_B);
    expect(row).toBeTruthy();
    expect('region' in row).toBe(true);
    expect('banned_until' in row).toBe(true);
    expect('can_ban_manage' in row).toBe(true);
    expect(row.banned_until).toBeNull();
    expect(row.can_ban_manage).toBe(0);
  });
});
