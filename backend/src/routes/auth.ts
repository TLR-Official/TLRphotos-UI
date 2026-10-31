/**
 * @file auth.ts
 * @description 用户认证路由模块（V2.0.0：纯邮箱认证体系，全面移除手机验证码）。
 *              覆盖邮箱验证码发送、注册、登录（两段式：密码 + 邮箱验证码，每次登录均须验码）、
 *              无邮箱/换邮箱绑定、登出、令牌刷新、当前用户信息维护、修改密码、上传头像、
 *              查看指定用户公开资料与照片、用户仪表盘统计等场景。
 *              鉴权统一基于 Bearer Token + Session Token 双令牌机制。
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  register,
  verifyToken,
  getUserById,
  updateUser,
  changePassword,
  updateAvatar,
  findUserByEmail,
  isValidEmail,
  verifyPasswordOnly,
  issueLoginResult,
  loadAuthUser,
  markEmailVerified,
  bindUserEmail,
  InviteCodeInvalidError,
} from '../services/authService';
import { validateInviteCode } from '../services/inviteCodeService';
import { getSession, updateLastActive, deleteSession } from '../services/cookieService';
import {
  isTestBypass,
  verifyTurnstileToken,
  getValidVerification,
  saveVerification,
  clearVerification,
  ensureHumanVerified,
  getVerificationIp,
} from '../services/verificationService';
import { createCodeRecord, verifyCode, maskTarget } from '../services/otpService';
import type { OtpScene } from '../services/otpService';
import { sendMailCode } from '../services/aliMailService';
import type { OtpServiceError } from '../services/aliMailService';
import { db } from '../db';
import { resolveRegion } from '../services/regionService';
import { clearExpiredBan } from '../services/penaltyService';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getProxyUrl } from '../utils/url';
import { createRateLimiter } from '../middleware/rateLimit';

// V1.10.1：认证口限速，按 IP 每窗口 10 次，抑制凭据爆破与类型探测
const authLimiter = createRateLimiter({ max: 10, message: '尝试过于频繁，请稍后再试' });

// 邮箱验证码发送口三层限速 —— 每邮箱 60s 1 次（冷却）、每邮箱每小时 5 次、每 IP 每小时 20 次
// 三层独立限速器实例叠加，任一超限即 429；测试环境（NODE_ENV=test）限速器默认放行
const emailKey = (req: express.Request) =>
  `email:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''}`;
const otpCooldownLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 1,
  message: '发送过于频繁，请 60 秒后再试',
  keyFn: emailKey,
});
const otpTargetHourLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  message: '该邮箱获取验证码过于频繁，请稍后再试',
  keyFn: emailKey,
});
const otpIpHourLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 20,
  message: '验证码请求过于频繁，请稍后再试',
});

const JWT_SECRET = process.env.JWT_SECRET || '';
// JWT 有效期：固定 24 小时，过期后通过 refresh 接口续签
const JWT_EXPIRES_IN = '24h';

/**
 * 获取客户端真实 IP。
 * 优先读取反向代理设置的 x-forwarded-for / x-real-ip 头，
 * 兜底使用 socket 远端地址，用于会话审计与风控。
 */
function getClientIp(req: express.Request): string {
  const ip = req.headers['x-forwarded-for'] ||
             req.headers['x-real-ip'] ||
             req.socket.remoteAddress ||
             'unknown';
  return Array.isArray(ip) ? ip[0] : ip;
}

/**
 * 登录/注册成功后采集用户归属省份（V4.1.0）。
 * 取 X-Forwarded-For 首段 → 离线 IP 库解析省份（无外部网络请求，失败存「未知」）→
 * 写 users.region（只存省份、不落明文 IP）。任何异常吞掉，不影响登录主流程。
 */
async function recordUserRegion(userId: string, req: express.Request): Promise<void> {
  try {
    const xff = req.headers['x-forwarded-for'];
    const firstSegment = (Array.isArray(xff) ? xff[0] : xff || '').split(',')[0].trim();
    const region = resolveRegion(firstSegment);
    await db.run('UPDATE users SET region = ?, updated_at = ? WHERE id = ?', [
      region,
      new Date().toISOString(),
      userId,
    ]);
  } catch {
    // 归属地采集失败不阻塞登录
  }
}

// 头像上传 multer 配置：磁盘存储 + 5MB 限制 + 仅允许 JPG/PNG/WebP
const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 JPG、PNG 或 WebP 格式的图片'));
    }
  },
});

/**
 * 清理 multer 保存到磁盘的临时文件。
 * 头像上传成功路径会保留文件作为正式头像，仅在错误路径或 early return 时调用本函数清理残留临时文件。
 */
const cleanupTempFile = (req: any) => {
  if (req.file?.path) {
    fs.unlink(req.file.path, (err: any) => {
      if (err) console.error('Failed to cleanup temp file:', err);
    });
  }
};

// ==================== 短期票据（login_ticket / bind_ticket，HMAC 签名） ====================
/** 票据有效期：10 分钟（密码通过后须在该窗口内完成验证码确认或邮箱绑定） */
const TICKET_TTL_MS = 10 * 60 * 1000;

