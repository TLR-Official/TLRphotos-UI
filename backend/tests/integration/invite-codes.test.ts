/**
 * @file 邀请码与用户称号集成测试（V4.7.0）
 * @description 覆盖注册邀请码校验、称号授予与持久化、一码一人/多次码、管理端 CRUD。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// 邮件通道打桩，捕获 6 位注册验证码明文
const otpCapture = vi.hoisted(() => ({ codes: new Map<string, string>() }));

vi.mock('../../src/services/aliMailService', () => ({
  sendMailCode: vi.fn(async (to: string, code: string) => {
    otpCapture.codes.set(to, code);
  }),
}));

let app: express.Application;
let db: typeof import('../../src/db').db;
let superToken = '';
let auditorToken = '';

beforeAll(async () => {
  const testDbPath = path.join(__dirname, '../../data/test-invite-database.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  process.env.DB_PATH = testDbPath;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-0123456789abcdef';
  process.env.TURNSTILE_SECRET = 'test-turnstile-secret';
  process.env.TURNSTILE_HOSTNAMES = 'localhost,127.0.0.1';
  process.env.TEST_BYPASS_TOKEN = 'test-verification-bypass';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;

  // 测试管理员：super（可管理邀请码）与 zone_auditor（应被拒绝）
  const bcrypt = (await import('bcrypt')).default;
  const superHash = await bcrypt.hash('Admin123456', 10);
  const auditorHash = await bcrypt.hash('Auditor123456', 10);
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, datetime('now'), datetime('now'))`,
    'test-invite-super', 'invitesuper', superHash, '邀请码测试超管'
  );
  await db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    'test-invite-auditor', 'inviteauditor', auditorHash, '邀请码测试审核员'
  );

  const authRoutes = (await import('../../src/routes/auth')).default;
  const adminInvitesRoutes = (await import('../../src/routes/adminInvites')).default;
  const adminRoutes = (await import('../../src/routes/admin')).default;

  app = express();
  app.use(express.json());
  // 测试环境人机验证绕过（与 auth/admin 套件同口径）
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  app.use('/api/auth', authRoutes);
  // 更具体路径必须先于 /api/admin 挂载
  app.use('/api/admin/invites', adminInvitesRoutes);
  app.use('/api/admin', adminRoutes);

  const superLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'invitesuper', password: 'Admin123456' });
  expect(superLogin.status).toBe(200);
  superToken = superLogin.body.token as string;

  const auditorLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'inviteauditor', password: 'Auditor123456' });
  expect(auditorLogin.status).toBe(200);
  auditorToken = auditorLogin.body.token as string;
});

/** 获取注册验证码（邮件通道已打桩） */
async function requestRegisterCode(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/email/code/send').send({ email, scene: 'register' });
  expect(res.status).toBe(200);
  return otpCapture.codes.get(email)!;
}

/** 走注册接口；inviteCode 为空表示不填邀请码 */
async function registerUser(email: string, inviteCode?: string) {
  const code = await requestRegisterCode(email);
  return request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'Test123456',
      username: 'inviteuser',
      code,
      ...(inviteCode ? { invite_code: inviteCode } : {}),
    });
}

/** 管理端创建邀请码 */
async function createInviteViaAdmin(payload: Record<string, unknown>) {
  return request(app)
    .post('/api/admin/invites')
    .set('Authorization', `Bearer ${superToken}`)
    .send(payload);
}

