/**
 * @file otpService 单元测试（V1.11.0）
 * @description 覆盖验证码生命周期管理的核心逻辑：
 *              1. generateCode —— 恒为 6 位数字（含前导零补齐）
 *              2. hashCode —— HMAC-SHA256 确定性与区分性
 *              3. createCodeRecord —— 返回明文码、入库仅存哈希、同 target+scene 旧码作废
 *              4. verifyCode —— 通过一次性消费 / 错误递增 attempts / 5 次锁定 / 过期拒绝
 *              5. cleanupExpiredCodes —— 删除 7 天前记录
 *              6. maskTarget —— 邮箱 / 手机号 / 异常短输入脱敏
 *              测试库经 DB_PATH 隔离，不触达生产 database.db。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';

let otp: typeof import('../../src/services/otpService');
let db: import('../../src/db').Database;

beforeAll(async () => {
  // 测试库隔离：DB_PATH 必须先于 db 模块导入设置
  const testDbPath = path.join(__dirname, '../../data/test-otp-service.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  process.env.DB_PATH = testDbPath;
  process.env.JWT_SECRET = 'test-jwt-secret';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;
  otp = await import('../../src/services/otpService');
});

/** 生成一个与给定码不同的合法 6 位错误码（避免随机码碰巧相等的极小概率干扰） */
function wrongCodeOf(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

describe('generateCode', () => {
  it('生成 6 位数字验证码（批量 100 次抽样）', () => {
    for (let i = 0; i < 100; i++) {
      expect(otp.generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashCode', () => {
  it('相同输入产生相同哈希（64 位十六进制）', () => {
    const a = otp.hashCode('123456');
    expect(a).toBe(otp.hashCode('123456'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同输入产生不同哈希', () => {
    expect(otp.hashCode('123456')).not.toBe(otp.hashCode('123457'));
  });
});

describe('createCodeRecord', () => {
  it('返回 6 位明文码，入库仅存哈希且 attempts 为 0', async () => {
    const code = await otp.createCodeRecord('unit-create@example.com', 'mail', 'register', '127.0.0.1');
    expect(code).toMatch(/^\d{6}$/);

    const row = await db.get(
      'SELECT * FROM verification_codes WHERE target = ? AND scene = ?',
      'unit-create@example.com',
      'register'
    );
    expect(row).toBeTruthy();
    expect(row.code_hash).toBe(otp.hashCode(code));
    // 明文码绝不出现在库中
    expect(row.code_hash).not.toContain(code);
    expect(row.attempts).toBe(0);
    expect(row.used_at).toBeNull();
  });

  it('再次创建使同 target+scene 的旧码作废（任一时刻仅一条未使用记录）', async () => {
    await otp.createCodeRecord('unit-rotate@example.com', 'mail', 'login', '127.0.0.1');
    const second = await otp.createCodeRecord('unit-rotate@example.com', 'mail', 'login', '127.0.0.1');

    const unusedRows = await db.all(
      'SELECT * FROM verification_codes WHERE target = ? AND scene = ? AND used_at IS NULL',
      'unit-rotate@example.com',
      'login'
    );
    expect(unusedRows).toHaveLength(1);
    expect(unusedRows[0].code_hash).toBe(otp.hashCode(second));
  });
});

describe('verifyCode', () => {
  it('正确码校验通过并一次性消费（二次使用被拒）', async () => {
    const code = await otp.createCodeRecord('unit-ok@example.com', 'mail', 'login', '127.0.0.1');

    const ok = await otp.verifyCode('unit-ok@example.com', code, 'login');
    expect(ok).toEqual({ ok: true });

    // 已消费记录不得再次通过
    const again = await otp.verifyCode('unit-ok@example.com', code, 'login');
    expect(again.ok).toBe(false);
    expect(again.error).toBe('OTP_NOT_FOUND');
  });

  it('错误码返回 OTP_MISMATCH 并递增 attempts', async () => {
    const code = await otp.createCodeRecord('unit-mismatch@example.com', 'mail', 'login', '127.0.0.1');

    const res = await otp.verifyCode('unit-mismatch@example.com', wrongCodeOf(code), 'login');
    expect(res).toEqual({ ok: false, error: 'OTP_MISMATCH' });

    const row = await db.get(
      'SELECT attempts FROM verification_codes WHERE target = ? AND used_at IS NULL',
      'unit-mismatch@example.com'
    );
    expect(row.attempts).toBe(1);
  });

  it('连续 5 次错误后返回 OTP_LOCKED 并同步作废验证码', async () => {
    const code = await otp.createCodeRecord('unit-lock@example.com', 'mail', 'login', '127.0.0.1');
    const wrong = wrongCodeOf(code);

    for (let i = 0; i < 4; i++) {
      const res = await otp.verifyCode('unit-lock@example.com', wrong, 'login');
      expect(res.error).toBe('OTP_MISMATCH');
    }
    // 第 5 次错误达上限：锁定并作废
    const locked = await otp.verifyCode('unit-lock@example.com', wrong, 'login');
    expect(locked).toEqual({ ok: false, error: 'OTP_LOCKED' });

    // 锁定后记录已作废：即使输入正确码也无有效记录可校验
    const after = await otp.verifyCode('unit-lock@example.com', code, 'login');
    expect(after.error).toBe('OTP_NOT_FOUND');
  });

  it('过期验证码返回 OTP_EXPIRED', async () => {
    const code = await otp.createCodeRecord('unit-expired@example.com', 'mail', 'login', '127.0.0.1');
    await db.run(
      'UPDATE verification_codes SET expires_at = ? WHERE target = ?',
      new Date(Date.now() - 1000).toISOString(),
      'unit-expired@example.com'
    );

    const res = await otp.verifyCode('unit-expired@example.com', code, 'login');
    expect(res).toEqual({ ok: false, error: 'OTP_EXPIRED' });
  });

  it('无有效记录返回 OTP_NOT_FOUND', async () => {
    const res = await otp.verifyCode('unit-none@example.com', '123456', 'login');
    expect(res).toEqual({ ok: false, error: 'OTP_NOT_FOUND' });
  });
});

describe('cleanupExpiredCodes', () => {
  it('删除 7 天前记录并保留近期记录', async () => {
    await otp.createCodeRecord('unit-old@example.com', 'mail', 'login', '127.0.0.1');
    await otp.createCodeRecord('unit-new@example.com', 'mail', 'login', '127.0.0.1');

    // 将旧记录 created_at 拨到 8 天前
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db.run('UPDATE verification_codes SET created_at = ? WHERE target = ?', eightDaysAgo, 'unit-old@example.com');

    await otp.cleanupExpiredCodes();

    expect(await db.get('SELECT id FROM verification_codes WHERE target = ?', 'unit-old@example.com')).toBeUndefined();
    expect(await db.get('SELECT id FROM verification_codes WHERE target = ?', 'unit-new@example.com')).toBeTruthy();
  });
});

describe('maskTarget', () => {
  it('邮箱保留首字符与域名', () => {
    expect(otp.maskTarget('alice@example.com')).toBe('a***@example.com');
  });

  it('手机号保留前 3 位与后 4 位', () => {
    expect(otp.maskTarget('13812345678')).toBe('138****5678');
  });

  it('异常短输入整体脱敏兜底', () => {
    expect(otp.maskTarget('ab')).toBe('***');
  });
});
