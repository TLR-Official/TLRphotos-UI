/**
 * @file verificationService.ts
 * @description 人机验证服务（V1.8.0）。
 *              基于 Cloudflare Turnstile 为高危操作提供人机认证：
 *              1. canonical siteverify 服务端校验：success === true + action 匹配 +
 *                 hostname 在 TURNSTILE_HOSTNAMES 白名单内，网络异常一律 fail-closed 拒绝。
 *              2. 验证状态管理：通过一次后 168 小时（7 天）内免重复验证；
 *                 状态绑定 IP，IP 变更立即失效；登出时主动清除。
 *              3. 测试绕过：仅 NODE_ENV=test 且请求携带与 TEST_BYPASS_TOKEN 完全匹配的
 *                 tokens 参数时放行，生产环境（NODE_ENV 非 test）该通道完全关闭。
 */
import express from 'express';
import crypto from 'crypto';
import { db } from '../db';

/** 验证有效期：168 小时（7 天） */
const VERIFICATION_TTL_MS = 168 * 60 * 60 * 1000;

/** 验证主体类型：前台用户 / 管理后台管理员 */
export type SubjectType = 'user' | 'admin';

/**
 * 高危操作对应的 Turnstile action 白名单。
 * Turnstile 规范：action 为 1-32 字符，仅允许字母/数字/下划线/连字符。
 * - verify 端点用其校验前端 widget 的 data-action
 * - login / register 在各自路由内固定使用对应 action
 */
export const VERIFICATION_ACTIONS = [
  'login',
  'register',
  'change_password',
  'update_profile',
  'avatar_upload',
  'photo_upload',
  'photo_delete',
  'admin_user_admin',
] as const;
export type VerificationAction = (typeof VERIFICATION_ACTIONS)[number];

/** 人机验证 403 拦截响应体（code 供前端识别并弹出验证组件） */
export interface VerificationDenial {
  status: number;
  payload: {
    success: false;
    code: 'HUMAN_VERIFICATION_REQUIRED';
    message: string;
  };
}

/**
 * 获取客户端真实 IP（归一化为首段）。
 * 与 auth.ts getClientIp 同源（x-forwarded-for 优先），但取 XFF 首段并 trim，
 * 保证验证状态绑定与校验使用完全一致的 IP 表示（XFF 链式值不会导致误判换 IP）。
 */
export function getVerificationIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * 测试绕过判断：仅测试环境（NODE_ENV=test）且 tokens 参数与 TEST_BYPASS_TOKEN 完全匹配。
 * 生产环境（含 NODE_ENV 未设置的 systemd 运行）恒为 false，绕过通道物理关闭。
 */
export function isTestBypass(tokens: unknown): boolean {
  if (process.env.NODE_ENV !== 'test') return false;
  const expected = process.env.TEST_BYPASS_TOKEN;
  if (!expected) return false;
  return typeof tokens === 'string' && tokens.length > 0 && tokens === expected;
}

/**
 * canonical Cloudflare Turnstile siteverify 校验（fail-closed）。
 * 必须满足：success === true、action 与触发面一致、hostname 在白名单内。
 * 任何网络异常 / 非 2xx / 非 JSON 响应一律拒绝，绝不放行。
 * @param token 前端 widget 返回的 cf-turnstile-response
 * @param expectedAction 高危操作对应的 action
 * @param clientIp 客户端 IP（remoteip 附加校验）
 */
