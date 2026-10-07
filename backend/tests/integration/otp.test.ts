/**
 * @file 邮箱验证码与两段式登录集成测试（V2.0.0：纯邮箱认证体系）
 * @description 覆盖邮箱验证码体系的完整业务链路：
 *              1. POST /api/auth/email/code/send —— login/register/bind_email
 *                 三场景注册状态规则、参数校验、60s 冷却 429、未配置邮件服务 503
 *              2. POST /api/auth/login —— 两段式第一步（otp_required + login_ticket，不签发 JWT）
 *              3. POST /api/auth/login/verify —— 签发 JWT / 老用户首次登录自动确权 /
 *                 OTP_MISMATCH / OTP_LOCKED / OTP_EXPIRED / 无效票据 / 跨 IP 票据
 *              4. POST /api/auth/register —— 邮箱验证码注册、重复注册 409
 *              5. POST /api/auth/email/bind —— JWT 用户更换邮箱、重复邮箱 409
 *
 *              阿里云邮件发送通道经 vi.mock 拦截并捕获明文码（不触达真实网络）；
 *              Turnstile 校验打桩放行（人机验证本身由 verification.test.ts 覆盖）。
 *              测试库经 DB_PATH 隔离；60s 冷却用例经 RATE_LIMIT_ENABLED=1 +
 *              vi.resetModules() 构建独立限速应用，不影响其余用例（默认测试环境限速放行）。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

/** 捕获邮件通道收到的明文验证码：email -> code（仅存测试内存，不落盘） */
const otpCapture = vi.hoisted(() => ({ codes: new Map<string, string>() }));

vi.mock('../../src/services/aliMailService', () => ({
  sendMailCode: vi.fn(async (to: string, code: string) => {
    otpCapture.codes.set(to, code);
  }),
}));

vi.mock('../../src/services/verificationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/verificationService')>();
  return {
    ...actual,
    verifyTurnstileToken: vi.fn(async () => ({ ok: true }) as any),
  };
});

/** login_ticket 绑定客户端 IP：登录第一步与 verify 步必须同 IP，统一固定便于断言 */
const FIXED_IP = '203.0.113.10';

let app: express.Application;
let db: import('../../src/db').Database;

