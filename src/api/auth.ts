/**
 * @file 认证 API
 * @description
 *  封装与用户认证、账户管理相关的后端接口（V2.0.0：纯邮箱认证体系）。
 *  核心功能：
 *   1. 登录 / 注册 / Token 刷新（含 session_token 长期会话）。
 *   2. 当前用户信息获取与更新、修改密码、上传头像、绑定 / 更换邮箱。
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
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  email_verified: number;      // V2.0.0：邮箱是否已通过验证码确权（1=已验证）
  website: string | null;
  location: string | null;
  custom_fields: Record<string, CustomField> | null;
  created_at?: string;
  /** V4.7.0：邀请码授予的专属称号（未获称号为 null） */
  title?: string | null;
}

/** 登录成功返回的业务数据 */
export interface LoginData {
  user: User;
  token: string;
}

/** 注册成功 / 验证码确认后签发的业务数据 */
export interface LoginSuccessData {
  user: User;
  token: string;
  session_token?: string;
}

/** 登录第一步返回的邮箱验证码挑战数据（otp_required=true） */
export interface LoginOtpData {
  otp_required: true;
  login_ticket: string;                       // HMAC 签名票据，10 分钟有效
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

/** 无邮箱账号登录响应：须先绑定邮箱 */
export interface EmailBindRequiredResponse {
  success: boolean;
  code: 'EMAIL_BIND_REQUIRED';
  message: string;
  data?: { bind_ticket: string; expires_minutes: number };
}

/** 注册接口响应（注册成功视同登录，直接签发 token + 会话） */
export interface RegisterResponse {
  success: boolean;
  message?: string;
  code?: string;      // 业务错误码（人机验证拦截时为 HUMAN_VERIFICATION_REQUIRED）
  data?: LoginSuccessData;
}

/** 注册成功返回的业务数据（与登录成功结构一致） */
export type RegisterData = LoginSuccessData;

/** 邮箱验证码业务场景 */
export type OtpScene = 'login' | 'register' | 'bind_email';

/** 发送邮箱验证码接口返回的业务数据 */
export interface SendOtpData {
  channel: 'mail';            // 固定邮件通道
  cooldown: number;           // 重发冷却秒数（60）
  expires_minutes: number;    // 验证码有效期（分钟）
  target: string;             // 脱敏后的邮箱（如 a***@x.com）
}

/** 绑定 / 更换邮箱接口返回的业务数据 */
export interface BindEmailData {
  id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  email_verified: number;
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
 * @description 两段式登录：密码校验通过后返回 login_ticket，
 *              须继续调用 verifyLogin 完成邮箱验证码确认（测试 bypass 场景直接签发 token）。
 * @param email - 邮箱地址
 * @param password - 密码
 * @param remember - 是否启用长期会话（保留兼容，后端当前固定创建长期会话）
 * @param turnstileToken - Turnstile 人机验证令牌
 * @returns LoginResponse 联合：otp_required=true 含 login_ticket；否则含 user/token/session_token
 */
export async function login(email: string, password: string, remember?: boolean, turnstileToken?: string): Promise<LoginResponse> {
  // 超时控制：登录涉及 bcrypt 校验，留 30s 余量；超时后 abort 中断 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, remember, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) }),
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
  // 超时控制：refresh 通常 <1s，给 15s 余量；超时后 abort 中断
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
 * 登录第二步：邮箱验证码确认
 * @description 凭 login_ticket + 6 位邮箱验证码完成登录，成功签发 token 与会话。
 * @param loginTicket - 登录第一步返回的 HMAC 签名票据（10 分钟有效）
 * @param code - 6 位数字验证码
 * @returns ApiResponse<LoginSuccessData>
 */
export async function verifyLogin(loginTicket: string, code: string): Promise<ApiResponse<LoginSuccessData>> {
  return request<LoginSuccessData>('/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify({ login_ticket: loginTicket, code }),
  });
}

/**
 * 发送邮箱验证码（登录 / 注册 / 绑定邮箱）
 * @description 三层限速（60s 冷却 / 邮箱每小时 5 次 / IP 每小时 20 次）。
 * @param email - 邮箱地址
 * @param scene - 业务场景（login / register / bind_email）
 * @param turnstileToken - Turnstile 人机验证令牌（必传，action 与场景对应）
 * @param bindTicket - bind_email 场景下的绑定票据（未登录绑定时必传）
 * @returns ApiResponse<SendOtpData>，含脱敏邮箱与冷却秒数
 */
export async function sendEmailCode(
  email: string,
  scene: OtpScene,
  turnstileToken?: string,
  bindTicket?: string
): Promise<ApiResponse<SendOtpData>> {
  return request<SendOtpData>('/auth/email/code/send', {
    method: 'POST',
    body: JSON.stringify({
      email,
      scene,
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      ...(bindTicket ? { bind_ticket: bindTicket } : {}),
    }),
  });
}

/**
 * 绑定 / 更换邮箱
 * @description 未登录绑定（凭 bind_ticket）成功后直接签发 token；已登录更换邮箱返回更新资料。
 * @param email - 邮箱地址
 * @param code - 6 位邮箱验证码（scene=bind_email）
 * @param turnstileToken - Turnstile 人机验证令牌（action=login）
 * @param bindTicket - 绑定票据（无邮箱账号登录第一段返回）
 * @returns ApiResponse，bind_ticket 路径 data 含 token + 会话；JWT 路径为 BindEmailData
 */
export async function bindEmail(
  email: string,
  code: string,
  turnstileToken?: string,
  bindTicket?: string
): Promise<ApiResponse<LoginSuccessData | BindEmailData>> {
  return request<LoginSuccessData | BindEmailData>('/auth/email/bind', {
    method: 'POST',
    body: JSON.stringify({
      email,
      code,
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      ...(bindTicket ? { bind_ticket: bindTicket } : {}),
    }),
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
 * @description 邮箱验证码注册：需先通过 sendEmailCode 获取验证码；注册成功视同登录，直接签发 token + 会话。
 * @param email - 邮箱
 * @param password - 密码
 * @param username - 用户名（可选）
 * @param code - 6 位数字验证码（scene=register）
 * @param turnstileToken - Turnstile 人机验证令牌（action=register）
 * @param inviteCode - 邀请码（选填，有效时授予专属称号）
 * @returns ApiResponse<RegisterData>
 */
export async function register(
  email: string,
  password: string,
  username: string | undefined,
  code: string,
  turnstileToken?: string,
  inviteCode?: string,
): Promise<ApiResponse<RegisterData>> {
  const key = `register:${email}`;
  return deduplicatedRequest(key, () =>
    request<RegisterData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        username,
        code,
        ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
        ...(inviteCode ? { invite_code: inviteCode } : {}),
      }),
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
  /** 原审核员用户名（V4.1.2-beta.3：仅未通过记录非空，用于展示审核员编号） */
  reviewer_name?: string | null;
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
