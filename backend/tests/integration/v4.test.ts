/**
 * @file V4.0.0 迭代集成测试
 * @description 覆盖通知中心（点赞/自赞/取消不通知、未读计数隔离、已读标记）、
 *              三分钟召回两级机制（窗口内静默/超窗原因必填/热门不可召回/审核员权限）、
 *              两级处罚（上传禁令/封禁）、申诉双向回执（发起/重复/撤回/裁决）、
 *              热门确认/审核分配/我的审核、关于我们站点统计。
 *              模式照抄现有套件：DB_PATH 测试库隔离 + TEST_BYPASS_TOKEN 人机验证绕过 + 直插 fixture。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

let app: express.Application;

// ── 测试账号 ────────────────────────────────────────────────────────────────
// USER_A：作品所有者（通知接收方）；USER_B：点赞者；USER_C：处罚目标；USER_D：申诉人
const TEST_USER_A = 'v4-user-a';
const TEST_USER_B = 'v4-user-b';
const TEST_USER_C = 'v4-user-c';
const TEST_USER_D = 'v4-user-d';
let tokenA: string;
let tokenB: string;
let tokenC: string;
let tokenD: string;

// ── 管理员 ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN_ID = 'v4-super-admin';
const ZONE_AUDITOR_ID = 'v4-zone-auditor';
let superAdminToken: string;
let zoneAuditorToken: string;

// ── fixture 照片 ID ─────────────────────────────────────────────────────────
const PHOTO_LIKE_TARGET = 'v4-like-target'; // A 所有，approved，点赞通知测试
const PHOTO_SELF = 'v4-self'; // A 所有，自赞测试
const RECALL_IN_WINDOW = 'v4-recall-window'; // approved，reviewed_by=zoneauditor，刚审核
const RECALL_EXPIRED = 'v4-recall-expired'; // approved，reviewed_at 10 分钟前
const RECALL_HOT = 'v4-recall-hot'; // is_hot_confirmed=1
const RECALL_OTHER = 'v4-recall-other'; // reviewed_by 他人（zone_auditor 403）
const RECALL_NULL_REVIEWER = 'v4-recall-null'; // reviewed_by NULL（zone_auditor 403）
const PHOTO_HOT_CONFIRM = 'v4-hot-confirm'; // B 所有，热门确认测试
const PHOTO_ASSIGN = 'v4-assign'; // pending，分配测试
const PHOTO_AUDIT_MINE = 'v4-audit-mine'; // reviewed_by=zoneauditor，我的审核测试
const APPEAL_PHOTO_1 = 'v4-appeal-1'; // D 所有，rejected，approve 裁决
const APPEAL_PHOTO_2 = 'v4-appeal-2'; // D 所有，rejected，reject 裁决
const APPEAL_PHOTO_3 = 'v4-appeal-3'; // D 所有，rejected，撤回/再发起

// db 句柄在 initDb 后动态获取，避免模块顶层 import 时读错 DB_PATH
let db: import('../../src/db').Database;

/** 插入照片 fixture 的最小字段 + 按需覆盖审核留痕字段 */
async function insertPhoto(opts: {
  id: string;
  title: string;
  status: string;
  user_id: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  is_hot_confirmed?: number;
  assigned_to?: string | null;
}) {
  await db.run(
    `INSERT OR REPLACE INTO photos
       (id, title, thumbnail_path, original_url, status, user_id,
        reviewed_by, reviewed_at, is_hot_confirmed, assigned_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.id,
    opts.title,
    `photos/thumbnails/${opts.id}.webp`,
    `photos/original/${opts.id}.jpg`,
    opts.status,
    opts.user_id,
    opts.reviewed_by ?? null,
    opts.reviewed_at ?? null,
    opts.is_hot_confirmed ?? 0,
    opts.assigned_to ?? null,
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
  const testDbPath = path.join(__dirname, '../../data/test-v4-database.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
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

  const photoRoutes = (await import('../../src/routes/photos')).default;
  const adminRoutes = (await import('../../src/routes/admin')).default;
  const notificationsRoutes = (await import('../../src/routes/notifications')).default;
  const myAppealsRoutes = (await import('../../src/routes/myAppeals')).default;
  const aboutRoutes = (await import('../../src/routes/about')).default;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  app.use('/api/photos', photoRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/my-appeals', myAppealsRoutes);
  app.use('/api/about', aboutRoutes);

  // 用与 photos.ts 相同的 JWT_SECRET 签发测试 token
  tokenA = jwt.sign({ userId: TEST_USER_A }, process.env.JWT_SECRET!);
  tokenB = jwt.sign({ userId: TEST_USER_B }, process.env.JWT_SECRET!);
  tokenC = jwt.sign({ userId: TEST_USER_C }, process.env.JWT_SECRET!);
  tokenD = jwt.sign({ userId: TEST_USER_D }, process.env.JWT_SECRET!);

  // 站点测试用户：is_active=1、权限全开、邮箱已确权（loadAuthUser 查 users 表）
  for (const u of [
    { id: TEST_USER_A, email: 'v4-a@test.local', username: 'V4UserA' },
    { id: TEST_USER_B, email: 'v4-b@test.local', username: 'V4UserB' },
    { id: TEST_USER_C, email: 'v4-c@test.local', username: 'V4UserC' },
    { id: TEST_USER_D, email: 'v4-d@test.local', username: 'V4UserD' },
  ]) {
    await db.run(
      'INSERT OR REPLACE INTO users (id, email, password_hash, username, is_active, banned_at, can_upload, can_view, can_download, can_like, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, 1, 1, 1, 1, 1, ?, ?)',
      u.id, u.email, '$2b$10$placeholderhashplaceholderhashplaceholderhashplaceholder', u.username,
      new Date().toISOString(), new Date().toISOString()
    );
  }

  // 管理员：super + zone_auditor（zone=landscape），经 /api/admin/login 签发 JWT
  const bcrypt = (await import('bcrypt')).default;
  const superHash = await bcrypt.hash('V4Admin123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, datetime('now'), datetime('now'))`,
    SUPER_ADMIN_ID, 'v4superadmin', superHash, 'V4超级管理员'
  );
  const auditorHash = await bcrypt.hash('V4Auditor123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    ZONE_AUDITOR_ID, 'v4zoneauditor', auditorHash, 'V4分区审核员'
  );

  const superLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'v4superadmin', password: 'V4Admin123456' });
  superAdminToken = superLogin.body.token as string;
  const auditorLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'v4zoneauditor', password: 'V4Auditor123456' });
  zoneAuditorToken = auditorLogin.body.token as string;
  expect(superAdminToken).toBeTruthy();
  expect(zoneAuditorToken).toBeTruthy();

  // ── 插入照片 fixture ──────────────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  await insertPhoto({ id: PHOTO_LIKE_TARGET, title: '点赞目标作品', status: 'approved', user_id: TEST_USER_A });
  await insertPhoto({ id: PHOTO_SELF, title: '自赞作品', status: 'approved', user_id: TEST_USER_A });
  await insertPhoto({
    id: RECALL_IN_WINDOW, title: '窗口内召回作品', status: 'approved', user_id: TEST_USER_A,
    reviewed_by: ZONE_AUDITOR_ID, reviewed_at: nowIso,
  });
  await insertPhoto({
    id: RECALL_EXPIRED, title: '超窗召回作品', status: 'approved', user_id: TEST_USER_A,
    reviewed_by: ZONE_AUDITOR_ID, reviewed_at: tenMinAgoIso,
  });
  await insertPhoto({
    id: RECALL_HOT, title: '热门召回作品', status: 'approved', user_id: TEST_USER_A,
    reviewed_by: ZONE_AUDITOR_ID, reviewed_at: nowIso, is_hot_confirmed: 1,
  });
  await insertPhoto({
    id: RECALL_OTHER, title: '他人审核作品', status: 'approved', user_id: TEST_USER_B,
    reviewed_by: 'v4-other-auditor', reviewed_at: nowIso,
  });
  await insertPhoto({
    id: RECALL_NULL_REVIEWER, title: '无审核人作品', status: 'approved', user_id: TEST_USER_A,
    reviewed_by: null, reviewed_at: nowIso,
  });
  await insertPhoto({ id: PHOTO_HOT_CONFIRM, title: '待确认热门作品', status: 'approved', user_id: TEST_USER_B });
  await insertPhoto({ id: PHOTO_ASSIGN, title: '待分配作品', status: 'pending', user_id: TEST_USER_A });
  await insertPhoto({
    id: PHOTO_AUDIT_MINE, title: '我的审核作品', status: 'approved', user_id: TEST_USER_A,
    reviewed_by: ZONE_AUDITOR_ID, reviewed_at: nowIso,
  });
  await insertPhoto({ id: APPEAL_PHOTO_1, title: '申诉作品一', status: 'rejected', user_id: TEST_USER_D });
  await insertPhoto({ id: APPEAL_PHOTO_2, title: '申诉作品二', status: 'rejected', user_id: TEST_USER_D });
  await insertPhoto({ id: APPEAL_PHOTO_3, title: '申诉作品三', status: 'rejected', user_id: TEST_USER_D });

  // 清理测试用户在目标照片上的历史点赞，保证初始状态干净
  await db.run(
    'DELETE FROM photo_likes WHERE photo_id IN (?, ?) AND user_id IN (?, ?)',
    PHOTO_LIKE_TARGET, PHOTO_SELF, TEST_USER_A, TEST_USER_B
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 通知中心
// ═══════════════════════════════════════════════════════════════════════════
describe('通知中心（V4.0.0）', () => {
  it('新增点赞应产生 photo_liked 通知', async () => {
    const likeRes = await request(app)
      .post(`/api/photos/${PHOTO_LIKE_TARGET}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(likeRes.status).toBe(200);
    expect(likeRes.body.data.is_liked).toBe(true);

    const listRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    const liked = listRes.body.data.find((n: any) => n.type === 'photo_liked');
    expect(liked).toBeTruthy();
    expect(liked.related_id).toBe(PHOTO_LIKE_TARGET);
    expect(liked.is_read).toBe(0);
    expect(liked.content).toContain('点赞目标作品');
  });

  it('取消点赞不应产生新通知', async () => {
    const before = await countNotifications(TEST_USER_A, 'photo_liked');
    const unlikeRes = await request(app)
      .delete(`/api/photos/${PHOTO_LIKE_TARGET}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(unlikeRes.status).toBe(200);

    const after = await countNotifications(TEST_USER_A, 'photo_liked');
    expect(after).toBe(before);
  });

  it('自赞不应产生通知', async () => {
    const before = await countNotifications(TEST_USER_A, 'photo_liked');
    const likeRes = await request(app)
      .post(`/api/photos/${PHOTO_SELF}/like`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(likeRes.status).toBe(200);

    const after = await countNotifications(TEST_USER_A, 'photo_liked');
    expect(after).toBe(before);
  });

  it('未读计数应按用户隔离', async () => {
    const resA = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    expect(resA.body.data.count).toBe(1); // 仅点赞通知

    const resB = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.count).toBe(0); // B 无通知
  });

  it('单条已读：本人可标记，他人通知返回 404', async () => {
    const listRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    const notificationId = listRes.body.data[0].id;

    // 他人（B）不可标记 A 的通知
    const forbidden = await request(app)
      .put(`/api/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(forbidden.status).toBe(404);

    const readRes = await request(app)
      .put(`/api/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(readRes.status).toBe(200);

    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(countRes.body.data.count).toBe(0);
  });

  it('全部已读应清零未读计数', async () => {
    // B 重新点赞，为 A 产生第二条通知
    const reLike = await request(app)
      .post(`/api/photos/${PHOTO_LIKE_TARGET}/like`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(reLike.status).toBe(200);

    const beforeRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(beforeRes.body.data.count).toBe(1);

    const readAllRes = await request(app)
      .put('/api/notifications/read-all')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(readAllRes.status).toBe(200);

    const afterRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(afterRes.body.data.count).toBe(0);
  });

  it('通知列表应支持分页', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.pagination.total).toBe(2); // 两条点赞通知
  });

  it('未登录访问通知接口应返回 401', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 三分钟召回两级机制
// ═══════════════════════════════════════════════════════════════════════════
describe('照片召回（V4.0.0）', () => {
  it('窗口内召回应静默回 pending 且不通知', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_IN_WINDOW}/recall`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.silent).toBe(true);

    const photo = await db.get<any>('SELECT status, reviewed_by, reviewed_at FROM photos WHERE id = ?', RECALL_IN_WINDOW);
    expect(photo.status).toBe('pending');
    expect(photo.reviewed_by).toBeNull();
    expect(photo.reviewed_at).toBeNull();
    // 静默召回不产生通知
    expect(await countNotifications(TEST_USER_A, 'photo_recalled')).toBe(0);
  });

  it('超窗召回无原因应返回 400 REASON_REQUIRED', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_EXPIRED}/recall`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REASON_REQUIRED');
  });

  it('超窗召回有原因应通知所有者且回 pending', async () => {
    const reason = '注册号识别存疑，需重新核对';
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_EXPIRED}/recall`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({ reason });
    expect(res.status).toBe(200);
    expect(res.body.data.silent).toBe(false);

    const photo = await db.get<any>('SELECT status, reviewed_by FROM photos WHERE id = ?', RECALL_EXPIRED);
    expect(photo.status).toBe('pending');
    expect(photo.reviewed_by).toBeNull();

    expect(await countNotifications(TEST_USER_A, 'photo_recalled')).toBe(1);
    const notice = await db.get<any>(
      "SELECT content FROM notifications WHERE user_id = ? AND type = 'photo_recalled'",
      TEST_USER_A
    );
    expect(notice.content).toContain(reason);
    expect(notice.content).toContain('超窗召回作品');
    expect(notice.content).toContain('详情请见「待审核」页面');
  });

  it('热门作品召回应返回 400 HOT_NOT_RECALLABLE', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_HOT}/recall`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: '测试' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HOT_NOT_RECALLABLE');
  });

  it('zone_auditor 不可召回他人审核的照片（403）', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_OTHER}/recall`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({ reason: '测试' });
    expect(res.status).toBe(403);
  });

  it('zone_auditor 对 reviewed_by 为空的照片应返回 403', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_NULL_REVIEWER}/recall`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({ reason: '测试' });
    expect(res.status).toBe(403);
  });

  it('super 可召回任意照片（他人审核的也放行）', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_OTHER}/recall`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.silent).toBe(true);

    const photo = await db.get<any>('SELECT status FROM photos WHERE id = ?', RECALL_OTHER);
    expect(photo.status).toBe('pending');
  });

  it('非 approved 状态的照片不可召回', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${RECALL_IN_WINDOW}/recall`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(res.status).toBe(400); // 已在窗口内测试中回到 pending
  });

  it('zone_auditor 超窗召回后应出现在我的审核之外（reviewed_by 已清空）', async () => {
    const res = await request(app)
      .get('/api/admin/my-audits')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(PHOTO_AUDIT_MINE); // 仍保留审核留痕
    expect(ids).not.toContain(RECALL_EXPIRED); // 已被召回清空
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 热门确认 / 审核分配 / 我的审核
// ═══════════════════════════════════════════════════════════════════════════
describe('热门确认与审核分配（V4.0.0）', () => {
  it('确认热门应写标记并通知所有者', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${PHOTO_HOT_CONFIRM}/hot`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(res.status).toBe(200);

    const photo = await db.get<any>('SELECT is_hot_confirmed FROM photos WHERE id = ?', PHOTO_HOT_CONFIRM);
    expect(photo.is_hot_confirmed).toBe(1);
    expect(await countNotifications(TEST_USER_B, 'photo_hot')).toBe(1);
  });

  it('重复确认热门应幂等且不重复通知', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${PHOTO_HOT_CONFIRM}/hot`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(await countNotifications(TEST_USER_B, 'photo_hot')).toBe(1);
  });

  it('分配照片给 zone_auditor 应写 assigned_to', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${PHOTO_ASSIGN}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ assignee_id: ZONE_AUDITOR_ID });
    expect(res.status).toBe(200);

    const photo = await db.get<any>('SELECT assigned_to FROM photos WHERE id = ?', PHOTO_ASSIGN);
    expect(photo.assigned_to).toBe(ZONE_AUDITOR_ID);
  });

  it('分配给非审核员角色应返回 400', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${PHOTO_ASSIGN}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ assignee_id: TEST_USER_A }); // 站点用户，非管理员
    expect(res.status).toBe(400);
  });

  it('分配缺少 assignee_id 应返回 400', async () => {
    const res = await request(app)
      .put(`/api/admin/photos/${PHOTO_ASSIGN}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('我的审核列表应包含本人经手的照片', async () => {
    const res = await request(app)
      .get('/api/admin/my-audits')
      .query({ status: 'approved' })
      .set('Authorization', `Bearer ${zoneAuditorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toContain(PHOTO_AUDIT_MINE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 申诉双向回执
// ═══════════════════════════════════════════════════════════════════════════
describe('申诉（V4.0.0）', () => {
  it('所有者可对被拒作品发起申诉', async () => {
    const res = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_1}/appeal`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ reason: '注册号填写正确，请复核' });
    expect(res.status).toBe(201);
    expect(res.body.data.appeal_id).toBeTruthy();

    const appeal = await db.get<any>('SELECT status FROM appeals WHERE id = ?', res.body.data.appeal_id);
    expect(appeal.status).toBe('pending');
  });

  it('重复申诉应返回 409 APPEAL_IN_PROGRESS', async () => {
    const res = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_1}/appeal`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ reason: '再次申诉' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPEAL_IN_PROGRESS');
  });

  it('非所有者申诉应返回 403', async () => {
    const res = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_2}/appeal`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: '我不是所有者' });
    expect(res.status).toBe(403);
  });

  it('非 rejected 状态照片不可申诉', async () => {
    const res = await request(app)
      .post(`/api/photos/${PHOTO_LIKE_TARGET}/appeal`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: '已通过作品' });
    expect(res.status).toBe(400);
  });

  it('缺少申诉理由应返回 400', async () => {
    const res = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_3}/appeal`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('我的申诉列表应返回本人申诉', async () => {
    const res = await request(app)
      .get('/api/my-appeals')
      .set('Authorization', `Bearer ${tokenD}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].photo_id).toBe(APPEAL_PHOTO_1);
    expect(res.body.data[0].photo_title).toBe('申诉作品一');
  });

  it('撤回申诉后可重新发起', async () => {
    // 对作品三发起申诉
    const createRes = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_3}/appeal`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ reason: '首次申诉' });
    expect(createRes.status).toBe(201);
    const appealId = createRes.body.data.appeal_id;

    // 撤回
    const withdrawRes = await request(app)
      .delete(`/api/my-appeals/${appealId}`)
      .set('Authorization', `Bearer ${tokenD}`);
    expect(withdrawRes.status).toBe(200);

    const withdrawn = await db.get<any>('SELECT status FROM appeals WHERE id = ?', appealId);
    expect(withdrawn.status).toBe('withdrawn');

    // 撤回后可重新发起
    const reCreateRes = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_3}/appeal`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ reason: '撤回后重新申诉' });
    expect(reCreateRes.status).toBe(201);
  });

  it('裁决 approve 应恢复照片为 approved 并通知（reviewed_by=裁决人）', async () => {
    const appeal = await db.get<any>(
      "SELECT id FROM appeals WHERE photo_id = ? AND status = 'pending'",
      APPEAL_PHOTO_1
    );
    expect(appeal).toBeTruthy();

    const res = await request(app)
      .put(`/api/admin/appeals/${appeal.id}/decide`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ decision: 'approve', response: '经复核注册号无误，恢复通过' });
    expect(res.status).toBe(200);

    const photo = await db.get<any>('SELECT status, reviewed_by FROM photos WHERE id = ?', APPEAL_PHOTO_1);
    expect(photo.status).toBe('approved');
    expect(photo.reviewed_by).toBe(SUPER_ADMIN_ID);

    expect(await countNotifications(TEST_USER_D, 'appeal_approved')).toBe(1);
    const notice = await db.get<any>(
      "SELECT content FROM notifications WHERE user_id = ? AND type = 'appeal_approved'",
      TEST_USER_D
    );
    expect(notice.content).toContain('申诉作品一');
    expect(notice.content).toContain('经复核注册号无误，恢复通过');
  });

  it('裁决 reject 应维持照片 rejected 且回执含答复', async () => {
    const createRes = await request(app)
      .post(`/api/photos/${APPEAL_PHOTO_2}/appeal`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ reason: '我认为审核有误' });
    expect(createRes.status).toBe(201);

    const appeal = await db.get<any>(
      "SELECT id FROM appeals WHERE photo_id = ? AND status = 'pending'",
      APPEAL_PHOTO_2
    );

    const res = await request(app)
      .put(`/api/admin/appeals/${appeal.id}/decide`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ decision: 'reject', response: '注册号与机身编号不符，维持驳回' });
    expect(res.status).toBe(200);

    const photo = await db.get<any>('SELECT status FROM photos WHERE id = ?', APPEAL_PHOTO_2);
    expect(photo.status).toBe('rejected');

    expect(await countNotifications(TEST_USER_D, 'appeal_rejected')).toBe(1);
    const notice = await db.get<any>(
      "SELECT content FROM notifications WHERE user_id = ? AND type = 'appeal_rejected'",
      TEST_USER_D
    );
    expect(notice.content).toContain('注册号与机身编号不符，维持驳回');
  });

  it('已裁决的申诉不可重复裁决，且 response 必填', async () => {
    const decided = await db.get<any>(
      "SELECT id FROM appeals WHERE photo_id = ? AND status = 'approved'",
      APPEAL_PHOTO_1
    );

    const repeatRes = await request(app)
      .put(`/api/admin/appeals/${decided.id}/decide`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ decision: 'reject', response: '重复裁决' });
    expect(repeatRes.status).toBe(400);

    const appeal = await db.get<any>(
      "SELECT id FROM appeals WHERE photo_id = ? AND status = 'pending'",
      APPEAL_PHOTO_3
    );
    const noResponseRes = await request(app)
      .put(`/api/admin/appeals/${appeal.id}/decide`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ decision: 'approve' });
    expect(noResponseRes.status).toBe(400);
  });

  it('管理侧申诉列表应支持状态筛选', async () => {
    const res = await request(app)
      .get('/api/admin/appeals')
      .query({ status: 'pending' })
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.data) {
      expect(item.status).toBe('pending');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 两级处罚与上传禁令（放最后，避免封禁影响其他套件）
// ═══════════════════════════════════════════════════════════════════════════
describe('两级处罚与上传禁令（V4.0.0）', () => {
  it('参数校验：非法 level / 缺原因 / 非法 days 均应 400', async () => {
    const base = { level: 1, reason: '测试', days: 7 };

    const badLevel = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ ...base, level: 3 });
    expect(badLevel.status).toBe(400);

    const noReason = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 1, days: 7 });
    expect(noReason.status).toBe(400);

    const noDays = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 1, reason: '测试' });
    expect(noDays.status).toBe(400);

    const bigDays = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 1, reason: '测试', days: 366 });
    expect(bigDays.status).toBe(400);

    const zeroDays = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 1, reason: '测试', days: 0 });
    expect(zeroDays.status).toBe(400);
  });

  it('zone_auditor 无处罚权限（403）', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${zoneAuditorToken}`)
      .send({ level: 1, reason: '越权测试', days: 7 });
    expect(res.status).toBe(403);
  });

  it('一级处罚应写 upload_banned_until 并通知', async () => {
    const before = Date.now();
    const res = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 1, reason: '频繁上传违规素材', days: 7 });
    expect(res.status).toBe(200);

    const user = await db.get<any>('SELECT upload_banned_until FROM users WHERE id = ?', TEST_USER_C);
    expect(user.upload_banned_until).toBeTruthy();
    const untilMs = new Date(user.upload_banned_until).getTime();
    expect(untilMs).toBeGreaterThan(before);
    // 约 7 天（允许 1 分钟误差）
    expect(untilMs - before).toBeGreaterThanOrEqual(7 * 86400000 - 60000);

    // 处罚记录留痕
    const penalty = await db.get<any>(
      'SELECT level, days, expires_at FROM penalties WHERE user_id = ?',
      TEST_USER_C
    );
    expect(penalty.level).toBe(1);
    expect(penalty.days).toBe(7);
    expect(penalty.expires_at).toBe(user.upload_banned_until);

    // 处罚通知
    expect(await countNotifications(TEST_USER_C, 'penalty')).toBe(1);
  });

  it('一级处罚后 /upload/complete 应返回 403 UPLOAD_BANNED', async () => {
    const res = await request(app)
      .post('/api/photos/upload/complete')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ key: 'photos/original/banned.jpg', title: '被禁上传', registration_number: 'B-1234' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UPLOAD_BANNED');
    expect(res.body.message).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/); // message 含解禁时间
  });

  it('一级处罚后 direct /upload 应在文件解析前返回 403 UPLOAD_BANNED', async () => {
    const res = await request(app)
      .post('/api/photos/upload')
      .set('Authorization', `Bearer ${tokenC}`)
      .attach('image', Buffer.from('fake-image-bytes'), 'test.jpg');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UPLOAD_BANNED');
  });

  it('一级处罚后 /upload/presigned 应返回 403 UPLOAD_BANNED', async () => {
    const res = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ fileName: 'banned.jpg' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UPLOAD_BANNED');
  });

  it('未处罚用户上传禁令校验不拦截（对照）', async () => {
    // USER_A 未被处罚：/upload/presigned 应通过禁令检查（后续因缺人机验证/正常流程返回非 403 UPLOAD_BANNED）
    const res = await request(app)
      .post('/api/photos/upload/presigned')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ fileName: 'ok.jpg' });
    // 人机验证在测试环境被绕过，正常走到 OSS 预签名或其内部错误，但不应是 UPLOAD_BANNED
    expect(res.body.code).not.toBe('UPLOAD_BANNED');
  });

  it('处罚历史列表应返回记录', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${TEST_USER_C}/penalties`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].level).toBe(1);
    expect(res.body.data[0].created_by_name).toBe('v4superadmin');
  });

  it('处罚不存在的用户应返回 404', async () => {
    const res = await request(app)
      .post('/api/admin/users/nonexistent-user/penalty')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 1, reason: '测试', days: 7 });
    expect(res.status).toBe(404);
  });

  it('二级处罚应写 banned_at、停用账号并强制下线', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 2, reason: '多次违规累犯' });
    expect(res.status).toBe(200);

    const user = await db.get<any>('SELECT banned_at, is_active FROM users WHERE id = ?', TEST_USER_C);
    expect(user.banned_at).toBeTruthy();
    expect(user.is_active).toBe(0);

    // 二级处罚通知
    expect(await countNotifications(TEST_USER_C, 'penalty')).toBe(2);

    // 被封禁用户再访问需鉴权接口 → 401
    const bannedRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenC}`);
    expect(bannedRes.status).toBe(401);
  });

  it('对已封禁用户重复二级处罚应返回 400', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${TEST_USER_C}/penalty`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ level: 2, reason: '重复封禁' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 关于我们站点统计
// ═══════════════════════════════════════════════════════════════════════════
describe('关于我们站点统计（Task 7.1）', () => {
  it('公开无鉴权返回 site_days 与 approved_count', async () => {
    const res = await request(app).get('/api/about/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.site_days).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.data.approved_count).toBe('number');
    expect(res.body.data.approved_count).toBeGreaterThanOrEqual(1); // seed 数据 + fixture
  });

  it('site_days 应等于 floor((now-上线日)/86400000)+1', async () => {
    const res = await request(app).get('/api/about/stats');
    const expected = Math.floor((Date.now() - new Date('2026-08-15').getTime()) / 86400000) + 1;
    expect(res.body.data.site_days).toBe(expected);
  });
});