/** 票据载荷（HMAC 签名保护，密钥 = JWT_SECRET） */
interface TicketPayload {
  userId: string;
  typ: 'login' | 'bind';
  exp: number;
  ip: string;
}

/**
 * 生成短期票据：格式 `${base64url(JSON payload)}.${hmac}`。
 * payload 含 userId / 类型 / 过期时间戳 / 客户端 IP，HMAC-SHA256 防篡改。
 */
function signTicket(typ: TicketPayload['typ'], userId: string, ip: string): string {
  const payload: TicketPayload = { userId, typ, exp: Date.now() + TICKET_TTL_MS, ip };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * 校验短期票据：格式、HMAC 签名（恒时比较）、类型、过期时间、IP 匹配。
 * 返回 null 表示无效；有效返回载荷。
 */
function verifyTicket(ticket: string, typ: TicketPayload['typ'], ip: string): TicketPayload | null {
  const dotIndex = ticket.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const body = ticket.slice(0, dotIndex);
  const sig = ticket.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: TicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TicketPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.userId !== 'string' ||
    payload.typ !== typ ||
    typeof payload.exp !== 'number' ||
    typeof payload.ip !== 'string'
  ) {
    return null;
  }
  if (payload.exp <= Date.now()) return null;
  if (payload.ip !== ip) return null;
  return payload;
}

/** 统一错误响应：{ success:false, message, code } */
function sendError(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, message, code });
}

/** 验证码校验失败原因码 → 统一错误响应 */
function sendOtpError(
  res: express.Response,
  result: { ok: boolean; error?: string }
): boolean {
  if (result.ok) return false;
  switch (result.error) {
    case 'OTP_NOT_FOUND':
    case 'OTP_EXPIRED':
    case 'OTP_INVALID':
      sendError(res, 400, 'OTP_EXPIRED', '验证码已过期，请重新获取');
      return true;
    case 'OTP_MISMATCH':
      sendError(res, 400, 'OTP_MISMATCH', '验证码错误');
      return true;
    case 'OTP_LOCKED':
    default:
      sendError(res, 400, 'OTP_LOCKED', '验证码错误次数过多，请重新获取');
      return true;
  }
}

/** 构造与登录一致的响应用户体（剔除敏感字段） */
function buildLoginResponseUser(u: any) {
  return {
    id: u.id,
    email: u.email ?? null,
    username: u.username ?? null,
    avatar_url: u.avatar_url ?? null,
    email_verified: u.email_verified ?? 0,
    // V4.7.0：邀请码授予的称号与关联邀请码 ID（未授予为 null）
    title: u.title ?? u.user_title ?? null,
    invite_code_id: u.invite_code_id ?? null,
  };
}

const router = express.Router();

/**
 * 发送邮箱验证码（V2.0.0）。
 * 入参 { email, scene, turnstile_token }；场景仅限：
 *  - login：邮箱必须已注册，否则 404 EMAIL_NOT_REGISTERED；
 *  - register：邮箱必须未注册，否则 409 ALREADY_REGISTERED；
 *  - bind_email：须持有效 bind_ticket（登录第一段无邮箱时签发）或 JWT（已登录换邮箱），
 *    且邮箱未被其他账号占用。
 * 三层限速（邮箱 60s 冷却 / 邮箱每小时 5 次 / IP 每小时 20 次）+ Turnstile 人机验证。
 * 明文码仅在内存中传递给邮件发送通道，发送失败时作废旧记录后抛错，绝不入库、不落日志。
 */