/** 唯一邮箱生成 */
function uniqueEmail(tag: string): string {
  return `invite-${tag}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

describe('邀请码注册与称号授予', () => {
  it('不填邀请码可正常注册且不授予称号', async () => {
    const email = uniqueEmail('empty');
    const res = await registerUser(email);

    expect(res.status).toBe(201);
    expect(res.body.data.user.title).toBeNull();
    expect(res.body.data.user.invite_code_id).toBeNull();

    const row = await db.get<{ user_title: string | null; invite_code_id: string | null }>(
      'SELECT user_title, invite_code_id FROM users WHERE email = ?',
      email
    );
    expect(row?.user_title).toBeNull();
    expect(row?.invite_code_id).toBeNull();
  });

  it('有效邀请码注册成功：写入称号与邀请码 ID，并消耗一次次数', async () => {
    const createRes = await createInviteViaAdmin({ title: '航空摄影师', max_uses: 1 });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { id: string; code: string; title: string };

    const email = uniqueEmail('valid');
    const res = await registerUser(email, invite.code.toLowerCase());

    expect(res.status).toBe(201);
    expect(res.body.data.user.title).toBe('航空摄影师');
    expect(res.body.data.user.invite_code_id).toBe(invite.id);

    // 用户核心数据持久化
    const row = await db.get<{
      invite_code_id: string | null;
      user_title: string | null;
      title_granted_at: string | null;
    }>('SELECT invite_code_id, user_title, title_granted_at FROM users WHERE email = ?', email);
    expect(row?.invite_code_id).toBe(invite.id);
    expect(row?.user_title).toBe('航空摄影师');
    expect(row?.title_granted_at).toBeTruthy();

    // 邀请码用量 +1
    const codeRow = await db.get<{ used_count: number }>(
      'SELECT used_count FROM invite_codes WHERE id = ?',
      invite.id
    );
    expect(codeRow?.used_count).toBe(1);

    // 登录态接口同样返回称号
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.data.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.title).toBe('航空摄影师');
  });

  it('不存在的邀请码拒绝注册且不产生用户', async () => {
    const email = uniqueEmail('missing');
    const res = await registerUser(email, 'NOPE2026XYZ');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVITE_CODE_INVALID');
    expect(await db.get('SELECT id FROM users WHERE email = ?', email)).toBeUndefined();
  });

  it('已停用的邀请码拒绝注册', async () => {
    const createRes = await createInviteViaAdmin({ title: '停用测试' });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { id: string; code: string };

    const updateRes = await request(app)
      .put(`/api/admin/invites/${invite.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ is_active: false });
    expect(updateRes.status).toBe(200);

    const res = await registerUser(uniqueEmail('inactive'), invite.code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVITE_CODE_INVALID');
  });

  it('已过期的邀请码拒绝注册', async () => {
    const createRes = await createInviteViaAdmin({
      title: '过期测试',
      expires_at: '2020-01-01T00:00:00.000Z',
    });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { code: string };

    const res = await registerUser(uniqueEmail('expired'), invite.code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVITE_CODE_INVALID');
  });

  it('一码一人：同一邀请码第二次注册被拒绝', async () => {
    const createRes = await createInviteViaAdmin({ title: '一码一人', max_uses: 1 });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { id: string; code: string };

    const first = await registerUser(uniqueEmail('single-1'), invite.code);
    expect(first.status).toBe(201);

    const second = await registerUser(uniqueEmail('single-2'), invite.code);
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('INVITE_CODE_INVALID');

    const codeRow = await db.get<{ used_count: number }>(
      'SELECT used_count FROM invite_codes WHERE id = ?',
      invite.id
    );
    expect(codeRow?.used_count).toBe(1);
  });

  it('max_uses=2：前两次成功、第三次失败', async () => {
    const createRes = await createInviteViaAdmin({ title: '多次码', max_uses: 2 });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { code: string };

    expect((await registerUser(uniqueEmail('multi-1'), invite.code)).status).toBe(201);
    expect((await registerUser(uniqueEmail('multi-2'), invite.code)).status).toBe(201);

    const third = await registerUser(uniqueEmail('multi-3'), invite.code);
    expect(third.status).toBe(400);
    expect(third.body.code).toBe('INVITE_CODE_INVALID');
  });
});

describe('管理端邀请码 CRUD', () => {
  it('非 super 角色禁止访问邀请码管理', async () => {
    const res = await request(app)
      .get('/api/admin/invites')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(403);
  });

  it('创建时称号必填', async () => {
    const res = await createInviteViaAdmin({ airline: '测试航司' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('创建、编辑、删除未使用邀请码', async () => {
    const createRes = await createInviteViaAdmin({ code: 'EDITME2026', title: '编辑测试' });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { id: string; code: string; title: string };
    expect(invite.code).toBe('EDITME2026');

    const updateRes = await request(app)
      .put(`/api/admin/invites/${invite.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ title: '编辑后的称号', max_uses: 3, remark: '测试备注' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe('编辑后的称号');
    expect(updateRes.body.data.max_uses).toBe(3);

    const deleteRes = await request(app)
      .delete(`/api/admin/invites/${invite.id}`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(deleteRes.status).toBe(200);
    expect(await db.get('SELECT id FROM invite_codes WHERE id = ?', invite.id)).toBeUndefined();
  });

  it('已使用邀请码删除返回 409', async () => {
    const createRes = await createInviteViaAdmin({ title: '已用删除测试' });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { id: string; code: string };

    expect((await registerUser(uniqueEmail('used-delete'), invite.code)).status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/api/admin/invites/${invite.id}`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.code).toBe('INVITE_CODE_IN_USE');
  });

  it('可用次数不得低于已使用次数', async () => {
    const createRes = await createInviteViaAdmin({ title: '次数下限测试', max_uses: 2 });
    expect(createRes.status).toBe(201);
    const invite = createRes.body.data as { id: string; code: string };

    expect((await registerUser(uniqueEmail('limit-1'), invite.code)).status).toBe(201);
    expect((await registerUser(uniqueEmail('limit-2'), invite.code)).status).toBe(201);

    const updateRes = await request(app)
      .put(`/api/admin/invites/${invite.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ max_uses: 1 });
    expect(updateRes.status).toBe(400);
  });
});
