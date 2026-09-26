/**
 * @file 认证 API
 * @description
 *  封装与用户认证、账户管理相关的后端接口。
 *  核心功能：
 *   1. 登录 / 注册 / Token 刷新（含 session_token 长期会话）。
 *   2. 当前用户信息获取与更新、修改密码、上传头像。
 *   3. 用户统计数据查询。
 *   4. 登录 / 注册请求通过 requestManager 去重，避免重复提交。
 *  注意：login / refresh 直接使用 fetch 而非 request，因登录前可能尚未拿到统一错误处理逻辑，
 *       且登录接口需携带 session_token 字段，与请求客户端默认行为存在差异。
 */

import { request } from './client';
import type { ApiResponse } from './client';
import { deduplicatedRequest } from './requestManager';

/** 自定义字段：value 为字段值，isPrivate 标识是否仅自己可见 */
export interface CustomField {
  value: string;
  isPrivate: boolean;
}

/** 用户信息 */
export interface User {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone?: string | null;
  phone_verified?: number;   // V1.11.0：手机号是否已通过验证码绑定（1=已验证）
  website: string | null;
  location: string | null;
  custom_fields: Record<string, CustomField> | null;
  created_at?: string;
}

/** 登录成功返回的业务数据 */
export interface LoginData {
  user: User;
  token: string;
}

/** 登录成功返回的业务数据（V1.11.0：注册成功 / 验证码确认后签发，结构一致） */
export interface LoginSuccessData {
  user: User;
  token: string;
  session_token?: string;
}

/** 登录第一步返回的验证码挑战数据（otp_required=true） */
export interface LoginOtpData {
  otp_required: true;
  login_ticket: string;                       // HMAC 签名票据，10 分钟有效
  channels: Array<'email' | 'phone'>;         // 可用验证码通道
  expires_minutes: number;
}

/** 登录成功响应（直接签发 token） */
export interface LoginSuccessResponse {
  success: boolean;
  message?: string;
  code?: string;
  data?: LoginSuccessData;
}

/** 登录需验证码响应（进入第二段确认） */
export interface LoginOtpResponse {
  success: boolean;
  message?: string;
  code?: string;
  data?: LoginOtpData;
}

/** 登录接口响应联合类型：otp_required=true 为前者，否则为后者 */
export type LoginResponse = LoginOtpResponse | LoginSuccessResponse;

/** 注册接口响应（V1.11.0：注册成功视同登录，直接签发 token + 会话） */
export interface RegisterResponse {
  success: boolean;
  message?: string;
  code?: string;      // 业务错误码（人机验证拦截时为 HUMAN_VERIFICATION_REQUIRED）
  data?: LoginSuccessData;
}

/** 注册成功返回的业务数据（与登录成功结构一致） */
export type RegisterData = LoginSuccessData;

/** 验证码业务场景 */
export type OtpScene = 'login' | 'register' | 'bind_phone';

/** 发送验证码接口返回的业务数据 */
export interface SendOtpData {
  channel: 'sms' | 'mail';   // 实际发送通道
  cooldown: number;          // 重发冷却秒数（60）
  expires_minutes: number;   // 验证码有效期（分钟）
  target: string;            // 脱敏后的目标（如 138****5678 / a***@x.com）
}

/** 绑定手机号接口返回的业务数据 */
export interface BindPhoneData {
  id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  phone: string | null;
  phone_verified: number;
}

/** 头像上传成功返回的业务数据 */
export interface UploadAvatarData {
  id: string;
  avatar_url: string;
}

/** Token 刷新接口响应 */
export interface RefreshResponse {
  success: boolean;
  message?: string;
  data?: {
    user: User;
    token: string;
  };
}

/**
 * 登录第一步（直连 fetch，未经 request 客户端）
 * @description V1.11.0 两段式登录：密码校验通过后返回 login_ticket + 可用验证码通道，
 *              须继续调用 verifyLogin 完成验证码确认（测试 bypass 场景直接签发 token）。
 * @param identifier - 邮箱或手机号（后端自动识别）
 * @param password - 密码
 * @param remember - 是否启用长期会话（保留兼容，后端当前固定创建长期会话）
 * @param turnstileToken - Turnstile 人机验证令牌（V1.8.0，验证门要求时必传）
 * @returns LoginResponse 联合：otp_required=true 含 login_ticket/channels；否则含 user/token/session_token
 */