router.post('/email/code/send', otpCooldownLimiter, otpTargetHourLimiter, otpIpHourLimiter, async (req, res) => {
  try {
    const { email, scene, turnstile_token, tokens, bind_ticket } = req.body ?? {};

    // 严格入口校验：类型 + 长度上限，拦截类型混淆
    if (typeof email !== 'string' || typeof scene !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    if (!['login', 'register', 'bind_email'].includes(scene)) {
      return sendError(res, 400, 'INVALID_PARAMS', '不支持的业务场景');
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail.length > 254 || !isValidEmail(trimmedEmail)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的邮箱地址');
    }

    if (scene === 'bind_email') {
      // 绑定场景：bind_ticket 或 JWT 至少有一，且邮箱未被他人占用
      const vIp = getVerificationIp(req);
      let binderId: string | null = null;
      if (typeof bind_ticket === 'string') {
        const payload = verifyTicket(bind_ticket, 'bind', vIp);
        binderId = payload?.userId || null;
      } else {
        const { user } = await loadAuthUser(req);
        binderId = user?.id || null;
      }
      if (!binderId) {
        return sendError(res, 401, 'UNAUTHORIZED', '绑定凭证已失效，请重新登录');
      }
      const conflict = await findUserByEmail(trimmedEmail);
      if (conflict && conflict.id !== binderId) {
        return sendError(res, 409, 'ALREADY_REGISTERED', '该邮箱已被其他账号绑定');
      }
    } else {
      // 登录 / 注册场景：检查邮箱注册状态
      const existing = await findUserByEmail(trimmedEmail);
      if (scene === 'login' && !existing) {
        return sendError(res, 404, 'EMAIL_NOT_REGISTERED', '该邮箱未注册');
      }
      if (scene === 'register' && existing) {
        return sendError(res, 409, 'ALREADY_REGISTERED', '该邮箱已被注册');
      }
    }

    // Turnstile 人机验证（register 场景 action=register，其余 action=login），测试环境支持 tokens 绕过
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(
        turnstile_token,
        scene === 'register' ? 'register' : 'login',
        getVerificationIp(req)
      );
      if (!verdict.ok) {
        return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
      }
    }

    // 生成验证码记录（入库仅存哈希，channel 固定 mail），随后发送邮件
    const ip = getVerificationIp(req);
    const code = await createCodeRecord(trimmedEmail, scene as OtpScene, ip);
    try {
      const sceneLabel = scene === 'register' ? '注册验证' : scene === 'bind_email' ? '绑定邮箱' : '登录验证';
      await sendMailCode(trimmedEmail, code, 10, sceneLabel);
    } catch (sendErr) {
      // 发送失败：作废刚创建的记录（置 used_at），避免残留可校验的死码，再向上抛错
      await db.run(
        'UPDATE verification_codes SET used_at = ? WHERE target = ? AND scene = ? AND used_at IS NULL',
        [new Date().toISOString(), trimmedEmail, scene]
      );
      throw sendErr;
    }

    // 日志仅记录脱敏目标，禁止明文码 / 完整邮箱落日志
    console.log(`[OTP] 邮箱验证码已发送: scene=${scene} target=${maskTarget(trimmedEmail)}`);

    return res.json({
      success: true,
      data: {
        channel: 'mail',
        cooldown: 60,
        expires_minutes: 10,
        target: maskTarget(trimmedEmail),
      },
    });
  } catch (error) {
    // 邮件服务错误（含未配置 503 / 发送失败 502）：按携带的 status/code 透传，客户端提示已脱敏
    const mailErr = error as OtpServiceError;
    if (typeof mailErr?.status === 'number' && typeof mailErr?.code === 'string') {
      return sendError(res, mailErr.status, mailErr.code, mailErr.message);
    }
    console.error('Email code send error:', error);
    return sendError(res, 500, 'OTP_SEND_FAILED', '验证码发送失败，请稍后再试');
  }
});

