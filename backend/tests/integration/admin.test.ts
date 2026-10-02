/**
 * @file 管理后台路由集成测试
 * @description 测试管理员认证、权限控制、照片审核工作流等核心管理功能
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

// 短信通道整体 mock：第二因素不发真实短信，验证码从 mock 调用参数中读取
vi.mock('../../src/services/spugService');
import { sendSmsCode } from '../../src/services/spugService';

let app: express.Application;
/** 不注入测试绕过令牌的裸应用：用于验证 Turnstile 强制校验 */
let rawApp: express.Application;
let superAdminToken: string;
let zoneAuditorToken: string;

/**
 * 超管两阶段登录助手：
 * 第一阶段取短信票据 → 请求发送验证码 → 从 Spug mock 调用中读取本次明文码
 * → 第二阶段校验换取 JWT。
 * @param username 超管用户名
 * @param password 超管密码
 * @returns JWT、票据与第二阶段响应体
 */
async function completeSuperLogin(username: string, password: string) {
  const stage1 = await request(app)
    .post('/api/admin/login')
    .send({ username, password });
  expect(stage1.status).toBe(200);
  expect(stage1.body.sms_required).toBe(true);
  expect(stage1.body.token).toBeUndefined();
  const ticket = stage1.body.ticket as string;
  expect(typeof ticket).toBe('string');

  const send = await request(app)
    .post('/api/admin/login/sms/send')
    .send({ username, ticket });
  expect(send.status).toBe(200);

  const lastCall = vi.mocked(sendSmsCode).mock.calls.at(-1);
  if (!lastCall) throw new Error('短信通道 mock 未被调用');
  const code = lastCall[1] as string;
  expect(code).toMatch(/^\d{6}$/);

  const verify = await request(app)
    .post('/api/admin/login/sms/verify')
    .send({ username, ticket, code });
  expect(verify.status).toBe(200);
  expect(typeof verify.body.token).toBe('string');

  return { token: verify.body.token as string, ticket, body: verify.body };
}

beforeAll(async () => {
  // V1.5.1：测试库隔离，避免 admin_users/测试照片写进生产 database.db
  const testDbPath = path.join(__dirname, '../../data/test-admin-database.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  process.env.DB_PATH = testDbPath;

  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  // V1.13.0：管理员 JWT 密钥要求 trim 后 ≥32 字符，无硬编码回退
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-0123456789abcdef';
  // 配置 Turnstile 使「令牌缺失」准确命中本地 403 分支（不发起外网校验）
  process.env.TURNSTILE_SECRET = 'test-turnstile-secret';
  process.env.TURNSTILE_HOSTNAMES = 'localhost,127.0.0.1';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();

  // 创建测试用管理员账户
  const bcrypt = (await import('bcrypt')).default;
  const superAdminId = 'test-super-admin';
  const superAdminHash = await bcrypt.hash('Admin123456', 10);

  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, ?, 1, datetime('now'), datetime('now'))`,
    superAdminId, 'superadmin', superAdminHash, '超级管理员', '13800000001'
  );

  // V1.13.0：超管短信第二因素专用账号
  // 未绑手机超管：第一阶段必须被拒
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, NULL, 0, datetime('now'), datetime('now'))`,
    'test-super-unbound', 'superunbound', superAdminHash, '未绑手机超管'
  );

  // 已绑手机超管：验证码错误 / 票据篡改测试（不跑满锁定次数）
  const smsFailHash = await bcrypt.hash('SmsFail12345', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, ?, 1, datetime('now'), datetime('now'))`,
    'test-sms-fail', 'smsfailuser', smsFailHash, '短信失败测试员', '13800000003'
  );

  // 已绑手机超管：短信验证码连续错误锁定测试（专用，锁定后不再使用）
  const smsLockHash = await bcrypt.hash('SmsLock12345', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, 0, 0, ?, 1, datetime('now'), datetime('now'))`,
    'test-sms-lock', 'smslockuser', smsLockHash, '短信锁定测试员', '13800000004'
  );

  const zoneAuditorId = 'test-zone-auditor';
  const zoneAuditorHash = await bcrypt.hash('Auditor123456', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    zoneAuditorId, 'zoneauditor', zoneAuditorHash, '分区审核员'
  );

  // V1.13.0：专用账号 —— 失败锁定（lockuser）、改密（pwuser）、强制改密门（mustuser）
  const lockUserHash = await bcrypt.hash('LockPass12345', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    'test-lock-user', 'lockuser', lockUserHash, '锁定测试员'
  );

  const pwUserHash = await bcrypt.hash('PwPass123456', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 0, 0, datetime('now'), datetime('now'))`,
    'test-pw-user', 'pwuser', pwUserHash, '改密测试员'
  );

  const mustUserHash = await bcrypt.hash('MustPass12345', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, 1, 0, datetime('now'), datetime('now'))`,
    'test-must-user', 'mustuser', mustUserHash, '强制改密测试员'
  );

  // 短信 mock：直接放行，参数中的验证码供测试读取
  vi.mocked(sendSmsCode).mockResolvedValue(undefined);

  const adminRoutes = (await import('../../src/routes/admin')).default;

  app = express();
  app.use(express.json());
  // V1.8.0：测试环境人机验证绕过 —— 为请求体注入 tokens 参数，
  // isTestBypass 仅在 NODE_ENV=test 且与 TEST_BYPASS_TOKEN 完全匹配时放行
  process.env.TEST_BYPASS_TOKEN = 'test-verification-bypass';
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    req.body.tokens = 'test-verification-bypass';
    next();
  });
  app.use('/api/admin', adminRoutes);

  // 裸应用：不注入 tokens，登录必须携带有效 Turnstile 令牌
  rawApp = express();
  rawApp.use(express.json());
  rawApp.use('/api/admin', adminRoutes);

  // 超管：走两阶段登录（密码 → 短信验证码）换取 JWT
  const superLogin = await completeSuperLogin('superadmin', 'Admin123456');
  superAdminToken = superLogin.token;

  const zoneLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'zoneauditor', password: 'Auditor123456' });
  zoneAuditorToken = zoneLogin.body.token || '';
});