export async function login(identifier: string, password: string, remember?: boolean, turnstileToken?: string): Promise<LoginResponse> {
  // 超时控制：登录涉及 bcrypt 校验，留 30s 余量；超时后 abort 中断 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifier, password, remember, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!text) {
      // 区分 5xx（服务不可用，如上游 502）与 2xx 空响应
      if (response.status >= 500) {
        return {
          success: false,
          message: `服务器暂时不可用（${response.status}），请稍后重试`,
        };
      }
      return {
        success: false,
        message: '服务器未返回数据，请稍后重试',
      };
    }

    try {
      return JSON.parse(text);
    } catch {
      // 非 JSON 响应（如 Nginx 502 默认 HTML 页面）
      if (response.status >= 500) {
        return {
          success: false,
          message: `服务器暂时不可用（${response.status}），请稍后重试`,
        };
      }
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    console.error('Login error:', error);
    // 超时中断
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        message: '登录请求超时，请检查网络后重试',
      };
    }
    return {
      success: false,
      message: '网络请求失败，请检查网络连接后重试',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 刷新 Token（直连 fetch）
 * @param sessionToken - 长期会话 Token（remember 模式登录时获得）
 * @returns RefreshResponse，含新的 user 与 token
 */
export async function refresh(sessionToken: string): Promise<RefreshResponse> {
  // 超时控制：refresh 通常 <1s，给 15s 余量；超时后 abort 中断 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_token: sessionToken }),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!text) {
      if (response.status >= 500) {
        return {
          success: false,
          message: `服务器暂时不可用（${response.status}），请稍后重试`,
        };
      }
      return {
        success: false,
        message: '服务器未返回数据，请稍后重试',
      };
    }

    try {
      return JSON.parse(text);
    } catch {
      if (response.status >= 500) {
        return {
          success: false,
          message: `服务器暂时不可用（${response.status}），请稍后重试`,
        };
      }
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    console.error('Refresh error:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        message: '登录状态刷新超时，请重新登录',
      };
    }
    return {
      success: false,
      message: '网络请求失败，请检查网络连接后重试',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 登录第二步：验证码确认
 * @description 凭 login_ticket + 通道 + 6 位验证码完成登录，成功签发 token 与会话。
 * @param loginTicket - 登录第一步返回的 HMAC 签名票据（10 分钟有效）
 * @param channel - 验证通道（email / phone），目标由服务端按用户记录取值
 * @param code - 6 位数字验证码
 * @returns ApiResponse<LoginSuccessData>
 */
export async function verifyLogin(loginTicket: string, channel: 'email' | 'phone', code: string): Promise<ApiResponse<LoginSuccessData>> {
  return request<LoginSuccessData>('/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify({ login_ticket: loginTicket, channel, code }),
  });
}

/**
 * 发送验证码（登录 / 注册 / 绑定手机号）
 * @description target 自动识别手机号（短信）或邮箱（邮件）；三层限速（60s 冷却 / 目标每小时 5 次 / IP 每小时 20 次）。
 * @param target - 手机号或邮箱
 * @param scene - 业务场景（login / register / bind_phone）
 * @param turnstileToken - Turnstile 人机验证令牌（必传，action 与场景对应）
 * @returns ApiResponse<SendOtpData>，含脱敏目标与冷却秒数
 */
export async function sendOtp(target: string, scene: OtpScene, turnstileToken?: string): Promise<ApiResponse<SendOtpData>> {
  return request<SendOtpData>('/auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ target, scene, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }),
  });
}

/**
 * 绑定手机号（需登录）
 * @param phone - 手机号
 * @param code - 6 位短信验证码（scene=bind_phone）
 * @param turnstileToken - Turnstile 人机验证令牌（action=login）
 * @returns ApiResponse<BindPhoneData>，含更新后的手机号与验证状态
 */
export async function bindPhone(phone: string, code: string, turnstileToken?: string): Promise<ApiResponse<BindPhoneData>> {
  return request<BindPhoneData>('/auth/phone/bind', {
    method: 'POST',
    body: JSON.stringify({ phone, code, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }),
  });
}

/**
 * 登录（经 requestManager 去重版本）
 * @description 同一邮箱的并发登录请求会被合并为一次实际调用
 * @param email - 邮箱
 * @param password - 密码
 * @returns ApiResponse<LoginData>
 */