/**
 * 用户注册（V2.0.0：仅邮箱注册）。
 * 入参 { email, password, username?, code, turnstile_token }；
 * 注册前必须通过 verifyCode(email, code, 'register') 校验一次性邮箱验证码；
 * 注册成功即邮箱已确权（email_verified=1），直接签发 JWT 并创建会话（remember=true），
 * 返回结构与登录一致。
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, username, code, turnstile_token, tokens, invite_code } = req.body ?? {};

    // 严格入口校验：类型 + 长度上限，拦截类型混淆导致的引擎错误外泄
    if (typeof email !== 'string' || typeof password !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      return sendError(res, 400, 'INVALID_PARAMS', '邮箱和密码不能为空');
    }
    if (trimmedEmail.length > 254 || password.length > 200 || !isValidEmail(trimmedEmail)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的邮箱地址');
    }
    if (username !== undefined && (typeof username !== 'string' || username.length > 50)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    // V4.7.0：邀请码选填；类型/长度先做入口收敛，有效性在 OTP 通过后校验
    if (invite_code !== undefined && invite_code !== null && invite_code !== '') {
      if (typeof invite_code !== 'string' || invite_code.length > 64) {
        return sendError(res, 400, 'INVALID_PARAMS', '邀请码格式不正确');
      }
    }
    // 验证码必填：格式收敛为 6 位数字字符串（防注入 + 提前拦截无效请求）
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return sendError(res, 400, 'OTP_REQUIRED', '请输入 6 位验证码');
    }

    // 人机验证：注册必须先通过 Turnstile（action=register；测试环境可用 tokens 绕过）
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, 'register', getVerificationIp(req));
      if (!verdict.ok) {
        return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
      }
    }

    // 注册验证码校验（scene=register），不落明文码
    const otpResult = await verifyCode(trimmedEmail, code, 'register');
    if (sendOtpError(res, otpResult)) return;

    // V4.7.0：邀请码选填；填写时必须有效，否则拒绝注册（空邀请码正常注册且不授予称号）
    let inviteRef: { id: string } | undefined;
    if (typeof invite_code === 'string' && invite_code.trim()) {
      const inviteVerdict = await validateInviteCode(invite_code);
      if (!inviteVerdict.ok) {
        return sendError(res, 400, 'INVITE_CODE_INVALID', '邀请码无效或已失效');
      }
      inviteRef = { id: inviteVerdict.invite.id };
    }

    const user = await register(trimmedEmail, password, username, inviteRef);

    // 注册成功即完成登录验证：直接签发 JWT + 创建长期会话（remember 默认 true）
    const ipAddress = getClientIp(req);
    const result = await issueLoginResult(user, true, ipAddress);
    // V4.1.0：注册成功采集归属省份（失败不影响注册）
    await recordUserRegion(user.id, req);

    // 建立 168h 人机验证状态（与登录路径一致，注册后高危操作免重复验证）
    await saveVerification('user', user.id, getVerificationIp(req), 'register');

    res.status(201).json({
      success: true,
      data: {
        user: buildLoginResponseUser(result.user),
        token: result.token,
        session_token: result.session_token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    // V4.7.0：事务内邀请码失效（并发抢用/停用/过期）统一归一化为 400
    if (error instanceof InviteCodeInvalidError || (error as { code?: string })?.code === 'INVITE_CODE_INVALID') {
      return sendError(res, 400, 'INVITE_CODE_INVALID', '邀请码无效或已失效');
    }
    const message = error instanceof Error ? error.message : '注册失败';
    // 唯一性冲突（邮箱已注册）归一化为 409
    if (message.includes('已被注册')) {
      return sendError(res, 409, 'ALREADY_REGISTERED', message);
    }
    res.status(500).json({ success: false, message, code: 'REGISTER_FAILED' });
  }
});

/**
 * 用户登录第一步（V2.0.0：仅邮箱，两段式；V3.2.0：邮箱验证码按周期触发）。
 * 入参 { email, password, turnstile_token }。
 * 密码校验通过后不签发 JWT、不创建会话，仅返回 login_ticket（HMAC-SHA256 签名，
 * 绑定 userId + 过期时间 + 客户端 IP，10 分钟有效）。
 * 账号无邮箱（过渡态）时返回 403 EMAIL_BIND_REQUIRED + bind_ticket，
 * 客户端须先调用 /email/code/send（bind_email）再调用 /email/bind 完成绑定与登录。
 * V3.2.0：若用户在 EMAIL_VERIFY_INTERVAL_DAYS（默认 30 天，90 即每三月一次，
 * <=0 恢复每次登录均验证）内已完成过邮箱验证，则跳过 OTP 直接签发 JWT + 会话。
 *
 * 测试兼容（仅 NODE_ENV=test 且 turnstile_token/tokens 命中绕过口径）：
 * 直接签发 JWT + 创建会话，保证测试套件效率。
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password, turnstile_token, tokens } = req.body ?? {};

    // 严格入口校验（同注册），拦截类型混淆导致的引擎错误外泄
    if (typeof email !== 'string' || typeof password !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      return sendError(res, 400, 'INVALID_PARAMS', '邮箱和密码不能为空');
    }
    if (trimmedEmail.length > 254 || password.length > 200 || !isValidEmail(trimmedEmail)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的邮箱地址');
    }

    const ipAddress = getClientIp(req);
    const vIp = getVerificationIp(req);

    // 测试兼容路径：仅测试环境且命中绕过口径时直接签发（生产环境物理关闭）
    const testBypass =
      isTestBypass(tokens) ||
      (process.env.NODE_ENV === 'test' &&
        typeof turnstile_token === 'string' &&
        turnstile_token === (process.env.TEST_BYPASS_TOKEN || ''));

    // 人机验证（fail-closed），按序判断：
    // 1) 测试环境绕过；2) 168h 内已验证、未登出且 IP 未变 → 免重复验证；
    // 3) 否则必须携带有效 Turnstile token（action=login）方可进入密码校验
    if (!testBypass) {
      const userRow = await findUserByEmail(trimmedEmail);
      const verified = userRow ? await getValidVerification('user', userRow.id, vIp) : null;
      if (!verified) {
        const verdict = await verifyTurnstileToken(turnstile_token, 'login', vIp);
        if (!verdict.ok) {
          return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
        }
      }
    }

    // 第一步：仅校验密码（不签发 JWT / 不创建会话）
    const user = await verifyPasswordOnly(trimmedEmail, password);

    // 测试兼容路径直接完成签发（不走验证码第二步）
    if (testBypass) {
      const result = await issueLoginResult(user, true, ipAddress);
      await recordUserRegion(user.id, req);
      await saveVerification('user', user.id, vIp, 'login');
      return res.json({
        success: true,
        data: {
          user: buildLoginResponseUser(result.user),
          token: result.token,
          session_token: result.session_token,
        },
      });
    }

    // 账号无邮箱：签发 bind_ticket 引导强制绑定（历史过渡态；V2.0.0 迁移后理论上不触发，保留安全兜底）
    if (!user.email) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_BIND_REQUIRED',
        message: '该账号尚未绑定邮箱，请先完成邮箱绑定',
        data: { bind_ticket: signTicket('bind', user.id, vIp), expires_minutes: 10 },
      });
    }

    // V3.2.0 邮件验证周期化：周期内已完成过邮箱验证的账号跳过 OTP 直接签发。
    // EMAIL_VERIFY_INTERVAL_DAYS：默认 30（每月一次）；置 90 即每三月一次；
    // <=0 或非数字表示每次登录均须验证（V2.0.0 旧行为）。
    // 逐请求读取 env，与 ADMIN_SMS_REQUIRED 紧急开关同口径，改配置重启即生效。
    const intervalDays = Number.parseInt(process.env.EMAIL_VERIFY_INTERVAL_DAYS ?? '30', 10);
    if (Number.isFinite(intervalDays) && intervalDays > 0 && user.last_email_verified_at) {
      const lastVerifiedMs = Date.parse(user.last_email_verified_at);
      if (Number.isFinite(lastVerifiedMs) && Date.now() - lastVerifiedMs < intervalDays * 24 * 60 * 60 * 1000) {
        const result = await issueLoginResult(user, true, ipAddress);
        // V4.1.0：邮箱码直签发路径同样采集归属省份
        await recordUserRegion(user.id, req);
        await saveVerification('user', user.id, vIp, 'login');
        return res.json({
          success: true,
          data: {
            user: buildLoginResponseUser(result.user),
            token: result.token,
            session_token: result.session_token,
          },
        });
      }
    }

    // 第二步前置：返回 login_ticket（10 分钟内完成邮箱验证码确认）
    const loginTicket = signTicket('login', user.id, vIp);

    return res.json({
      success: true,
      data: {
        otp_required: true,
        login_ticket: loginTicket,
        expires_minutes: 10,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    const message = error instanceof Error ? error.message : '登录失败';
    // 封禁 / 禁用 / 密码错误统一为 401（信息不细分回显策略由 authService 控制）
    if (message.includes('已被封禁') || message.includes('已被禁用')) {
      return sendError(res, 401, 'AUTH_REJECTED', message);
    }
    return sendError(res, 401, 'AUTH_FAILED', message);
  }
});

/**
 * 用户登录第二步：邮箱验证码确认（V2.0.0）。
 * 入参 { login_ticket, code }；校验目标固定为该用户 email（客户端不可伪造 target）。
 * 依次校验：login_ticket 签名 / 过期 / IP 匹配 → verifyCode(scene=login)。
 * 通过后 markEmailVerified 完成确权（老用户首次登录即自动确权），
 * 再复用 issueLoginResult 签发 JWT + 创建会话（remember 默认 true），并建立 168h 人机验证状态。
 * 限速：10 次/分/IP，抑制验证码爆破。
 */
