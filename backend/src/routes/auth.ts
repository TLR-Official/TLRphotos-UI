/**
 * @file auth.ts
 * @description 用户认证路由模块。
 *              覆盖注册、登录（两段式：密码 + 验证码）、登出、令牌刷新、当前用户信息维护、
 *              修改密码、上传头像、绑定手机号、查看指定用户公开资料与照片、
 *              用户仪表盘统计等场景。鉴权统一基于 Bearer Token + Session Token 双令牌机制。
 *              V1.11.0：登录改造为「密码校验 → 验证码确认」两段式，支持手机号 / 邮箱双账号体系。
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
  findUserByIdentifier,
  detectIdentifier,
  verifyPasswordOnly,
  issueLoginResult,
  loadAuthUser,
} from '../services/authService';
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
import type { OtpChannel, OtpScene } from '../services/otpService';
import { sendSmsCode, sendMailCode } from '../services/spugService';
import type { OtpServiceError } from '../services/spugService';
import { db } from '../db';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getProxyUrl } from '../utils/url';
import { createRateLimiter } from '../middleware/rateLimit';

// V1.10.1：认证口限速，按 IP 每窗口 10 次，抑制凭据爆破与类型探测
const authLimiter = createRateLimiter({ max: 10, message: '尝试过于频繁，请稍后再试' });

// V1.11.0：验证码发送口三层限速 —— 每 target 60s 1 次（冷却）、每 target 每小时 5 次、每 IP 每小时 20 次
// 三层独立限速器实例叠加，任一超限即 429；测试环境（NODE_ENV=test）限速器默认放行
const otpCooldownLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 1,
  message: '发送过于频繁，请 60 秒后再试',
  keyFn: (req) => `target:${typeof req.body?.target === 'string' ? req.body.target : ''}`,
});
const otpTargetHourLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  message: '该账号获取验证码过于频繁，请稍后再试',
  keyFn: (req) => `target:${typeof req.body?.target === 'string' ? req.body.target : ''}`,
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

// ==================== V1.11.0 两段式登录票据（login_ticket） ====================
/** login_ticket 有效期：10 分钟（密码通过后须在该窗口内完成验证码确认） */
const LOGIN_TICKET_TTL_MS = 10 * 60 * 1000;

/** login_ticket 载荷（HMAC 签名保护，密钥 = JWT_SECRET） */
interface LoginTicketPayload {
  userId: string;
  exp: number;
  ip: string;
}

/**
 * 生成 login_ticket：格式 `${base64url(JSON payload)}.${hmac}`。
 * payload 含 userId / 过期时间戳 / 客户端 IP，HMAC-SHA256 防篡改。
 */