beforeAll(async () => {
  // 测试库隔离：DB_PATH 必须先于 db 模块导入设置
  const testDbPath = path.join(__dirname, '../../data/test-otp-database.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  process.env.DB_PATH = testDbPath;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.TEST_BYPASS_TOKEN = 'test-verification-bypass';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;

  const authRoutes = (await import('../../src/routes/auth')).default;

  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

/** 发送邮箱验证码（固定 XFF），返回响应与捕获到的明文码 */
async function requestEmailCode(email: string, scene: string, headers: Record<string, string> = {}) {
  const res = await request(app)
    .post('/api/auth/email/code/send')
    .set('X-Forwarded-For', FIXED_IP)
    .set(headers)
    .send({ email, scene, turnstile_token: 'x' });
  return { res, code: otpCapture.codes.get(email) };
}

/** 完整注册流程：email/code/send 取码 → register 携带验证码 */
async function registerUser(email: string, password = 'Test123456') {
  const { res: sendRes, code } = await requestEmailCode(email, 'register');
  expect(sendRes.status).toBe(200);
  return request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', FIXED_IP)
    .send({ email, password, code, turnstile_token: 'x' });
}

/** 两段式登录第一步：密码校验，返回响应（含 login_ticket） */
async function loginStep1(email: string, password: string) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', FIXED_IP)
    .send({ email, password, turnstile_token: 'x' });
}

/** 生成与给定码不同的合法 6 位错误码 */
function wrongCodeOf(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

describe('POST /api/auth/email/code/send', () => {
  it('register 场景发送成功（固定 channel=mail，目标脱敏）', async () => {
    const email = `send-mail-${Date.now()}@example.com`;
    const { res, code } = await requestEmailCode(email, 'register');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channel).toBe('mail');
    expect(res.body.data.cooldown).toBe(60);
    expect(res.body.data.expires_minutes).toBe(10);
    expect(res.body.data.target).toBe('s***@example.com');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('login 场景未注册邮箱返回 404 EMAIL_NOT_REGISTERED', async () => {
    const { res } = await requestEmailCode(`no-email-${Date.now()}@example.com`, 'login');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EMAIL_NOT_REGISTERED');
  });

  it('register 场景已存在账号返回 409 ALREADY_REGISTERED', async () => {
    const email = `send-dup-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    expect(reg.status).toBe(201);

    const { res } = await requestEmailCode(email, 'register');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });

  it('非法邮箱格式返回 400 INVALID_PARAMS', async () => {
    const { res } = await requestEmailCode('not-an-email', 'register');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PARAMS');
  });

  it('非法场景返回 400 INVALID_PARAMS', async () => {
    const { res } = await requestEmailCode(`bad-scene-${Date.now()}@example.com`, 'reset');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PARAMS');
  });

  it('bind_email 场景无 JWT / 票据返回 401 UNAUTHORIZED', async () => {
    const { res } = await requestEmailCode(`bind-anon-${Date.now()}@example.com`, 'bind_email');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('bind_email 场景持 JWT 发送成功', async () => {
    const email = `bindjwt-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    const token = reg.body.data.token;

    const newEmail = `bindjwt-new-${Date.now()}@example.com`;
    const { res, code } = await requestEmailCode(newEmail, 'bind_email', {
      Authorization: `Bearer ${token}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.channel).toBe('mail');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('bind_email 场景目标邮箱已被他人占用返回 409 ALREADY_REGISTERED', async () => {
    const emailA = `bindconf-a-${Date.now()}@example.com`;
    const regA = await registerUser(emailA);
    const emailB = `bindconf-b-${Date.now()}@example.com`;
    await registerUser(emailB);

    const { res } = await requestEmailCode(emailB, 'bind_email', {
      Authorization: `Bearer ${regA.body.data.token}`,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });

  it('邮件服务未配置时返回 503 OTP_SERVICE_NOT_CONFIGURED 且作废旧记录', async () => {
    const email = `nosvc-${Date.now()}@example.com`;
    const { sendMailCode } = await import('../../src/services/aliMailService');
    vi.mocked(sendMailCode).mockRejectedValueOnce(
      Object.assign(new Error('验证码服务未配置'), { status: 503, code: 'OTP_SERVICE_NOT_CONFIGURED' })
    );

    const { res } = await requestEmailCode(email, 'register');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OTP_SERVICE_NOT_CONFIGURED');

    // 发送失败路径必须作废刚创建的记录，避免残留可校验的死码
    const alive = await db.get(
      "SELECT id FROM verification_codes WHERE target = ? AND scene = 'register' AND used_at IS NULL",
      email
    );
    expect(alive).toBeUndefined();
  });
});

describe('POST /api/auth/email/code/send 60s 冷却限速（独立限速应用）', () => {
  it('同一邮箱 60 秒内重复发送返回 429 RATE_LIMITED', async () => {
    // 限速器默认在测试环境放行；显式开启后经 resetModules 重建模块图，
    // 使新限速器实例捕获 RATE_LIMIT_ENABLED=1，其余用例所在 app 不受影响
    process.env.RATE_LIMIT_ENABLED = '1';
    try {
      vi.resetModules();
      const dbModule = await import('../../src/db');
      await dbModule.initDb();
      const authRoutes = (await import('../../src/routes/auth')).default;

      const limitedApp = express();
      limitedApp.use(express.json());
      limitedApp.use('/api/auth', authRoutes);

      const email = `cooldown-${Date.now()}@example.com`;
      const first = await request(limitedApp)
        .post('/api/auth/email/code/send')
        .send({ email, scene: 'register', turnstile_token: 'x' });
      expect(first.status).toBe(200);

      const second = await request(limitedApp)
        .post('/api/auth/email/code/send')
        .send({ email, scene: 'register', turnstile_token: 'x' });
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('RATE_LIMITED');
    } finally {
      delete process.env.RATE_LIMIT_ENABLED;
    }
  });
});

describe('POST /api/auth/login 两段式第一步', () => {
  it('密码正确返回 otp_required + login_ticket，不签发 JWT', async () => {
    const email = `twostage-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    expect(reg.status).toBe(201);

    const res = await loginStep1(email, 'Test123456');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.otp_required).toBe(true);
    expect(res.body.data.login_ticket).toBeTruthy();
    expect(res.body.data.expires_minutes).toBe(10);
    // 第一步绝不下发正式凭证
    expect(res.body.data).not.toHaveProperty('token');
    expect(res.body.data).not.toHaveProperty('session_token');
  });

  it('密码错误返回 401', async () => {
    const email = `twostage-bad-${Date.now()}@example.com`;
    await registerUser(email);

    const res = await loginStep1(email, 'WrongPassword');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/auth/login/verify 两段式第二步', () => {
  it('login_ticket + 正确验证码签发 JWT 与会话，老用户首次登录自动确权', async () => {
    const email = `verify-ok-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    const userId = reg.body.data.user.id;
    // 模拟 V2.0.0 前注册、未经任何验证的老用户
    await db.run('UPDATE users SET email_verified = 0 WHERE id = ?', userId);

    const step1 = await loginStep1(email, 'Test123456');
    const ticket = step1.body.data.login_ticket;
    const { code } = await requestEmailCode(email, 'login');

    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: ticket, code });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.session_token).toBeTruthy();
    expect(res.body.data.user.email).toBe(email);

    // 老用户验码通过即自动完成邮箱确权
    const row = await db.get('SELECT email_verified FROM users WHERE id = ?', userId);
    expect(row.email_verified).toBe(1);
  });

  it('错误验证码返回 400 OTP_MISMATCH', async () => {
    const email = `verify-mismatch-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const { code } = await requestEmailCode(email, 'login');

    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: step1.body.data.login_ticket, code: wrongCodeOf(code!) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_MISMATCH');
  });

  it('连续 5 次错误返回 400 OTP_LOCKED', async () => {
    const email = `verify-lock-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const ticket = step1.body.data.login_ticket;
    const { code } = await requestEmailCode(email, 'login');
    const wrong = wrongCodeOf(code!);

    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/auth/login/verify')
        .set('X-Forwarded-For', FIXED_IP)
        .send({ login_ticket: ticket, code: wrong });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_MISMATCH');
    }
    const fifth = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: ticket, code: wrong });
    expect(fifth.status).toBe(400);
    expect(fifth.body.code).toBe('OTP_LOCKED');
  });

  it('过期验证码返回 400 OTP_EXPIRED', async () => {
    const email = `verify-expired-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const { code } = await requestEmailCode(email, 'login');

    // 直接改库模拟验证码过期
    await db.run(
      "UPDATE verification_codes SET expires_at = ? WHERE target = ? AND scene = 'login' AND used_at IS NULL",
      new Date(Date.now() - 60_000).toISOString(),
      email
    );

    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: step1.body.data.login_ticket, code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  it('无效 login_ticket 返回 401 INVALID_TICKET', async () => {
    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: 'tampered.ticket', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TICKET');
  });

  it('login_ticket 跨 IP 使用返回 401 INVALID_TICKET', async () => {
    const email = `verify-ip-${Date.now()}@example.com`;
    await registerUser(email);

    // 第一步从 FIXED_IP 出票
    const step1 = await loginStep1(email, 'Test123456');
    const ticket = step1.body.data.login_ticket;

    // verify 换 IP：票据 IP 绑定立即失效
    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', '198.51.100.77')
      .send({ login_ticket: ticket, code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TICKET');
  });
});

describe('POST /api/auth/register 邮箱验证码注册', () => {
  it('注册成功：签发 JWT、email 写入且 email_verified=1', async () => {
    const email = `reg-mail-${Date.now()}@example.com`;
    const reg = await registerUser(email);

    expect(reg.status).toBe(201);
    expect(reg.body.success).toBe(true);
    expect(reg.body.data.user.email).toBe(email);
    expect(reg.body.data.token).toBeTruthy();
    expect(reg.body.data.session_token).toBeTruthy();

    const row = await db.get('SELECT email, email_verified FROM users WHERE email = ?', email);
    expect(row.email).toBe(email);
    expect(row.email_verified).toBe(1);
  });

  it('缺少验证码返回 400 OTP_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ email: `nocode-${Date.now()}@example.com`, password: 'Test123456', turnstile_token: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_REQUIRED');
  });

  it('重复注册返回 409 ALREADY_REGISTERED', async () => {
    const email = `reg-dup-${Date.now()}@example.com`;
    const first = await registerUser(email);
    expect(first.status).toBe(201);

    // 已注册邮箱无法再通过 code/send(register) 取码（409），直接写入验证码记录模拟并发间隙
    const { createCodeRecord } = await import('../../src/services/otpService');
    const code = await createCodeRecord(email, 'register', FIXED_IP);
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ email, password: 'Test123456', code, turnstile_token: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });
});

describe('POST /api/auth/email/bind 更换邮箱（JWT 路径）', () => {
  it('登录用户更换邮箱成功（email_verified=1）', async () => {
    const oldEmail = `bindold-${Date.now()}@example.com`;
    const reg = await registerUser(oldEmail);
    const token = reg.body.data.token;

    const newEmail = `bindnew-${Date.now()}@example.com`;
    const { res: sendRes, code } = await requestEmailCode(newEmail, 'bind_email', {
      Authorization: `Bearer ${token}`,
    });
    expect(sendRes.status).toBe(200);

    const res = await request(app)
      .post('/api/auth/email/bind')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', FIXED_IP)
      .send({ email: newEmail, code, turnstile_token: 'x' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(newEmail);
    expect(res.body.data.email_verified).toBe(1);

    // 旧邮箱地址已不属于该账号
    const oldRow = await db.get('SELECT id FROM users WHERE email = ?', oldEmail);
    expect(oldRow).toBeUndefined();
    const newRow = await db.get('SELECT email FROM users WHERE id = ?', res.body.data.id);
    expect(newRow.email).toBe(newEmail);
  });

  it('目标邮箱已被其他账号绑定返回 409 ALREADY_REGISTERED', async () => {
    const regA = await registerUser(`bind-a-${Date.now()}@example.com`);
    const tokenA = regA.body.data.token;
    const emailB = `bind-b-${Date.now()}@example.com`;
    await registerUser(emailB);

    // 发送阶段即 409，直接写入 bind_email 验证码记录走确认步查重
    const { createCodeRecord } = await import('../../src/services/otpService');
    const code = await createCodeRecord(emailB, 'bind_email', FIXED_IP);
    const res = await request(app)
      .post('/api/auth/email/bind')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Forwarded-For', FIXED_IP)
      .send({ email: emailB, code, turnstile_token: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });

  it('无 JWT 且无 bind_ticket 返回 401', async () => {
    const res = await request(app)
      .post('/api/auth/email/bind')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ email: `noauth-${Date.now()}@example.com`, code: '123456', turnstile_token: 'x' });

    expect(res.status).toBe(401);
  });
});
