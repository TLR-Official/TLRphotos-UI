/**
 * @file OTP 验证码与两段式登录集成测试（V1.11.0）
 * @description 覆盖登录验证码体系的完整业务链路：
 *              1. POST /api/auth/otp/send —— 邮箱/手机号发送、login/register/bind_phone
 *                 三场景注册状态规则、60s 冷却 429、未配置模板 503
 *              2. POST /api/auth/login —— 两段式第一步（otp_required + login_ticket + channels）
 *              3. POST /api/auth/login/verify —— 签发 JWT / OTP_MISMATCH / OTP_LOCKED /
 *                 OTP_EXPIRED / 无效票据 401
 *              4. POST /api/auth/register —— 邮箱/手机号验证码注册、重复注册 409
 *              5. POST /api/auth/phone/bind —— 登录用户绑定手机号、重复绑定 409
 *
 *              Spug 发送通道经 vi.mock 拦截并捕获明文码（不触达真实网络）；
 *              Turnstile 校验打桩放行（人机验证本身由 verification.test.ts 覆盖）。
 *              测试库经 DB_PATH 隔离；60s 冷却用例经 RATE_LIMIT_ENABLED=1 +
 *              vi.resetModules() 构建独立限速应用，不影响其余用例（默认测试环境限速放行）。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

/** 捕获发送通道收到的明文验证码：target -> code（仅存测试内存，不落盘） */
const otpCapture = vi.hoisted(() => ({ codes: new Map<string, string>() }));

vi.mock('../../src/services/spugService', () => ({
  sendSmsCode: vi.fn(async (to: string, code: string) => {
    otpCapture.codes.set(to, code);
  }),
}));

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
let createCodeRecord: typeof import('../../src/services/otpService').createCodeRecord;

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
  ({ createCodeRecord } = await import('../../src/services/otpService'));

  const authRoutes = (await import('../../src/routes/auth')).default;

  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

/** 发送验证码（固定 XFF），返回响应与捕获到的明文码 */
async function requestOtp(target: string, scene: string, headers: Record<string, string> = {}) {
  const res = await request(app)
    .post('/api/auth/otp/send')
    .set('X-Forwarded-For', FIXED_IP)
    .set(headers)
    .send({ target, scene, turnstile_token: 'x' });
  return { res, code: otpCapture.codes.get(target) };
}

/** 完整注册流程：otp/send 取码 → register 携带验证码 */
async function registerUser(identifier: string, password = 'Test123456') {
  const { res: sendRes, code } = await requestOtp(identifier, 'register');
  expect(sendRes.status).toBe(200);
  return request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', FIXED_IP)
    .send({ identifier, password, code, turnstile_token: 'x' });
}

/** 两段式登录第一步：密码校验，返回响应（含 login_ticket） */
async function loginStep1(identifier: string, password: string) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', FIXED_IP)
    .send({ identifier, password, turnstile_token: 'x' });
}