export async function verifyTurnstileToken(
  token: unknown,
  expectedAction: VerificationAction,
  clientIp: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const secret = process.env.TURNSTILE_SECRET;
  const hostnames = (process.env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  if (!secret || hostnames.length === 0) {
    console.error('Turnstile not configured: TURNSTILE_SECRET / TURNSTILE_HOSTNAMES missing');
    return { ok: false, status: 503, message: '人机验证服务未配置，请联系管理员' };
  }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { ok: false, status: 403, message: '人机验证参数无效，请重新完成验证' };
  }

  let result: { success?: boolean; action?: string; hostname?: string } | null = null;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        ...(clientIp && clientIp !== 'unknown' ? { remoteip: clientIp } : {}),
      }),
    });
    if (!resp.ok) {
      throw new Error(`siteverify HTTP ${resp.status}`);
    }
    result = await resp.json();
  } catch (err) {
    console.error('Turnstile siteverify error:', err);
    return { ok: false, status: 503, message: '人机验证服务暂不可用，请稍后重试' };
  }

  if (!result?.success) {
    return { ok: false, status: 403, message: '人机验证未通过，请重新完成验证' };
  }
  if (result.action !== expectedAction) {
    return { ok: false, status: 403, message: '人机验证操作类型不匹配，请刷新页面重试' };
  }
  const hostname = typeof result.hostname === 'string' ? result.hostname : '';
  if (!hostnames.includes(hostname)) {
    return { ok: false, status: 403, message: '人机验证来源校验失败，请通过正式站点访问' };
  }
  return { ok: true };
}

/**
 * 查询主体的有效验证状态。
 * 存在记录但已过期或 IP 与当前请求不一致时，立即删除该记录（失效）并返回 null。
 */
export async function getValidVerification(
  subjectType: SubjectType,
  subjectId: string,
  clientIp: string
): Promise<{ verifiedAt: string; expiresAt: string } | null> {
  const row = await db.get(
    'SELECT ip, verified_at, expires_at FROM user_verifications WHERE subject_type = ? AND subject_id = ?',
    [subjectType, subjectId]
  );
  if (!row) return null;

  const now = Date.now();
  const expired = new Date(row.expires_at).getTime() <= now;
  const ipChanged = row.ip !== clientIp;
  if (expired || ipChanged) {
    await db.run('DELETE FROM user_verifications WHERE subject_type = ? AND subject_id = ?', [
      subjectType,
      subjectId,
    ]);
    return null;
  }
  return { verifiedAt: row.verified_at, expiresAt: row.expires_at };
}

/**
 * 保存 / 刷新主体的验证状态（upsert，168 小时有效期）。
 * 登录成功、verify 端点校验通过时调用。
 */
export async function saveVerification(
  subjectType: SubjectType,
  subjectId: string,
  clientIp: string,
  action: VerificationAction
): Promise<void> {
  const id = crypto.randomUUID();
  const verifiedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await db.run(
    `INSERT INTO user_verifications (id, subject_type, subject_id, ip, action, verified_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(subject_type, subject_id) DO UPDATE SET
       ip = excluded.ip,
       action = excluded.action,
       verified_at = excluded.verified_at,
       expires_at = excluded.expires_at`,
    [id, subjectType, subjectId, clientIp, action, verifiedAt, expiresAt]
  );
}

/** 清除主体的验证状态（登出时调用，实现"退出登录立即失效"） */
export async function clearVerification(subjectType: SubjectType, subjectId: string): Promise<void> {
  await db.run('DELETE FROM user_verifications WHERE subject_type = ? AND subject_id = ?', [
    subjectType,
    subjectId,
  ]);
}

/**
 * 高危操作统一检查入口。
 * 依次判断：测试绕过 → 有效验证状态（含 IP 绑定与过期检查）。
 * 通过返回 null；未通过返回 403 拦截响应（payload.code 供前端识别）。
 * 用法：在路由完成鉴权拿到主体 ID 后调用，denied 非 null 时直接响应。
 */
export async function ensureHumanVerified(
  subjectType: SubjectType,
  subjectId: string,
  req: express.Request
): Promise<VerificationDenial | null> {
  if (isTestBypass(req.body?.tokens)) {
    return null;
  }
  const state = await getValidVerification(subjectType, subjectId, getVerificationIp(req));
  if (state) {
    return null;
  }
  return {
    status: 403,
    payload: {
      success: false,
      code: 'HUMAN_VERIFICATION_REQUIRED',
      message: '该操作需先完成人机验证，请按页面提示完成验证后重试',
    },
  };
}

/**
 * 清理已过期的验证状态记录（server.ts 每日清理任务调用），防止表无限膨胀。
 * @returns 删除的记录数
 */
export async function cleanupExpiredVerifications(): Promise<number> {
  const result = await db.run('DELETE FROM user_verifications WHERE expires_at <= ?', [
    new Date().toISOString(),
  ]);
  return result.changes ?? 0;
}