router.post('/login/verify', createRateLimiter({ max: 10, message: '尝试过于频繁，请稍后再试' }), async (req, res) => {
  try {
    const { login_ticket, code } = req.body ?? {};

    if (typeof login_ticket !== 'string' || login_ticket.length > 2048) {
      return sendError(res, 400, 'INVALID_TICKET', '登录票据无效，请重新登录');
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return sendError(res, 400, 'OTP_REQUIRED', '请输入 6 位验证码');
    }

    const vIp = getVerificationIp(req);

    // 票据校验：签名（恒时比较）+ 类型 + 过期 + IP 匹配
    const payload = verifyTicket(login_ticket, 'login', vIp);
    if (!payload) {
      return sendError(res, 401, 'INVALID_TICKET', '登录票据已失效，请重新登录');
    }

    // V4.1.0：L3 限时封禁自愈可能重取用户行，声明为 let
    let user = await getUserById(payload.userId);
    if (!user) {
      return sendError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    }
    if (user.banned_at) {
      if (await clearExpiredBan(user.id)) {
        const healed = await getUserById(user.id);
        if (healed) {
          user = healed;
        } else {
          return sendError(res, 404, 'USER_NOT_FOUND', '用户不存在');
        }
      } else {
        return sendError(res, 401, 'USER_BANNED', '该账号已被封禁');
      }
    }
    if (!user.is_active) {
      return sendError(res, 401, 'USER_DISABLED', '用户已被禁用');
    }

    // 校验目标由服务端从用户记录取（不信任客户端传 target）
    if (!user.email) {
      return sendError(res, 403, 'EMAIL_BIND_REQUIRED', '该账号尚未绑定邮箱，请先完成邮箱绑定');
    }

    const otpResult = await verifyCode(user.email, code, 'login');
    if (sendOtpError(res, otpResult)) return;

    // 邮箱确权：老用户首次登录验码通过即置 email_verified=1
    await markEmailVerified(user.id);

    // 签发 JWT + 创建长期会话（remember 默认 true），建立 168h 人机验证状态
    const result = await issueLoginResult(user, true, getClientIp(req));
    // V4.1.0：验证码登录成功采集归属省份
    await recordUserRegion(user.id, req);
    await saveVerification('user', user.id, vIp, 'login');

    return res.json({
      success: true,
      data: {
        user: buildLoginResponseUser(result.user),
        token: result.token,
        session_token: result.session_token,
      },
    });
  } catch (error) {
    console.error('Login verify error:', error);
    return sendError(res, 500, 'LOGIN_FAILED', '登录失败，请稍后再试');
  }
});

/**
 * 绑定 / 更换邮箱（V2.0.0，两种身份凭证）：
 *  - bind_ticket：登录第一段发现账号无邮箱时签发，绑定成功后直接完成登录签发；
 *  - JWT：已登录用户更换邮箱，绑定成功返回更新后的用户资料。
 * 入参 { email, code, bind_ticket? }；邮箱格式校验 + 未被他人占用，
 * 通过 verifyCode(email, code, 'bind_email') 后写入 email 并置 email_verified=1。
 */