export async function loginWithManager(email: string, password: string): Promise<ApiResponse<LoginData>> {
  // 去重 key：以邮箱区分，避免重复登录请求
  const key = `login:${email}`;
  return deduplicatedRequest(key, () =>
    request<LoginData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  );
}

/**
 * 注册（经 requestManager 去重）
 * @description V1.11.0 验证码注册：identifier 自动识别邮箱 / 手机号，
 *              需先通过 sendOtp 获取验证码；注册成功视同登录，直接签发 token + 会话。
 * @param identifier - 邮箱或手机号
 * @param password - 密码
 * @param username - 用户名（可选，手机号注册缺省「用户+手机后4位」）
 * @param code - 6 位数字验证码（scene=register）
 * @param turnstileToken - Turnstile 人机验证令牌（action=register）
 * @returns ApiResponse<RegisterData>
 */
export async function register(identifier: string, password: string, username: string | undefined, code: string, turnstileToken?: string): Promise<ApiResponse<RegisterData>> {
  const key = `register:${identifier}`;
  return deduplicatedRequest(key, () =>
    request<RegisterData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, username, code, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }),
    })
  );
}

/**
 * 获取当前登录用户信息
 * @returns ApiResponse<User>
 */
export async function getCurrentUser(): Promise<ApiResponse<User>> {
  return request<User>('/auth/me');
}

/**
 * 更新当前用户信息
 * @param data - 需要更新的字段（部分 User 字段）
 * @returns ApiResponse<User>，返回更新后的完整用户信息
 */
export async function updateUser(data: Partial<User>): Promise<ApiResponse<User>> {
  return request<User>('/auth/me', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * 修改当前用户密码
 * @param oldPassword - 旧密码
 * @param newPassword - 新密码
 * @returns ApiResponse，data.message 提示修改结果
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<ApiResponse<{ message?: string }>> {
  return request<{ message?: string }>('/auth/me/password', {
    method: 'PUT',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

/**
 * 上传用户头像
 * @param file - 头像文件
 * @returns ApiResponse<UploadAvatarData>，含新的 avatar_url
 */
export async function uploadAvatar(file: File): Promise<ApiResponse<UploadAvatarData>> {
  // FormData 由浏览器设置 boundary，无需手动指定 Content-Type
  const formData = new FormData();
  formData.append('avatar', file);

  return request<UploadAvatarData>('/auth/me/avatar', {
    method: 'POST',
    body: formData,
  });
}

/** 用户统计数据 */
export interface UserStats {
  totalUploads: number;   // 总上传数
  approved: number;       // 已审核通过数
  pending: number;        // 待审核数
  rejected: number;       // 已拒绝数
  approvalRate: number;   // 通过率（0-1）
  totalViews: number;     // 总浏览数
  totalLikes: number;     // 总点赞数
  recentUploads: number;  // 最近上传数
}

/**
 * 获取指定用户的统计数据
 * @param userId - 用户 ID
 * @returns ApiResponse<UserStats>
 */
export async function getUserStats(userId: string): Promise<ApiResponse<UserStats>> {
  return request<UserStats>(`/auth/users/${userId}/stats`);
}

/** 我的照片列表项（包含审核状态与驳回理由） */
export interface MyPhoto {
  id: string;
  title: string;
  thumbnail_path: string;
  tags: string[];
  status: string;
  rejection_reason: string | null;
  created_at: string;
  description: string;
  width?: number;
  height?: number;
  original_url: string;
  preview_url?: string;
  watermarked_url?: string;
  likes?: number;
  views?: number;
}

/** 我的照片列表响应 */
export interface MyPhotosResponse {
  photos: MyPhoto[];
  total: number;
}

/**
 * 获取当前登录用户的所有照片（含审核状态与驳回理由）
 * @param status - 可选状态过滤：pending / approved / rejected
 * @param page - 页码
 * @param pageSize - 每页数量
 * @returns ApiResponse<MyPhotosResponse>
 */
export async function getMyPhotos(
  status?: string,
  page = 1,
  pageSize = 20
): Promise<ApiResponse<MyPhotosResponse>> {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  query.set('page', String(page));
  query.set('pageSize', String(pageSize));
  return request<MyPhotosResponse>(`/auth/me/photos?${query.toString()}`);
}