describe('POST /api/admin/login', () => {
  it('应成功登录超级管理员', async () => {
    expect(superAdminToken).toBeTruthy();
  });

  it('应成功登录分区审核员', async () => {
    expect(zoneAuditorToken).toBeTruthy();
  });

  it('应拒绝错误密码', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'superadmin', password: 'WrongPassword' });

    expect(res.body.success).toBe(false);
  });

  it('应拒绝不存在的管理员', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'nonexistent', password: 'password' });

    expect(res.body.success).toBe(false);
  });

  it('应拒绝缺少用户名', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'password' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/photos/pending 权限控制', () => {
  it('应在无 token 时返回 401', async () => {
    const res = await request(app).get('/api/admin/photos/pending');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('应在 token 无效时返回 401', async () => {
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
  });

  it('超级管理员应能查看待审核照片', async () => {
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('分区审核员应能查看待审核照片', async () => {
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/admin/photos/:id 权限控制', () => {
  it('应在无 token 时返回 401', async () => {
    const res = await request(app).get('/api/admin/photos/000001');

    expect(res.status).toBe(401);
  });

  it('应在照片不存在时返回 404', async () => {
    const res = await request(app)
      .get('/api/admin/photos/nonexistent-id')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/users 权限控制', () => {
  it('超级管理员应能查看用户列表', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('分区审核员不应能查看用户列表', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/logs', () => {
  it('超级管理员应能查看操作日志', async () => {
    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('分区审核员不应能查看操作日志', async () => {
    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(403);
  });
});

// ============================================================================
// V1.5.0 仪表盘数据一致性 + 上传强制登录 + 健康检查
// 覆盖：zone 过滤、total 运算符优先级修复、health 接口、上传接口 401
// ============================================================================

describe('V1.5.0 仪表盘数据与上传强制登录', () => {
  it('GET /api/admin/stats zone_auditor 仅返回本 zone 统计 + zoneName', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('zoneName');
    // zoneAuditorToken 的 zone 是 'landscape'，所以 zoneName 应为 'landscape'
    expect(res.body.data.zoneName).toBe('landscape');
  });

  it('GET /api/admin/photos/stats total = pending + approved + rejected（无运算符优先级 bug）', async () => {
    const res = await request(app)
      .get('/api/admin/photos/stats')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    const { total, pending, approved, rejected } = res.body.data;
    expect(total).toBe(pending + approved + rejected);
  });

  it('GET /api/admin/dashboard/healthy 无异常时返回 healthy=true', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard/health')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('healthy');
    expect(res.body.data).toHaveProperty('issues');
    expect(Array.isArray(res.body.data.issues)).toBe(true);
  });

  it('GET /api/admin/dashboard/health 检测到匿名照片时返回 issues', async () => {
    // 插入一条 user_id IS NULL 照片触发告警
    const { db } = await import('../../src/db');
    await db.run(
      `INSERT OR REPLACE INTO photos (id, title, thumbnail_path, original_url, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
      'test-anon-detector', '测试匿名照片', '', '', new Date().toISOString()
    );

    const res = await request(app)
      .get('/api/admin/dashboard/health')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.healthy).toBe(false);
    expect(res.body.data.issues.some((i: string) => i.includes('匿名照片'))).toBe(true);

    // 清理测试数据
    await db.run('DELETE FROM photos WHERE id = ?', 'test-anon-detector');
  });
});

// ============================================================================
// V1.13.0 管理后台登录安全加固
// 覆盖：Turnstile 强制、严格入参、失败锁定、改密旧 JWT 失效、强制改密门
// ============================================================================

describe('V1.13.0 登录 Turnstile 强制校验', () => {
  it('未携带 turnstile_token 且无测试绕过令牌时返回 403', async () => {
    const res = await request(rawApp)
      .post('/api/admin/login')
      .send({ username: 'superadmin', password: 'Admin123456' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HUMAN_VERIFICATION_FAILED');
  });
});

describe('V1.13.0 登录入参严格校验', () => {
  it('应拒绝非字符串用户名', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 12345, password: 'password' });

    expect(res.status).toBe(400);
  });

  it('应拒绝超过 64 字符的用户名', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'a'.repeat(65), password: 'password' });

    expect(res.status).toBe(400);
  });

  it('应拒绝超过 128 字符的密码', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'superadmin', password: 'a'.repeat(129) });

    expect(res.status).toBe(400);
  });
});

describe('V1.13.0 登录失败锁定（5 次失败锁定 15 分钟）', () => {
  it('连续 5 次失败后锁定，锁定期内正确密码也无法登录', async () => {
    // 前 4 次错误口令：普通 401
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'lockuser', password: `WrongPass${i}` });
      expect(res.status).toBe(401);
    }

    // 第 5 次失败触发锁定
    const fifth = await request(app)
      .post('/api/admin/login')
      .send({ username: 'lockuser', password: 'WrongPass4' });
    expect(fifth.status).toBe(403);
    expect(fifth.body.code).toBe('ADMIN_LOGIN_LOCKED');
    expect(fifth.body.data.retry_after_seconds).toBeGreaterThan(0);

    // 锁定期内即使口令正确也被锁定门拦截
    const locked = await request(app)
      .post('/api/admin/login')
      .send({ username: 'lockuser', password: 'LockPass12345' });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('ADMIN_LOGIN_LOCKED');
  });
});

describe('V1.13.0 修改密码后旧 JWT 立即失效', () => {
  it('改密成功返回新 JWT，旧 JWT 401、新 JWT 正常', async () => {
    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: 'pwuser', password: 'PwPass123456' });
    expect(login.status).toBe(200);
    const oldToken = login.body.token as string;

    const changed = await request(app)
      .post('/api/admin/me/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({
        current_password: 'PwPass123456',
        new_password: 'NewStrongPass456',
        confirm_password: 'NewStrongPass456',
      });
    expect(changed.status).toBe(200);
    expect(typeof changed.body.token).toBe('string');
    const newToken = changed.body.token as string;
    expect(newToken).not.toBe(oldToken);

    // 旧 token 因 tv 不匹配立即失效
    const withOld = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(withOld.status).toBe(401);

    // 新 token 携带最新 tv，鉴权正常
    const withNew = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${newToken}`);
    expect(withNew.status).toBe(200);
  });

  it('当前密码错误时拒绝改密', async () => {
    // 超管需先完成两阶段登录换取 JWT
    const { token } = await completeSuperLogin('superadmin', 'Admin123456');

    const res = await request(app)
      .post('/api/admin/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'IncorrectCurrent',
        new_password: 'AnotherStrong789',
        confirm_password: 'AnotherStrong789',
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('两次新密码不一致时拒绝改密', async () => {
    const res = await request(app)
      .post('/api/admin/me/password')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        current_password: 'Admin123456',
        new_password: 'AnotherStrong789',
        confirm_password: 'MismatchedStrong789',
      });
    expect(res.status).toBe(400);
  });

  it('新密码不足 12 位时拒绝改密', async () => {
    const res = await request(app)
      .post('/api/admin/me/password')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        current_password: 'Admin123456',
        new_password: 'short123',
        confirm_password: 'short123',
      });
    expect(res.status).toBe(400);
  });
});

describe('V1.13.0 强制改密门（PASSWORD_CHANGE_REQUIRED）', () => {
  it('must_change_password=1 时仅允许 GET /me 与 POST /me/password', async () => {
    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: 'mustuser', password: 'MustPass12345' });
    expect(login.status).toBe(200);
    expect(login.body.admin.must_change_password).toBe(1);
    const token = login.body.token as string;

    // 允许：查询自身信息
    const me = await request(app)
      .get('/api/admin/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);

    // 拦截：其他业务接口
    const blocked = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // 改密成功：强制状态解除，新 JWT 可访问业务接口
    const changed = await request(app)
      .post('/api/admin/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        current_password: 'MustPass12345',
        new_password: 'MustNewPass7890',
        confirm_password: 'MustNewPass7890',
      });
    expect(changed.status).toBe(200);

    const unlocked = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${changed.body.token}`);
    expect(unlocked.status).toBe(200);
  });
});

// ============================================================================
// V1.13.0 超管短信第二因素（复用 Spug 短信通道，审核员登录流程零变化）
// ============================================================================

describe('V1.13.0 超管登录短信第二因素', () => {
  it('超管第一阶段只返回短信票据，不签发 JWT', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'superadmin', password: 'Admin123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sms_required).toBe(true);
    expect(typeof res.body.ticket).toBe('string');
    expect(res.body.token).toBeUndefined();
    expect(res.body.admin).toBeUndefined();
  });

  it('未绑手机号的超管第一阶段返回 403 SUPER_PHONE_NOT_VERIFIED', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'superunbound', password: 'Admin123456' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPER_PHONE_NOT_VERIFIED');
    expect(res.body.token).toBeUndefined();
  });

  it('凭篡改票据请求发送验证码返回 401 INVALID_LOGIN_TICKET', async () => {
    const res = await request(app)
      .post('/api/admin/login/sms/send')
      .send({ username: 'smsfailuser', ticket: 'forged.body.signature' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_LOGIN_TICKET');
  });

  it('缺少票据时发送验证码返回 401', async () => {
    const res = await request(app)
      .post('/api/admin/login/sms/send')
      .send({ username: 'smsfailuser' });

    expect(res.status).toBe(401);
  });

  it('凭篡改票据校验验证码返回 401', async () => {
    const res = await request(app)
      .post('/api/admin/login/sms/verify')
      .send({ username: 'smsfailuser', ticket: 'forged.body', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_LOGIN_TICKET');
  });

  it('短信验证码错误返回 401（专用账号，仅试 1 次避免锁定）', async () => {
    // 先合法取得票据并触发验证码下发
    const stage1 = await request(app)
      .post('/api/admin/login')
      .send({ username: 'smsfailuser', password: 'SmsFail12345' });
    const ticket = stage1.body.ticket as string;
    await request(app)
      .post('/api/admin/login/sms/send')
      .send({ username: 'smsfailuser', ticket });

    const res = await request(app)
      .post('/api/admin/login/sms/verify')
      .send({ username: 'smsfailuser', ticket, code: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('正确短信验证码换取的 JWT 可访问业务接口', async () => {
    const { token } = await completeSuperLogin('smsfailuser', 'SmsFail12345');

    const pending = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${token}`);
    expect(pending.status).toBe(200);
  });

  it('审核员登录不触发短信门：直接返回 JWT 且无 sms_required', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'zoneauditor', password: 'Auditor123456' });

    expect(res.status).toBe(200);
    expect(res.body.sms_required).toBeUndefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.admin.role).toBe('zone_auditor');
  });

  it('短信验证码连续错误 5 次后锁定（专用账号，锁定后不再使用）', async () => {
    for (let i = 0; i < 4; i++) {
      // 每次重新取票据并下发新验证码（旧码被作废），再故意输错
      const stage1 = await request(app)
        .post('/api/admin/login')
        .send({ username: 'smslockuser', password: 'SmsLock12345' });
      const ticket = stage1.body.ticket as string;
      await request(app)
        .post('/api/admin/login/sms/send')
        .send({ username: 'smslockuser', ticket });

      const wrong = await request(app)
        .post('/api/admin/login/sms/verify')
        .send({ username: 'smslockuser', ticket, code: '000000' });
      expect(wrong.status).toBe(401);
    }

    // 第 5 次：OTP 锁定与失败计数锁定同时生效
    const stage1 = await request(app)
      .post('/api/admin/login')
      .send({ username: 'smslockuser', password: 'SmsLock12345' });
    const ticket = stage1.body.ticket as string;
    await request(app)
      .post('/api/admin/login/sms/send')
      .send({ username: 'smslockuser', ticket });

    const fifth = await request(app)
      .post('/api/admin/login/sms/verify')
      .send({ username: 'smslockuser', ticket, code: '000000' });
    expect(fifth.status).toBe(403);
    expect(fifth.body.code).toBe('ADMIN_LOGIN_LOCKED');
    expect(fifth.body.data.retry_after_seconds).toBeGreaterThan(0);
  });
});
