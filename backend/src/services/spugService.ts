/**
 * @file spugService.ts
 * @description Spug 推送平台短信验证码服务。
 *              封装 push.spug.cc 官方验证码短信模板接口（/sms），
 *              为登录 / 注册 / 绑定手机号等场景提供一次性验证码（OTP）短信发送能力。
 *              邮件通道自 V1.12.0 起改由 aliMailService（阿里云 DirectMail SMTP）承担。
 *
 *              模板编码经 SPUG_SMS_TEMPLATE 环境变量注入，禁止硬编码；
 *              未配置时抛出 503 型错误（OTP_SERVICE_NOT_CONFIGURED，与 EverOS 未配置策略一致），
 *              由路由层捕获后转换为规范响应。
 *
 *              安全约束：上游返回的 msg 可能包含模板配置、目标号码等敏感细节，
 *              对客户端一律脱敏为通用提示「验证码发送失败，请稍后再试」，
 *              原始 code / request_id 仅记录到服务端日志（request_id 不持久化）。
 */

/** 上游请求超时（毫秒）：Spug 模板推送典型响应 < 2s，15s 兜底防连接挂死 */
const REQUEST_TIMEOUT_MS = 15000;

/** Spug 模板接口响应信封：code === 200 视为成功，msg 为错误描述 */
interface SpugResponse {
  code?: number;
  msg?: string;
  request_id?: string;
}

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

/**
 * 统一的 Spug 模板推送调用。
 * 处理 JSON 信封解析、15s 超时中止与错误归一化：
 * 响应 code !== 200（含非 2xx / 非 JSON）与网络异常一律抛出 502 型脱敏错误。
 *
 * @param path 以 / 开头的模板接口路径（含模板编码，如 /sms/abc123）
 * @param body 模板变量请求体
 */
async function postSpugTemplate(path: string, body: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://push.spug.cc${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let payload: SpugResponse | null = null;
    try {
      payload = (await response.json()) as SpugResponse;
    } catch {
      payload = null;
    }

    // Spug 约定 code === 200 为成功；其余一律视为发送失败。
    // 客户端提示固定脱敏，不回显上游 msg；request_id 仅入日志便于对账排查
    if (!response.ok || payload?.code !== 200) {
      console.error(
        `[Spug] 验证码发送失败: path=${path} http=${response.status} code=${payload?.code ?? '-'} request_id=${payload?.request_id ?? '-'}`
      );
      throw createOtpError(502, 'OTP_SEND_FAILED', '验证码发送失败，请稍后再试');
    }
  } catch (err) {
    // 已归一化的业务错误直接透传，避免被二次包装
    if ((err as OtpServiceError)?.code === 'OTP_SEND_FAILED') {
      throw err;
    }
    // 网络异常 / 15s 超时中止：统一归一化为 502 发送失败
    console.error(`[Spug] 验证码请求异常: path=${path}`, err instanceof Error ? err.message : err);
    throw createOtpError(502, 'OTP_SEND_FAILED', '验证码发送失败，请稍后再试');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 发送短信验证码。
 * @param to 接收手机号
 * @param code 6 位明文验证码（仅用于发送，本服务不落日志）
 * @param minutes 有效分钟数（透传给模板变量 number，字符串形式）
 */
export async function sendSmsCode(to: string, code: string, minutes: number): Promise<void> {
  // 模板编码在调用时动态读取，避免模块加载早于 dotenv.config() 读到空值
  const template = process.env.SPUG_SMS_TEMPLATE;
  if (!template) {
    throw createOtpError(503, 'OTP_SERVICE_NOT_CONFIGURED', '验证码服务未配置');
  }
  await postSpugTemplate(`/sms/${template}`, { to, code, number: String(minutes) });
}
