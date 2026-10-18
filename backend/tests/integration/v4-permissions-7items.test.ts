/**
 * @file V4.1.0 Wave 3A 用户权限项扩展至七项集成测试
 * @description 覆盖：
 *              - PUT /api/admin/users/:id/permissions 扩展 can_comment / can_forum_post 两项：
 *                变更落库 + from→to 审计日志
 *              - 执法点：can_comment=0 发评论 403 PERMISSION_DENIED（comments.ts）
 *              - 执法点：can_forum_post=0 论坛发帖 403 PERMISSION_DENIED（forum.ts）
 *              - 默认值 1 不拦截（权限门通过后进入后续业务校验，非 PERMISSION_DENIED）
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
// PERM_USER：permissions 端点变更对象；NO_COMMENT：can_comment=0；
// NO_FORUM：can_forum_post=0；DEFAULT_USER：不显式指定两项（默认 1）
const PERM_USER = 'v4perm-user';
const NO_COMMENT_USER = 'v4perm-no-comment';
const NO_FORUM_USER = 'v4perm-no-forum';
const DEFAULT_USER = 'v4perm-default';
let permUserToken: string;
let noCommentToken: string;
let noForumToken: string;
let defaultUserToken: string;

// ── 管理员 ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN_ID = 'v4perm-super';
let superAdminToken: string;

// db 句柄在 initDb 后动态获取，避免模块顶层 import 时读错 DB_PATH
let db: import('../../src/db').Database;

beforeAll(async () => {
  // 测试库隔离，避免测试数据写进生产 database.db
  const testDbPath = path.join(__dirname, '../../data/test-v4-permissions-database.db');
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
  const commentsRoutes = (await import('../../src/routes/comments')).default;
  const forumRoutes = (await import('../../src/routes/forum')).default;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  app.use('/api/admin', adminRoutes);
  app.use('/api/comments', commentsRoutes);
  app.use('/api/forum', forumRoutes);

  // 用与路由相同的 JWT_SECRET 签发测试 token
  permUserToken = jwt.sign({ userId: PERM_USER }, process.env.JWT_SECRET!);
  noCommentToken = jwt.sign({ userId: NO_COMMENT_USER }, process.env.JWT_SECRET!);
  noForumToken = jwt.sign({ userId: NO_FORUM_USER }, process.env.JWT_SECRET!);
  defaultUserToken = jwt.sign({ userId: DEFAULT_USER }, process.env.JWT_SECRET!);

  // 站点测试用户：is_active=1、邮箱已确权（requireVerifiedEmail 与 loadAuthUser 查 users 表）。
  // NO_COMMENT_USER 显式 can_comment=0，NO_FORUM_USER 显式 can_forum_post=0，DEFAULT_USER 缺省走默认值 1
  const userFixtures = [
    { id: PERM_USER, email: 'v4perm@test.local', username: 'PermUser', canComment: 1, canForumPost: 1 },
    { id: NO_COMMENT_USER, email: 'v4permnc@test.local', username: 'NoCommentUser', canComment: 0, canForumPost: 1 },
    { id: NO_FORUM_USER, email: 'v4permnf@test.local', username: 'NoForumUser', canComment: 1, canForumPost: 0 },
    { id: DEFAULT_USER, email: 'v4permd@test.local', username: 'DefaultUser', canComment: 1, canForumPost: 1 },
  ];
  for (const u of userFixtures) {
    await db.run(
      'INSERT OR REPLACE INTO users (id, email, password_hash, username, is_active, banned_at, can_upload, can_view, can_download, can_like, can_comment, can_forum_post, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, 1, 1, 1, 1, ?, ?, 1, ?, ?)',
      u.id, u.email, '$2b$10$placeholderhashplaceholderhashplaceholderhashplaceholder', u.username,
      u.canComment, u.canForumPost,
      new Date().toISOString(), new Date().toISOString()
    );
  }

  // 超管：must_change_password=0 跳过强制改密门，经 /api/admin/login 签发 JWT
  const bcrypt = (await import('bcrypt')).default;
  const hash = await bcrypt.hash('V4PermAdmin123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, datetime('now'), datetime('now'))`,
    SUPER_ADMIN_ID, 'v4permsuper', hash, 'V4权限超级管理员'
  );

  const login = await request(app)
    .post('/api/admin/login')
    .send({ username: 'v4permsuper', password: 'V4PermAdmin123456' });
  expect(login.status).toBe(200);
  superAdminToken = login.body.token as string;
});

describe('V4.1.0 Wave 3A 用户权限项扩展至七项', () => {
  it('PUT /permissions 变更 can_comment/can_forum_post 落库并记录 from→to 审计日志', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${PERM_USER}/permissions`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ can_comment: 0, can_forum_post: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.can_comment).toBe(0);
    expect(res.body.data.can_forum_post).toBe(0);

    // 落库校验
    const row = await db.get<{ can_comment: number; can_forum_post: number }>(
      'SELECT can_comment, can_forum_post FROM users WHERE id = ?',
      PERM_USER
    );
    expect(row?.can_comment).toBe(0);
    expect(row?.can_forum_post).toBe(0);

    // 审计日志：action=update_permissions，details 含两项 from→to
    const log = await db.get<{ details: string }>(
      "SELECT details FROM admin_logs WHERE action = 'update_permissions' AND target_id = ? ORDER BY created_at DESC LIMIT 1",
      PERM_USER
    );
    expect(log).toBeTruthy();
    const details = JSON.parse(log!.details);
    expect(details.changes.can_comment).toEqual({ from: 1, to: 0 });
    expect(details.changes.can_forum_post).toEqual({ from: 1, to: 0 });
  });

  it('can_comment=0 发评论返回 403 PERMISSION_DENIED', async () => {
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${noCommentToken}`)
      .send({ subject_type: 'photo', subject_id: 'any-photo', content: '测试评论' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('can_forum_post=0 论坛发帖返回 403 PERMISSION_DENIED', async () => {
    const res = await request(app)
      .post('/api/forum/threads')
      .set('Authorization', `Bearer ${noForumToken}`)
      .send({ board_id: 'aviation', title: '测试帖', content_md: '正文' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('默认权限 1 不拦截：权限门通过后进入后续业务校验（非 PERMISSION_DENIED）', async () => {
    // 评论：DEFAULT_USER 未被限制，请求越过权限门后因主题不存在返回业务错误（非 PERMISSION_DENIED）
    const commentRes = await request(app)
      .post('/api/comments')
      .set('Authorization', `Bearer ${defaultUserToken}`)
      .send({ subject_type: 'photo', subject_id: 'no-such-photo', content: '测试评论' });
    expect(commentRes.body.code).not.toBe('PERMISSION_DENIED');

    // 发帖：越过权限门与人机验证后因参数校验返回业务错误（非 PERMISSION_DENIED）
    const threadRes = await request(app)
      .post('/api/forum/threads')
      .set('Authorization', `Bearer ${defaultUserToken}`)
      .send({ board_id: 'not-a-board', title: '', content_md: '' });
    expect(threadRes.status).not.toBe(403);
    expect(threadRes.body.code).not.toBe('PERMISSION_DENIED');
  });
});
