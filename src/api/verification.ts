/**
 * @file 人机验证 API（V1.8.0）
 * @description
 *  封装用户侧人机验证接口：
 *   1. GET  /verification/status  查询当前用户验证状态（verified / verified_at / expires_at）。
 *   2. POST /verification/verify  提交 Turnstile 挑战令牌，建立 168h 验证状态（绑定 IP）。
 *  高危操作被后端 403（code=HUMAN_VERIFICATION_REQUIRED）拦截后，
 *  前端弹出验证组件，完成挑战 → 调用本模块提交 → 重试原操作。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 高危操作对应的验证 action（与后端 VERIFICATION_ACTIONS 白名单一致） */
export type VerificationAction =
  | 'login'
  | 'register'
  | 'change_password'
  | 'update_profile'
  | 'avatar_upload'
  | 'photo_upload'
  | 'photo_delete'
  | 'admin_user_admin';

/** 后端验证门拦截响应携带的业务错误码 */
export const HUMAN_VERIFICATION_REQUIRED = 'HUMAN_VERIFICATION_REQUIRED';

/** 验证状态数据 */
export interface VerificationState {
  verified: boolean;      // 当前是否处于有效验证状态
  verified_at?: string;   // 验证通过时间（ISO 字符串）
  expires_at?: string;    // 验证到期时间（ISO 字符串，168h）
}

/**
 * 判断响应是否为"需要人机验证"拦截
 * @param res 携带 success 与可选 code 的接口响应
 */
export function isVerificationRequired(res: { success?: boolean; code?: string } | null | undefined): boolean {
  return !!res && res.success === false && res.code === HUMAN_VERIFICATION_REQUIRED;
}

/**
 * 查询当前用户的人机验证状态
 * @returns ApiResponse<VerificationState>
 */
export async function getVerificationStatus(): Promise<ApiResponse<VerificationState>> {
  return request<VerificationState>('/verification/status');
}

/**
 * 提交 Turnstile 挑战令牌，校验通过后建立 168 小时验证状态（绑定当前 IP）
 * @param action 与 widget data-action 一致的操作类型（白名单内）
 * @param turnstileToken Turnstile widget 返回的令牌（一次性）
 */
export async function submitVerification(
  action: VerificationAction,
  turnstileToken: string
): Promise<ApiResponse<VerificationState>> {
  return request<VerificationState>('/verification/verify', {
    method: 'POST',
    body: JSON.stringify({ action, turnstile_token: turnstileToken }),
  });
}
