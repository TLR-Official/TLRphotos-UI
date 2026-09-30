/**
 * @file aliMailService.ts
 * @description 阿里云邮件推送（DirectMail）SMTP 验证码服务。
 *              通过 smtpdm.aliyun.com:465 为登录 / 注册等场景发送一次性验证码（OTP）邮件，
 *              自 V1.12.0 起替换原 SPUG 邮件通道（短信通道仍由 spugService 承担）。
 *
 *              连接参数与凭据经环境变量注入，禁止硬编码：
 *                ALIYUN_SMTP_HOST / ALIYUN_SMTP_PORT / ALIYUN_SMTP_USER /
 *                ALIYUN_SMTP_PASSWORD / ALIYUN_MAIL_FROM_NAME
 *              未配置密码（含占位符 CHANGE_ME）时抛出 503（OTP_SERVICE_NOT_CONFIGURED）；
 *              SMTP 认证失败、连接异常或超时统一归一化为 502（OTP_SEND_FAILED），
 *              对客户端一律脱敏，原始错误仅记录到服务端日志。
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** SMTP 通信超时（毫秒）：DirectMail 典型响应 < 3s，15s 兜底防连接挂死 */
const REQUEST_TIMEOUT_MS = 15000;

/** 占位密码：用户尚未填写真实 SMTP 密码时视为未配置 */
const PASSWORD_PLACEHOLDER = 'CHANGE_ME';

/** 带 HTTP 状态与业务码的服务错误（路由层 / errorHandler 按 status 识别透传） */
export interface OtpServiceError extends Error {
  status: number;
  code: string;
}

/** 构造统一形态的服务错误 */
function createOtpError(status: number, code: string, message: string): OtpServiceError {
  const error = new Error(message) as OtpServiceError;
  error.status = status;
  error.code = code;
  return error;
}

/** SMTP 连接配置（调用时动态读取环境变量，与 dotenv 加载顺序解耦） */
interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromName: string;
}

/** 读取并校验 SMTP 配置；缺项抛出 503 型错误 */
function readSmtpConfig(): SmtpConfig {
  const host = process.env.ALIYUN_SMTP_HOST?.trim();
  const user = process.env.ALIYUN_SMTP_USER?.trim();
  const password = process.env.ALIYUN_SMTP_PASSWORD?.trim();
  const fromName = process.env.ALIYUN_MAIL_FROM_NAME?.trim() || 'TLR Photos';
  const port = Number(process.env.ALIYUN_SMTP_PORT) || 465;

  if (!host || !user || !password || password === PASSWORD_PLACEHOLDER) {
    throw createOtpError(503, 'OTP_SERVICE_NOT_CONFIGURED', '验证码服务未配置');
  }
  return { host, port, user, password, fromName };
}

/** 复用的 SMTP 传输器单例（首次发送时按配置惰性创建） */
let transporter: Transporter | null = null;
let transporterKey = '';

/**
 * 获取传输器单例；配置变更（host/user/port）时自动重建，
 * 避免修改 .env 重启前长期持有旧连接。
 */
function getTransporter(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.user}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // 465 走隐式 SSL；其余端口（如 80/25/8080）使用明文 STARTTLS 由服务端协商
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: REQUEST_TIMEOUT_MS,
      greetingTimeout: REQUEST_TIMEOUT_MS,
      socketTimeout: REQUEST_TIMEOUT_MS,
    });
    transporterKey = key;
  }
  return transporter;
}

/**
 * 发送邮件验证码。
 * @param to 接收邮箱
 * @param code 6 位明文验证码（仅用于发送，本服务不落日志）
 * @param minutes 有效分钟数
 * @param scene 业务场景名（默认「登录验证」，用于标题与正文）
 */
export async function sendMailCode(
  to: string,
  code: string,
  minutes: number,
  scene = '登录验证'
): Promise<void> {
  const config = readSmtpConfig();

  // scene 来自路由层固定映射，不含用户输入；此处仍转义 HTML 特殊字符做纵深防御
  const safeScene = scene.replace(/[<>&"]/g, (ch) =>
    ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : '&quot;'
  );

  const text = [
    `您正在进行「${scene}」操作。`,
    `验证码：${code}`,
    `验证码 ${minutes} 分钟内有效，请勿泄露给他人。`,
    '如非本人操作，请忽略此邮件。',
  ].join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#f7f8fa;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1f2937;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #eef0f2;">
    <h1 style="margin:0 0 8px;font-size:18px;">${safeScene}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">您正在进行「${safeScene}」操作，请使用以下验证码完成验证：</p>
    <p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:8px;color:#0d9488;">${code}</p>
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">验证码 ${minutes} 分钟内有效，请勿泄露给他人。如非本人操作，请忽略此邮件。</p>
  </div>
</body>
</html>`;

  try {
    await getTransporter(config).sendMail({
      // 非 ASCII 发件人名由 nodemailer 按 RFC 2047 自动编码
      from: { name: config.fromName, address: config.user },
      to,
      subject: `【${config.fromName}】${scene}验证码`,
      text,
      html,
    });
  } catch (err) {
    // 认证失败 / 连接拒绝 / 超时：客户端固定脱敏，原始原因仅入服务端日志
    console.error(
      `[AliMail] 验证码邮件发送失败: to=${to} reason=${err instanceof Error ? err.message : err}`
    );
    throw createOtpError(502, 'OTP_SEND_FAILED', '验证码发送失败，请稍后再试');
  }
}
