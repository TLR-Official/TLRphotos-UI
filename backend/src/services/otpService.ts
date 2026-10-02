/**
 * @file otpService.ts
 * @description 一次性验证码（OTP）生命周期管理服务。
 *              负责验证码的生成、哈希入库、校验与过期清理：
 *              1. 生成：6 位随机数字码（crypto.randomInt 安全随机源）；
 *              2. 存储：仅存 HMAC-SHA256 哈希（密钥 = JWT_SECRET），
 *                 明文码只在内存中返回给发送通道，绝不入库、不落日志；
 *              3. 校验：crypto.timingSafeEqual 恒时比较防时序攻击，
 *                 错误尝试计数，达 5 次自动作废锁定；过期 / 已用记录一律拒绝；
 *              4. 清理：每日定时删除 7 天前记录（server.ts 调度），防止表膨胀。
 *
 *              数据表：verification_codes（见 db.ts），同 target+scene 任一时刻
 *              仅存在一条未使用记录（createCodeRecord 先作废旧记录再插入新记录）。
 */
import crypto from 'crypto';
import { db } from '../db';

/** 验证码有效期：10 分钟 */
const OTP_TTL_MS = 10 * 60 * 1000;
/** 单条验证码最大错误尝试次数：达到即作废锁定 */
const MAX_ATTEMPTS = 5;
/** 记录保留时长：7 天（每日清理任务的删除阈值） */
const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 发送通道：短信 / 邮件 */
export type OtpChannel = 'sms' | 'mail';
/** 业务场景：登录 / 注册 / 绑定手机号 / 超管登录第二因素 */
export type OtpScene = 'login' | 'register' | 'bind_phone' | 'admin_login';
/** 校验失败原因码（供路由层映射 HTTP 响应与文案） */
export type OtpVerifyError = 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED' | 'OTP_MISMATCH' | 'OTP_NOT_FOUND';

/**
 * 生成 6 位数字验证码。
 * randomInt 上限为开区间 [0, 1000000)，padStart 补齐前导零保证恒为 6 位。
 */
export function generateCode(): string {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

/**
 * 计算验证码的 HMAC-SHA256 哈希（密钥 = JWT_SECRET）。
 * 数据库与日志中只允许出现该哈希，禁止明文落盘。
 */
export function hashCode(code: string): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(code).digest('hex');
}

/**
 * 创建验证码记录：生成明文码 → 作废同 target+scene 的旧未用记录 → 入库新记录（存哈希）。
 * 两步写操作置于同一事务，避免并发请求产生多条有效码。
 *
 * @param target 接收目标（手机号或邮箱）
 * @param channel 发送通道
 * @param scene 业务场景
 * @param ip 请求来源 IP（审计用）
 * @returns 明文验证码 — 仅用于立即发送，调用方严禁入库 / 落日志
 */
export async function createCodeRecord(
  target: string,
  channel: OtpChannel,
  scene: OtpScene,
  ip: string
): Promise<string> {
  const code = generateCode();
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await db.exec('BEGIN');
  try {
    // 作废旧记录：同 target+scene 任一时刻仅保留一条未使用验证码
    await db.run(
      'UPDATE verification_codes SET used_at = ? WHERE target = ? AND scene = ? AND used_at IS NULL',
      [nowIso, target, scene]
    );
    await db.run(
      `INSERT INTO verification_codes (id, target, channel, scene, code_hash, attempts, expires_at, used_at, ip, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
      [id, target, channel, scene, hashCode(code), expiresAt, ip, nowIso]
    );
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }

  return code;
}

/**
 * 校验验证码。
 * 取该 target+scene 最新一条未使用记录，依次判定：无记录 → 已锁定 → 已过期 → 哈希比对。
 * 哈希比对失败时 attempts +1；达 5 次上限时同步置 used_at 作废并返回 OTP_LOCKED。
 * 校验通过立即置 used_at，保证一次性消费。
 *
 * @returns ok=true 表示通过；否则 error 为失败原因码
 */
export async function verifyCode(
  target: string,
  code: string,
  scene: string
): Promise<{ ok: boolean; error?: OtpVerifyError }> {
  const row = await db.get(
    `SELECT id, code_hash, attempts, expires_at
     FROM verification_codes
     WHERE target = ? AND scene = ? AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [target, scene]
  );

  if (!row) {
    return { ok: false, error: 'OTP_NOT_FOUND' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'OTP_LOCKED' };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'OTP_EXPIRED' };
  }

  // 恒时比较防时序攻击：timingSafeEqual 要求等长 Buffer，须先校验长度
  const expected = Buffer.from(row.code_hash, 'utf8');
  const actual = Buffer.from(hashCode(code), 'utf8');
  const matched = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matched) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // 错误尝试达上限：计数并同步作废该验证码，杜绝继续暴力尝试
      await db.run('UPDATE verification_codes SET attempts = ?, used_at = ? WHERE id = ?', [
        attempts,
        new Date().toISOString(),
        row.id,
      ]);
      return { ok: false, error: 'OTP_LOCKED' };
    }
    await db.run('UPDATE verification_codes SET attempts = ? WHERE id = ?', [attempts, row.id]);
    return { ok: false, error: 'OTP_MISMATCH' };
  }

  await db.run('UPDATE verification_codes SET used_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
  return { ok: true };
}

/**
 * 清理 7 天前的验证码记录（server.ts 每日定时任务调用），防止表无限膨胀。
 */
export async function cleanupExpiredCodes(): Promise<void> {
  const cutoff = new Date(Date.now() - CLEANUP_RETENTION_MS).toISOString();
  await db.run('DELETE FROM verification_codes WHERE created_at < ?', [cutoff]);
}

/**
 * 接收目标脱敏（供日志使用，禁止输出完整手机号 / 邮箱）。
 * 邮箱：保留首字符与域名（a***@example.com）；手机号：保留前 3 位与后 4 位（138****1234）。
 */
export function maskTarget(target: string): string {
  const atIndex = target.indexOf('@');
  if (atIndex > 0) {
    return `${target.slice(0, 1)}***@${target.slice(atIndex + 1)}`;
  }
  if (target.length >= 7) {
    return `${target.slice(0, 3)}****${target.slice(-4)}`;
  }
  // 异常短输入：整体脱敏兜底
  return '***';
}