/** 生成与给定码不同的合法 6 位错误码 */
function wrongCodeOf(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

describe('POST /api/auth/otp/send', () => {
  it('邮箱 register 场景发送成功（channel=mail，目标脱敏）', async () => {
    const email = `send-mail-${Date.now()}@example.com`;
    const { res, code } = await requestOtp(email, 'register');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channel).toBe('mail');
    expect(res.body.data.cooldown).toBe(60);
    expect(res.body.data.expires_minutes).toBe(10);
    expect(res.body.data.target).toBe('s***@example.com');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('手机号 register 场景发送成功（channel=sms）', async () => {
    const phone = `139${String(Date.now()).slice(-8)}`;
    const { res, code } = await requestOtp(phone, 'register');

    expect(res.status).toBe(200);
    expect(res.body.data.channel).toBe('sms');
    expect(res.body.data.target).toBe(`${phone.slice(0, 3)}****${phone.slice(-4)}`);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('login 场景未注册邮箱返回 404 EMAIL_NOT_REGISTERED', async () => {
    const { res } = await requestOtp(`no-email-${Date.now()}@example.com`, 'login');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EMAIL_NOT_REGISTERED');
  });

  it('login 场景未注册手机号返回 404 PHONE_NOT_REGISTERED', async () => {
    const { res } = await requestOtp(`138${String(Date.now()).slice(-8)}`, 'login');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PHONE_NOT_REGISTERED');
  });

  it('register 场景已存在账号返回 409 ALREADY_REGISTERED', async () => {
    const email = `send-dup-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    expect(reg.status).toBe(201);

    const { res } = await requestOtp(email, 'register');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });

  it('bind_phone 场景未登录返回 401', async () => {
    const { res } = await requestOtp(`137${String(Date.now()).slice(-8)}`, 'bind_phone');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('阿里云邮件服务未配置时返回 503 OTP_SERVICE_NOT_CONFIGURED 且作废旧记录', async () => {
    const email = `nosvc-${Date.now()}@example.com`;
    const { sendMailCode } = await import('../../src/services/aliMailService');
    vi.mocked(sendMailCode).mockRejectedValueOnce(
      Object.assign(new Error('验证码服务未配置'), { status: 503, code: 'OTP_SERVICE_NOT_CONFIGURED' })
    );

    const { res } = await requestOtp(email, 'register');
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

describe('POST /api/auth/otp/send 60s 冷却限速（独立限速应用）', () => {
  it('同一 target 60 秒内重复发送返回 429 RATE_LIMITED', async () => {
    // 限速器默认在测试环境放行；显式开启后经 resetModules 重建模块图，
    // 使新限速器实例捕获 RATE_LIMITED=1，其余用例所在 app 不受影响
    process.env.RATE_LIMIT_ENABLED = '1';
    try {
      vi.resetModules();
      const dbModule = await import('../../src/db');
      await dbModule.initDb();
      const authRoutes = (await import('../../src/routes/auth')).default;

      const limitedApp = express();
      limitedApp.use(express.json());
      limitedApp.use('/api/auth', authRoutes);

      const target = `cooldown-${Date.now()}@example.com`;
      const first = await request(limitedApp)
        .post('/api/auth/otp/send')
        .send({ target, scene: 'register', turnstile_token: 'x' });
      expect(first.status).toBe(200);

      const second = await request(limitedApp)
        .post('/api/auth/otp/send')
        .send({ target, scene: 'register', turnstile_token: 'x' });
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('RATE_LIMITED');
    } finally {
      delete process.env.RATE_LIMIT_ENABLED;
    }
  });
});

describe('POST /api/auth/login 两段式第一步', () => {
  it('密码正确返回 otp_required + login_ticket + channels，不签发 JWT', async () => {
    const email = `twostage-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    expect(reg.status).toBe(201);

    const res = await loginStep1(email, 'Test123456');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.otp_required).toBe(true);
    expect(res.body.data.login_ticket).toBeTruthy();
    expect(res.body.data.channels).toContain('email');
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
  it('login_ticket + 正确验证码签发 JWT 与会话', async () => {
    const email = `verify-ok-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const ticket = step1.body.data.login_ticket;
    const { code } = await requestOtp(email, 'login');

    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: ticket, channel: 'email', code });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.session_token).toBeTruthy();
    expect(res.body.data.user.email).toBe(email);
  });

  it('错误验证码返回 400 OTP_MISMATCH', async () => {
    const email = `verify-mismatch-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const { code } = await requestOtp(email, 'login');

    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: step1.body.data.login_ticket, channel: 'email', code: wrongCodeOf(code!) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_MISMATCH');
  });

  it('连续 5 次错误返回 400 OTP_LOCKED', async () => {
    const email = `verify-lock-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const ticket = step1.body.data.login_ticket;
    const { code } = await requestOtp(email, 'login');
    const wrong = wrongCodeOf(code!);

    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/auth/login/verify')
        .set('X-Forwarded-For', FIXED_IP)
        .send({ login_ticket: ticket, channel: 'email', code: wrong });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_MISMATCH');
    }
    const fifth = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: ticket, channel: 'email', code: wrong });
    expect(fifth.status).toBe(400);
    expect(fifth.body.code).toBe('OTP_LOCKED');
  });

  it('过期验证码返回 400 OTP_EXPIRED', async () => {
    const email = `verify-expired-${Date.now()}@example.com`;
    await registerUser(email);

    const step1 = await loginStep1(email, 'Test123456');
    const { code } = await requestOtp(email, 'login');

    // 直接改库模拟验证码过期
    await db.run(
      "UPDATE verification_codes SET expires_at = ? WHERE target = ? AND scene = 'login' AND used_at IS NULL",
      new Date(Date.now() - 60_000).toISOString(),
      email
    );

    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: step1.body.data.login_ticket, channel: 'email', code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  it('无效 login_ticket 返回 401 INVALID_TICKET', async () => {
    const res = await request(app)
      .post('/api/auth/login/verify')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ login_ticket: 'tampered.ticket', channel: 'email', code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TICKET');
  });
});

describe('POST /api/auth/register 验证码注册', () => {
  it('邮箱注册成功：签发 JWT 且 email 写入', async () => {
    const email = `reg-mail-${Date.now()}@example.com`;
    const reg = await registerUser(email);

    expect(reg.status).toBe(201);
    expect(reg.body.success).toBe(true);
    expect(reg.body.data.user.email).toBe(email);
    expect(reg.body.data.token).toBeTruthy();
    expect(reg.body.data.session_token).toBeTruthy();

    const row = await db.get('SELECT email, phone, phone_verified FROM users WHERE email = ?', email);
    expect(row.email).toBe(email);
    expect(row.phone).toBeNull();
    expect(row.phone_verified).toBe(0);
  });

  it('手机号注册成功：email=NULL 且 phone_verified=1，缺省用户名「用户+后4位」', async () => {
    const phone = `136${String(Date.now()).slice(-8)}`;
    const reg = await registerUser(phone);

    expect(reg.status).toBe(201);
    expect(reg.body.data.user.email).toBeNull();
    expect(reg.body.data.token).toBeTruthy();

    const row = await db.get('SELECT email, phone, phone_verified, username FROM users WHERE phone = ?', phone);
    expect(row.email).toBeNull();
    expect(row.phone).toBe(phone);
    expect(row.phone_verified).toBe(1);
    expect(row.username).toBe(`用户${phone.slice(-4)}`);
  });

  it('重复注册返回 409 ALREADY_REGISTERED', async () => {
    const email = `reg-dup-${Date.now()}@example.com`;
    const first = await registerUser(email);
    expect(first.status).toBe(201);

    // 已注册邮箱无法再通过 otp/send(register) 取码（409），直接写入验证码记录模拟并发间隙
    const code = await createCodeRecord(email, 'mail', 'register', FIXED_IP);
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', FIXED_IP)
      .send({ identifier: email, password: 'Test123456', code, turnstile_token: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });
});

describe('POST /api/auth/phone/bind 绑定手机号', () => {
  it('登录用户绑定手机号成功（phone_verified=1）', async () => {
    const email = `bind-${Date.now()}@example.com`;
    const reg = await registerUser(email);
    const token = reg.body.data.token;

    const phone = `135${String(Date.now()).slice(-8)}`;
    const { res: sendRes, code } = await requestOtp(phone, 'bind_phone', {
      Authorization: `Bearer ${token}`,
    });
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.data.channel).toBe('sms');

    const res = await request(app)
      .post('/api/auth/phone/bind')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone, code, turnstile_token: 'x' });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(phone);
    expect(res.body.data.phone_verified).toBe(1);
  });

  it('手机号已被其他账号绑定返回 409 ALREADY_REGISTERED', async () => {
    // 用户 A 先绑定手机号
    const regA = await registerUser(`bind-a-${Date.now()}@example.com`);
    const tokenA = regA.body.data.token;
    const phone = `134${String(Date.now()).slice(-8)}`;
    const { code: codeA } = await requestOtp(phone, 'bind_phone', { Authorization: `Bearer ${tokenA}` });
    const bindA = await request(app)
      .post('/api/auth/phone/bind')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ phone, code: codeA, turnstile_token: 'x' });
    expect(bindA.status).toBe(200);

    // 用户 B 尝试绑定同一手机号：otp/send(bind_phone) 会 409，直接写入验证码记录走到底层查重
    const regB = await registerUser(`bind-b-${Date.now()}@example.com`);
    const tokenB = regB.body.data.token;
    const codeB = await createCodeRecord(phone, 'sms', 'bind_phone', FIXED_IP);
    const res = await request(app)
      .post('/api/auth/phone/bind')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ phone, code: codeB, turnstile_token: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_REGISTERED');
  });
});