router.post('/email/bind', authLimiter, async (req, res) => {
  try {
    const { email, code, bind_ticket, turnstile_token, tokens } = req.body ?? {};

    if (typeof email !== 'string' || typeof code !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail.length > 254 || !isValidEmail(trimmedEmail)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的邮箱地址');
    }
    if (!/^\d{6}$/.test(code)) {
      return sendError(res, 400, 'OTP_REQUIRED', '请输入 6 位验证码');
    }

    const vIp = getVerificationIp(req);

    // 身份解析：优先 bind_ticket；否则走 JWT
    let ticketUser: { id: string } | null = null;
    if (typeof bind_ticket === 'string') {
      const payload = verifyTicket(bind_ticket, 'bind', vIp);
      ticketUser = payload ? { id: payload.userId } : null;
      if (!ticketUser) {
        return sendError(res, 401, 'INVALID_TICKET', '绑定凭证已失效，请重新登录');
      }
    }

    let authUser: Awaited<ReturnType<typeof loadAuthUser>>['user'] = null;
    if (!ticketUser) {
      const loaded = await loadAuthUser(req);
      if (loaded.error) {
        return sendError(res, loaded.error.status, loaded.error.code, loaded.error.message);
      }
      authUser = loaded.user;
      if (!authUser) {
        return sendError(res, 401, 'UNAUTHORIZED', '请先登录');
      }
    }

    const targetUserId = ticketUser?.id || authUser!.id;

    // 人机验证（确认步同发码步要求一致；测试环境可绕过）
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, 'login', vIp);
      if (!verdict.ok) {
        return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
      }
    }

    // 查重：邮箱已被其他账号绑定 → 409
    const conflict = await findUserByEmail(trimmedEmail);
    if (conflict && conflict.id !== targetUserId) {
      return sendError(res, 409, 'ALREADY_REGISTERED', '该邮箱已被其他账号绑定');
    }

    const otpResult = await verifyCode(trimmedEmail, code, 'bind_email');
    if (sendOtpError(res, otpResult)) return;

    await bindUserEmail(targetUserId, trimmedEmail);

    // bind_ticket 路径：绑定即完成登录，签发 JWT + 会话
    if (ticketUser) {
      const boundUser = await getUserById(targetUserId);
      if (!boundUser) {
        return sendError(res, 404, 'USER_NOT_FOUND', '用户不存在');
      }
      const result = await issueLoginResult(boundUser, true, getClientIp(req));
      // V4.1.0：绑定邮箱完成登录路径同样采集归属省份
      await recordUserRegion(boundUser.id, req);
      await saveVerification('user', boundUser.id, vIp, 'login');
      return res.json({
        success: true,
        data: {
          user: buildLoginResponseUser(result.user),
          token: result.token,
          session_token: result.session_token,
        },
      });
    }

    // JWT 路径：返回更新后的用户资料
    const updated = await getUserById(targetUserId);
    return res.json({
      success: true,
      data: {
        id: updated!.id,
        email: updated!.email,
        username: updated!.username,
        avatar_url: updated!.avatar_url,
        email_verified: updated!.email_verified,
      },
    });
  } catch (err) {
    console.error('Email bind error:', err);
    return sendError(res, 500, 'BIND_FAILED', '绑定邮箱失败，请稍后再试');
  }
});

/**
 * 获取当前登录用户信息。
 * 校验 Bearer Token 后返回用户完整资料；若携带 x-session-token 则同步刷新会话活跃时间。
 * @header Authorization Bearer Token
 * @header x-session-token 会话令牌（可选）
 */
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const user = await getUserById(decoded.userId);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 携带会话令牌时刷新 last_active_at，避免会话因长时间未操作而过期
    const sessionToken = req.headers['x-session-token'] as string;
    if (sessionToken) {
      await updateLastActive(sessionToken);
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url,
        bio: user.bio,
        email_verified: user.email_verified,
        website: user.website,
        location: user.location,
        // custom_fields 以 JSON 字符串存储，返回时解析为对象
        custom_fields: user.custom_fields ? JSON.parse(user.custom_fields) : null,
        // V4.7.0：邀请码授予的称号（未授予为 null）
        title: user.user_title || null,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

/**
 * 更新当前登录用户资料（V2.0.0：移除手机号字段；邮箱未确权账户拒绝）。
 * 支持用户名、简介、网站、所在地与自定义字段；custom_fields 序列化为 JSON 字符串存储。
 */
router.put('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const currentUser = await getUserById(decoded.userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    // V2.0.0：账户功能须邮箱确权
    if (!currentUser.email || currentUser.email_verified !== 1) {
      return sendError(res, 403, 'EMAIL_VERIFICATION_REQUIRED', '请先完成邮箱验证后再使用该功能');
    }

    // 资料修改为高危操作，需人机验证状态（168h 内同 IP 有效）
    const denied = await ensureHumanVerified('user', decoded.userId, req);
    if (denied) {
      return res.status(denied.status).json(denied.payload);
    }

    const { username, bio, website, location, custom_fields } = req.body;

    const updatedUser = await updateUser(decoded.userId, {
      username,
      bio,
      website,
      location,
      // 自定义字段序列化为 JSON 字符串便于持久化
      custom_fields: custom_fields ? JSON.stringify(custom_fields) : null,
    });

    res.json({
      success: true,
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        avatar_url: updatedUser.avatar_url,
        bio: updatedUser.bio,
        email_verified: updatedUser.email_verified,
        website: updatedUser.website,
        location: updatedUser.location,
        custom_fields: updatedUser.custom_fields ? JSON.parse(updatedUser.custom_fields) : null,
        // V4.7.0：资料更新响应保留称号，避免前端刷新后标签丢失
        title: updatedUser.user_title || null,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '更新用户信息失败' });
  }
});