function signLoginTicket(userId: string, ip: string): string {
  const payload: LoginTicketPayload = { userId, exp: Date.now() + LOGIN_TICKET_TTL_MS, ip };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * 校验 login_ticket：格式、HMAC 签名（恒时比较）、过期时间、IP 匹配（XFF 首段）。
 * 返回 null 表示无效；有效返回载荷。
 */
function verifyLoginTicket(ticket: string, ip: string): LoginTicketPayload | null {
  const dotIndex = ticket.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const body = ticket.slice(0, dotIndex);
  const sig = ticket.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: LoginTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LoginTicketPayload;
  } catch {
    return null;
  }
  if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number' || typeof payload.ip !== 'string') {
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

/** 构造与登录一致的响应用户体（剔除敏感字段） */
function buildLoginResponseUser(u: any) {
  return {
    id: u.id,
    email: u.email ?? null,
    username: u.username ?? null,
    avatar_url: u.avatar_url ?? null,
  };
}

const router = express.Router();

/**
 * 发送登录 / 注册 / 绑定手机号验证码（V1.11.0）。
 * 入参 { target, scene, turnstile_token }；自动识别 target 为手机号（短信）或邮箱（邮件）。
 * 场景规则：
 *  - login：target 必须已注册，否则 404 PHONE_NOT_REGISTERED / EMAIL_NOT_REGISTERED；
 *  - register：target 必须未注册，否则 409 ALREADY_REGISTERED；
 *  - bind_phone：需登录，target 必须为手机号且未被他人绑定。
 * 三层限速（target 60s 冷却 / target 每小时 5 次 / IP 每小时 20 次）+ Turnstile 人机验证。
 * 明文码仅在内存中传递给 Spug 发送通道，发送失败时作废旧记录后抛错，绝不入库、不落日志。
 */
router.post('/otp/send', otpCooldownLimiter, otpTargetHourLimiter, otpIpHourLimiter, async (req, res) => {
  try {
    const { target, scene, turnstile_token, tokens } = req.body ?? {};

    // 严格入口校验：类型 + 长度上限，拦截类型混淆
    if (typeof target !== 'string' || typeof scene !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    if (!['login', 'register', 'bind_phone'].includes(scene)) {
      return sendError(res, 400, 'INVALID_PARAMS', '不支持的业务场景');
    }
    const trimmedTarget = target.trim();
    if (!trimmedTarget || trimmedTarget.length > 254) {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }

    // 自动识别通道：手机号 → sms；其余按邮箱格式校验（含 @ 与域名点）
    const kind = detectIdentifier(trimmedTarget);
    if (!kind) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的手机号或邮箱');
    }
    const channel: OtpChannel = kind === 'phone' ? 'sms' : 'mail';

    if (scene === 'bind_phone') {
      // 绑定手机号：需登录（loadAuthUser 统一处理封禁 / 禁用），且 target 必须为手机号
      const { user, error } = await loadAuthUser(req);
      if (error) {
        return sendError(res, error.status, error.code, error.message);
      }
      if (!user) {
        return sendError(res, 401, 'UNAUTHORIZED', '请先登录');
      }
      if (kind !== 'phone') {
        return sendError(res, 400, 'INVALID_PARAMS', '绑定手机号仅支持手机号');
      }
      const conflict = await db.get('SELECT id FROM users WHERE phone = ?', trimmedTarget);
      if (conflict && conflict.id !== user.id) {
        return sendError(res, 409, 'ALREADY_REGISTERED', '该手机号已被其他账号绑定');
      }
    } else {
      // 登录 / 注册场景：检查 target 注册状态
      const existing = await findUserByIdentifier(trimmedTarget);
      if (scene === 'login' && !existing) {
        return kind === 'phone'
          ? sendError(res, 404, 'PHONE_NOT_REGISTERED', '该手机号未注册，继续登录将注册新账号')
          : sendError(res, 404, 'EMAIL_NOT_REGISTERED', '该邮箱未注册');
      }
      if (scene === 'register' && existing) {
        return sendError(res, 409, 'ALREADY_REGISTERED', '该账号已被注册');
      }
    }

    // Turnstile 人机验证：与登录 / 注册一致（action=login / register），测试环境支持 tokens 绕过
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

    // 生成验证码记录（入库仅存哈希），随后调用 Spug 发送明文码
    const ip = getVerificationIp(req);
    const code = await createCodeRecord(trimmedTarget, channel, scene as OtpScene, ip);
    try {
      if (channel === 'sms') {
        await sendSmsCode(trimmedTarget, code, 10);
      } else {
        const sceneLabel = scene === 'register' ? '注册验证' : scene === 'bind_phone' ? '绑定手机号' : '登录验证';
        await sendMailCode(trimmedTarget, code, 10, sceneLabel);
      }
    } catch (sendErr) {
      // 发送失败：作废刚创建的记录（置 used_at），避免残留可校验的死码，再向上抛错
      await db.run(
        'UPDATE verification_codes SET used_at = ? WHERE target = ? AND scene = ? AND used_at IS NULL',
        [new Date().toISOString(), trimmedTarget, scene]
      );
      throw sendErr;
    }

    // 日志仅记录脱敏目标，禁止明文码 / 完整目标落日志
    console.log(`[OTP] 验证码已发送: scene=${scene} channel=${channel} target=${maskTarget(trimmedTarget)}`);

    return res.json({
      success: true,
      data: {
        channel,
        cooldown: 60,
        expires_minutes: 10,
        target: maskTarget(trimmedTarget),
      },
    });
  } catch (error) {
    // Spug 服务错误（含未配置 503 / 发送失败 502）：按携带的 status/code 透传，客户端提示已脱敏
    const otpErr = error as OtpServiceError;
    if (typeof otpErr?.status === 'number' && typeof otpErr?.code === 'string') {
      return sendError(res, otpErr.status, otpErr.code, otpErr.message);
    }
    console.error('OTP send error:', error);
    return sendError(res, 500, 'OTP_SEND_FAILED', '验证码发送失败，请稍后再试');
  }
});

/**
 * 用户注册（V1.11.0 验证码注册改造）。
 * 入参 { identifier, password, username?, code, turnstile_token }；identifier 自动识别邮箱 / 手机号。
 * 注册前必须通过 otpService.verifyCode(target, code, 'register') 校验一次性验证码；
 * 手机号注册：email=NULL、phone=手机号、phone_verified=1、username 缺省「用户+手机后4位」；
 * 邮箱注册：email=邮箱、phone 不变（phone_verified=0）。
 * 注册成功视同完成登录验证，直接签发 JWT 并创建会话（remember=true），返回结构与登录一致。
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { identifier, email: legacyEmail, password, username, code, turnstile_token, tokens } = req.body ?? {};
    // 兼容旧版字段：identifier 缺失时回退读取 email（邮箱注册路径）
    const account = (typeof identifier === 'string' ? identifier : typeof legacyEmail === 'string' ? legacyEmail : '').trim();

    // V1.10.1：严格入口校验 —— 必须为字符串（拦截对象/数组等类型混淆，
    // 防止非字符串进入 ORM 绑定位置触发引擎错误外泄）
    if (!account || typeof password !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    if (!password) {
      return sendError(res, 400, 'INVALID_PARAMS', '账号和密码不能为空');
    }
    if (account.length > 254 || password.length > 200) {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    if (username !== undefined && (typeof username !== 'string' || username.length > 50)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    const kind = detectIdentifier(account);
    if (!kind) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的手机号或邮箱');
    }
    // 验证码必填：格式收敛为 6 位数字字符串（防注入 + 提前拦截无效请求）
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return sendError(res, 400, 'OTP_REQUIRED', '请输入 6 位验证码');
    }

    // V1.8.0 人机验证：注册必须先通过 Turnstile（action=register；测试环境可用 tokens 绕过）
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, 'register', getVerificationIp(req));
      if (!verdict.ok) {
        return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
      }
    }

    // 注册验证码校验（scene=register）：失败原因码映射统一文案，不落明文码
    const otpResult = await verifyCode(account, code, 'register');
    if (!otpResult.ok) {
      switch (otpResult.error) {
        case 'OTP_NOT_FOUND':
        case 'OTP_EXPIRED':
        case 'OTP_INVALID':
          return sendError(res, 400, 'OTP_EXPIRED', '验证码已过期，请重新获取');
        case 'OTP_MISMATCH':
          return sendError(res, 400, 'OTP_MISMATCH', '验证码错误');
        case 'OTP_LOCKED':
        default:
          return sendError(res, 400, 'OTP_LOCKED', '验证码错误次数过多，请重新获取');
      }
    }

    const user = await register(account, password, username);

    // 注册成功即完成登录验证：直接签发 JWT + 创建长期会话（remember 默认 true）
    const ipAddress = getClientIp(req);
    const result = await issueLoginResult(user, true, ipAddress);

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
    const message = error instanceof Error ? error.message : '注册失败';
    // 唯一性冲突（手机号 / 邮箱已注册）归一化为 409
    if (message.includes('已被注册')) {
      return sendError(res, 409, 'ALREADY_REGISTERED', message);
    }
    res.status(500).json({ success: false, message, code: 'REGISTER_FAILED' });
  }
});

/**
 * 用户登录第一步（V1.11.0 两段式改造）。
 * 入参 { identifier, password, turnstile_token }（identifier 兼容旧字段 email）。
 * identifier 自动识别邮箱 / 手机号（手机号查 phone 列、邮箱查 email 列）；
 * 手机号未注册返回 404 PHONE_NOT_REGISTERED（提示继续登录将注册新账号）。
 * 密码校验通过后不签发 JWT、不创建会话，仅返回 login_ticket（HMAC-SHA256 签名，
 * 绑定 userId + 过期时间 + 客户端 IP，10 分钟有效）与可用验证码通道列表：
 *  - email 通道：用户 email 非空时提供；
 *  - phone 通道：用户 phone 非空且 phone_verified=1 时提供。
 * 客户端须继续调用 POST /login/verify 完成验证码确认。
 *
 * 测试兼容（仅 NODE_ENV=test 且 turnstile_token === TEST_BYPASS_TOKEN）：
 * 维持改造前原行为直接签发 JWT + 创建会话，保证存量测试套件不受影响。
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { identifier, email: legacyEmail, password, turnstile_token, tokens } = req.body ?? {};
    // 兼容旧版字段：identifier 缺失时回退读取 email（邮箱登录路径）
    const account = (typeof identifier === 'string' ? identifier : typeof legacyEmail === 'string' ? legacyEmail : '').trim();

    // V1.10.1：严格入口校验（同注册），拦截类型混淆导致的引擎错误外泄
    if (!account || typeof password !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    if (!password) {
      return sendError(res, 400, 'INVALID_PARAMS', '账号和密码不能为空');
    }
    if (account.length > 254 || password.length > 200) {
      return sendError(res, 400, 'INVALID_PARAMS', '请求参数格式不正确');
    }
    if (!detectIdentifier(account)) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的手机号或邮箱');
    }

    const ipAddress = getClientIp(req);
    const vIp = getVerificationIp(req);

    // 测试兼容路径（TEST BYPASS）：仅测试环境且 turnstile_token 命中 TEST_BYPASS_TOKEN 时，
    // 维持改造前原行为直接签发 JWT + 创建会话（旧测试不挂）；生产环境该通道物理关闭
    const testBypass =
      isTestBypass(tokens) ||
      (process.env.NODE_ENV === 'test' &&
        typeof turnstile_token === 'string' &&
        turnstile_token === (process.env.TEST_BYPASS_TOKEN || ''));

    // V1.8.0 人机验证（fail-closed），按序判断：
    // 1) 测试环境绕过；2) 168h 内已验证、未登出且 IP 未变 → 免重复验证；
    // 3) 否则必须携带有效 Turnstile token（action=login）方可进入密码校验
    if (!testBypass) {
      const userRow = await findUserByIdentifier(account);
      const verified = userRow ? await getValidVerification('user', userRow.id, vIp) : null;
      if (!verified) {
        const verdict = await verifyTurnstileToken(turnstile_token, 'login', vIp);
        if (!verdict.ok) {
          return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
        }
      }
    }

    // 手机号未注册：返回 404 + 业务码，前端据此引导「继续登录将注册新账号」流程
    if (detectIdentifier(account) === 'phone') {
      const exists = await findUserByIdentifier(account);
      if (!exists) {
        return sendError(res, 404, 'PHONE_NOT_REGISTERED', '该手机号未注册，继续登录将注册新账号');
      }
    }

    // 第一步：仅校验密码（不签发 JWT / 不创建会话）
    const user = await verifyPasswordOnly(account, password);

    // 测试兼容路径直接完成签发（不走验证码第二步）
    if (testBypass) {
      const result = await issueLoginResult(user, true, ipAddress);
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

    // 第二步前置：返回 login_ticket 与可用验证码通道（10 分钟内完成确认）
    const channels: string[] = [];
    if (user.email) channels.push('email');
    if (user.phone && user.phone_verified === 1) channels.push('phone');

    const loginTicket = signLoginTicket(user.id, vIp);

    return res.json({
      success: true,
      data: {
        otp_required: true,
        login_ticket: loginTicket,
        channels,
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
 * 用户登录第二步：验证码确认（V1.11.0）。
 * 入参 { login_ticket, channel, code }；channel ∈ email / phone，
 * 校验目标取该用户的 email / phone 字段（客户端不可伪造 target）。
 * 依次校验：login_ticket 签名 / 过期 / IP 匹配 → otpService.verifyCode(scene=login)。
 * 通过后复用 issueLoginResult 签发 JWT + 创建会话（remember 默认 true），
 * 并建立 168h 人机验证状态；返回结构与原登录一致。
 * 限速：10 次/分/IP（authLimiter 同规格独立实例），抑制验证码爆破。
 */
router.post('/login/verify', createRateLimiter({ max: 10, message: '尝试过于频繁，请稍后再试' }), async (req, res) => {
  try {
    const { login_ticket, channel, code } = req.body ?? {};

    if (typeof login_ticket !== 'string' || login_ticket.length > 2048) {
      return sendError(res, 400, 'INVALID_TICKET', '登录票据无效，请重新登录');
    }
    if (channel !== 'email' && channel !== 'phone') {
      return sendError(res, 400, 'INVALID_PARAMS', '不支持的验证通道');
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return sendError(res, 400, 'OTP_REQUIRED', '请输入 6 位验证码');
    }

    const vIp = getVerificationIp(req);

    // 票据校验：签名（恒时比较）+ 过期 + IP 匹配（XFF 首段）
    const payload = verifyLoginTicket(login_ticket, vIp);
    if (!payload) {
      return sendError(res, 401, 'INVALID_TICKET', '登录票据已失效，请重新登录');
    }

    const user = await getUserById(payload.userId);
    if (!user) {
      return sendError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    }
    // 封禁 / 禁用在出票后可能已发生，签发前必须复核
    if (user.banned_at) {
      return sendError(res, 401, 'USER_BANNED', '该账号已被封禁');
    }
    if (!user.is_active) {
      return sendError(res, 401, 'USER_DISABLED', '用户已被禁用');
    }

    // 校验目标由服务端按通道从用户记录取（不信任客户端传 target）
    const target = channel === 'email' ? user.email : user.phone;
    if (!target) {
      return sendError(res, 400, 'CHANNEL_UNAVAILABLE', '该账号不支持此验证通道');
    }

    const otpResult = await verifyCode(target, code, 'login');
    if (!otpResult.ok) {
      switch (otpResult.error) {
        case 'OTP_NOT_FOUND':
        case 'OTP_EXPIRED':
        case 'OTP_INVALID':
          return sendError(res, 400, 'OTP_EXPIRED', '验证码已过期，请重新获取');
        case 'OTP_MISMATCH':
          return sendError(res, 400, 'OTP_MISMATCH', '验证码错误');
        case 'OTP_LOCKED':
        default:
          return sendError(res, 400, 'OTP_LOCKED', '验证码错误次数过多，请重新获取');
      }
    }

    // 签发 JWT + 创建长期会话（remember 默认 true），建立 168h 人机验证状态
    const result = await issueLoginResult(user, true, getClientIp(req));
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
 * 绑定手机号（V1.11.0，需登录）。
 * 入参 { phone, code, turnstile_token }；手机号格式校验 + 查重（被他人绑定 → 409）。
 * 通过 otpService.verifyCode(phone, code, 'bind_phone') 校验后写入 phone 并置 phone_verified=1。
 * 返回更新后的用户公开资料。
 */
router.post('/phone/bind', async (req, res) => {
  try {
    const { user, error } = await loadAuthUser(req);
    if (error) {
      return sendError(res, error.status, error.code, error.message);
    }
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', '请先登录');
    }

    const { phone, code, turnstile_token, tokens } = req.body ?? {};
    if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone.trim())) {
      return sendError(res, 400, 'INVALID_PARAMS', '请输入正确的手机号');
    }
    const trimmedPhone = phone.trim();
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return sendError(res, 400, 'OTP_REQUIRED', '请输入 6 位验证码');
    }

    // Turnstile 人机验证（action=login，与验证码发送一致；测试环境可绕过）
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, 'login', getVerificationIp(req));
      if (!verdict.ok) {
        return sendError(res, verdict.status, 'HUMAN_VERIFICATION_REQUIRED', verdict.message);
      }
    }

    // 查重：手机号已被其他账号绑定 → 409
    const conflict = await db.get('SELECT id FROM users WHERE phone = ?', trimmedPhone);
    if (conflict && conflict.id !== user.id) {
      return sendError(res, 409, 'ALREADY_REGISTERED', '该手机号已被其他账号绑定');
    }

    const otpResult = await verifyCode(trimmedPhone, code, 'bind_phone');
    if (!otpResult.ok) {
      switch (otpResult.error) {
        case 'OTP_NOT_FOUND':
        case 'OTP_EXPIRED':
        case 'OTP_INVALID':
          return sendError(res, 400, 'OTP_EXPIRED', '验证码已过期，请重新获取');
        case 'OTP_MISMATCH':
          return sendError(res, 400, 'OTP_MISMATCH', '验证码错误');
        case 'OTP_LOCKED':
        default:
          return sendError(res, 400, 'OTP_LOCKED', '验证码错误次数过多，请重新获取');
      }
    }

    await db.run('UPDATE users SET phone = ?, phone_verified = 1, updated_at = ? WHERE id = ?', [
      trimmedPhone,
      new Date().toISOString(),
      user.id,
    ]);

    const updated = await getUserById(user.id);
    return res.json({
      success: true,
      data: {
        id: updated!.id,
        email: updated!.email,
        username: updated!.username,
        avatar_url: updated!.avatar_url,
        phone: updated!.phone,
        phone_verified: updated!.phone_verified,
      },
    });
  } catch (err) {
    console.error('Phone bind error:', err);
    return sendError(res, 500, 'BIND_FAILED', '绑定手机号失败，请稍后再试');
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
        phone: user.phone,
        website: user.website,
        location: user.location,
        // custom_fields 以 JSON 字符串存储，返回时解析为对象
        custom_fields: user.custom_fields ? JSON.parse(user.custom_fields) : null,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

/**
 * 更新当前登录用户资料。
 * 支持用户名、简介、电话、网站、所在地与自定义字段；custom_fields 序列化为 JSON 字符串存储。
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

    // V1.8.0：资料修改为高危操作，需人机验证状态（168h 内同 IP 有效）
    const denied = await ensureHumanVerified('user', decoded.userId, req);
    if (denied) {
      return res.status(denied.status).json(denied.payload);
    }

    const { username, bio, phone, website, location, custom_fields } = req.body;

    const updatedUser = await updateUser(decoded.userId, {
      username,
      bio,
      phone,
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
        phone: updatedUser.phone,
        website: updatedUser.website,
        location: updatedUser.location,
        custom_fields: updatedUser.custom_fields ? JSON.parse(updatedUser.custom_fields) : null,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '更新用户信息失败' });
  }
});

/**
 * 修改当前登录用户密码。
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

    // V1.8.0：修改密码为高危操作，需人机验证状态（168h 内同 IP 有效）
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
 * 上传当前用户头像。
 * 接收 multipart 文件，保存至本地 uploads 目录后写入用户记录，
 * 头像 URL 通过 /uploads 静态目录对外提供。
 */
router.post('/me/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // 鉴权失败时 multer 已将文件落盘，需清理临时文件
      cleanupTempFile(req);
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      // 令牌无效时 multer 已将文件落盘，需清理临时文件
      cleanupTempFile(req);
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    // V1.8.0：头像上传为高危操作，需人机验证状态；拦截时清理 multer 已落盘临时文件
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
    // 异常路径下文件未被正式使用，清理临时文件
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
      // V1.8.0：退出登录使人机验证状态立即失效（再次高危操作需重新验证）
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

    // 构建查询：可选状态过滤
    let query = 'SELECT * FROM photos WHERE user_id = ?';
    const params: any[] = [decoded.userId];

    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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
          return {
            ...photo,
            thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
            original_url: getProxyUrl(photo.original_url, photo.id),
            preview_url: photo.preview_url ? getProxyUrl(photo.preview_url, photo.id) : '',
            watermarked_url: photo.watermarked_url ? getProxyUrl(photo.watermarked_url, photo.id) : '',
            tags,
            rejection_reason: photo.rejection_reason || null,
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