/**
 * 修改当前登录用户密码（V2.0.0：邮箱未确权账户拒绝）。
 * 需提供原密码与新密码，原密码校验通过后方可更新。
 */
router.put('/me/password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const currentUser = await getUserById(decoded.userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (!currentUser.email || currentUser.email_verified !== 1) {
      return sendError(res, 403, 'EMAIL_VERIFICATION_REQUIRED', '请先完成邮箱验证后再使用该功能');
    }

    // 修改密码为高危操作，需人机验证状态（168h 内同 IP 有效）
    const denied = await ensureHumanVerified('user', decoded.userId, req);
    if (denied) {
      return res.status(denied.status).json(denied.payload);
    }

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '原密码和新密码不能为空' });
    }

    await changePassword(decoded.userId, oldPassword, newPassword);

    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : '密码修改失败' });
  }
});

/**
 * 上传当前用户头像（V2.0.0：邮箱未确权账户拒绝并清理临时文件）。
 * 接收 multipart 文件，保存至本地 uploads 目录后写入用户记录，
 * 头像 URL 通过 /uploads 静态目录对外提供。
 */
router.post('/me/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      cleanupTempFile(req);
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      cleanupTempFile(req);
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const currentUser = await getUserById(decoded.userId);
    if (!currentUser) {
      cleanupTempFile(req);
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (!currentUser.email || currentUser.email_verified !== 1) {
      cleanupTempFile(req);
      return sendError(res, 403, 'EMAIL_VERIFICATION_REQUIRED', '请先完成邮箱验证后再使用该功能');
    }

    // 头像上传为高危操作，需人机验证状态；拦截时清理 multer 已落盘临时文件
    const denied = await ensureHumanVerified('user', decoded.userId, req);
    if (denied) {
      cleanupTempFile(req);
      return res.status(denied.status).json(denied.payload);
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传图片' });
    }

    // 头像 URL 直接使用静态目录路径，前端通过 /uploads 访问
    const avatarUrl = `/uploads/${req.file.filename}`;
    const updatedUser = await updateAvatar(decoded.userId, avatarUrl);

    res.json({
      success: true,
      data: {
        id: updatedUser.id,
        avatar_url: updatedUser.avatar_url,
      },
    });
  } catch (error) {
    cleanupTempFile(req);
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '头像上传失败' });
  }
});

/**
 * 退出登录。
 * 携带 x-session-token 时删除对应会话记录，使该会话令牌立即失效。
 */
router.post('/logout', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;
    if (sessionToken) {
      // 退出登录使人机验证状态立即失效（再次高危操作需重新验证）
      const session = await getSession(sessionToken);
      if (session?.user_id) {
        await clearVerification('user', session.user_id);
      }
      await deleteSession(sessionToken);
    }
    res.json({ success: true, message: '退出成功' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: '退出失败' });
  }
});

/**
 * 获取指定用户公开资料。
 * 仅返回公开字段（用户名、头像、简介、网站、所在地、注册时间），不含邮箱等敏感信息。
 * @param id 用户 ID
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username || '用户',
        avatar_url: user.avatar_url,
        bio: user.bio,
        website: user.website,
        location: user.location,
        // V4.7.0：公开档案同样返回称号，供名称旁标签展示
        title: user.user_title || null,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

/**
 * 获取指定用户的已审核照片列表（分页）。
 * 用于用户主页展示，仅返回已审核通过的照片。
 * @param id 用户 ID
 * @query page 页码（默认 1）
 * @query pageSize 每页数量（默认 20）
 */
router.get('/users/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, pageSize = 20 } = req.query;

    // 计算分页偏移量
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);

    const photos = await db.all(
      'SELECT id, title, thumbnail_path, tags, width, height, created_at FROM photos WHERE user_id = ? AND status = "approved" ORDER BY created_at DESC LIMIT ? OFFSET ?',
      id,
      parseInt(pageSize as string),
      offset
    );

    const total = await db.get('SELECT COUNT(*) as count FROM photos WHERE user_id = ? AND status = "approved"', id);

    res.json({
      success: true,
      data: {
        photos: photos.map(photo => ({
          ...photo,
          // 缩略图地址转换为代理 URL，附带 photoId 供代理路由快速鉴权；tags JSON 反序列化为数组
          thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
          tags: photo.tags ? JSON.parse(photo.tags) : [],
        })),
        total: total?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get user photos error:', error);
    res.status(500).json({ success: false, message: '获取用户照片失败' });
  }
});

/**
 * 获取用户仪表盘统计数据。
 * 包含照片总数、各状态数量、审核通过率、总浏览量、总点赞数、最近 7 天上传数。
 * @param id 用户 ID
 */
router.get('/users/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // 校验用户存在
    const user = await db.get('SELECT id FROM users WHERE id = ?', id);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 一次性聚合各状态照片数量
    const stats = await db.get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM photos WHERE user_id = ?
    `, id);

    // 已审核照片的总浏览量与总点赞量
    const interactions = await db.get(`
      SELECT
        SUM(views) as total_views,
        SUM(likes) as total_likes
      FROM photos WHERE user_id = ? AND status = 'approved'
    `, id);

    // 最近 7 天上传数量
    const recentUploads = await db.get(`
      SELECT COUNT(*) as count
      FROM photos
      WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
    `, id);

    const total = stats?.total || 0;
    const approved = stats?.approved || 0;
    const pending = stats?.pending || 0;
    const rejected = stats?.rejected || 0;
    // 审核通过率：已审核通过数量 / 总数量，避免除零错误
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    res.json({
      success: true,
      data: {
        totalUploads: total,
        approved: approved,
        pending: pending,
        rejected: rejected,
        approvalRate: approvalRate,
        totalViews: interactions?.total_views || 0,
        totalLikes: interactions?.total_likes || 0,
        recentUploads: recentUploads?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ success: false, message: '获取用户统计失败' });
  }
});

/**
 * 获取当前登录用户的所有照片（含 pending/rejected 及驳回理由）。
 * 供用户在个人中心查看自己上传的所有照片及其审核状态。
 * @query status 可选的状态过滤：pending / approved / rejected，不传则返回全部
 */
router.get('/me/photos', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const { status } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;

    // 构建查询：可选状态过滤；联表带出审核员用户名（V4.1.2-beta.3：未通过记录需展示审核员编号）
    let query =
      'SELECT p.*, r.username AS reviewer_name FROM photos p ' +
      'LEFT JOIN admin_users r ON p.reviewed_by = r.id WHERE p.user_id = ?';
    const params: any[] = [decoded.userId];

    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
      query += ' AND p.status = ?';
      params.push(status);
    }

    query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const photos = await db.all(query, params);

    // 计数查询
    let countQuery = 'SELECT COUNT(*) as count FROM photos WHERE user_id = ?';
    const countParams: any[] = [decoded.userId];
    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    const total = await db.get(countQuery, countParams);

    res.json({
      success: true,
      data: {
        photos: photos.map((photo: any) => {
          let tags: string[] = [];
          if (photo.tags) {
            try {
              tags = JSON.parse(photo.tags);
            } catch {
              tags = photo.tags.split(' ').filter(Boolean);
            }
          }
          delete photo.altitude;
          // 不暴露审核员内部 ID，仅回传用户名（仅未通过记录需要）
          const reviewerName = photo.reviewer_name || null;
          delete photo.reviewer_name;
          delete photo.reviewed_by;
          return {
            ...photo,
            thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
            original_url: getProxyUrl(photo.original_url, photo.id),
            preview_url: photo.preview_url ? getProxyUrl(photo.preview_url, photo.id) : '',
            watermarked_url: photo.watermarked_url ? getProxyUrl(photo.watermarked_url, photo.id) : '',
            tags,
            rejection_reason: photo.rejection_reason || null,
            reviewer_name: photo.status === 'rejected' ? reviewerName : null,
          };
        }),
        total: total?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get my photos error:', error);
    res.status(500).json({ success: false, message: '获取我的照片失败' });
  }
});

/**
 * 刷新 JWT 令牌。
 * 通过 Session Token 校验会话有效性，签发新的 JWT 并刷新会话活跃时间，
 * 实现 JWT 过期后的无感续签。
 * @body session_token 会话令牌
 * @returns 新的 JWT 与用户基础信息
 */
router.post('/refresh', async (req, res) => {
  try {
    const { session_token } = req.body;

    if (!session_token) {
      return res.status(400).json({ success: false, message: '会话令牌不能为空' });
    }

    // 校验会话是否存在且未过期
    const session = await getSession(session_token);

    if (!session) {
      return res.status(401).json({ success: false, message: '会话已过期或无效' });
    }

    const user = await getUserById(session.user_id);

    if (!user) {
      // 用户已被删除：清理孤儿会话
      await deleteSession(session_token);
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 签发新 JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 刷新会话活跃时间，避免会话因长时间未操作而过期
    await updateLastActive(session_token);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          avatar_url: user.avatar_url,
          // V4.7.0：刷新会话响应同步返回称号
          title: user.user_title || null,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ success: false, message: '刷新令牌失败' });
  }
});

export default router;
