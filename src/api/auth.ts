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
  phone: string | null;
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

/** 登录接口响应（含可选 session_token 用于 remember 模式） */
export interface LoginResponse {
  success: boolean;
  message?: string;
  data?: {
    user: User;
    token: string;
    session_token?: string;
  };
}

/** 注册接口响应 */
export interface RegisterResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string;
    email: string;
    username: string | null;
  };
}

/** 注册成功返回的业务数据 */
export interface RegisterData {
  id: string;
  email: string;
  username: string | null;
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
 * 登录（直连 fetch，未经 request 客户端）
 * @param email - 邮箱
 * @param password - 密码
 * @param remember - 是否启用长期会话（返回 session_token）
 * @returns LoginResponse，含 user、token 与可选 session_token
 */
export async function login(email: string, password: string, remember?: boolean): Promise<LoginResponse> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, remember }),
    });

    const text = await response.text();

    if (!text) {
      return {
        success: false,
        message: '服务器未返回响应',
      };
    }

    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      message: '网络请求失败，请稍后重试',
    };
  }
}

/**
 * 刷新 Token（直连 fetch）
 * @param sessionToken - 长期会话 Token（remember 模式登录时获得）
 * @returns RefreshResponse，含新的 user 与 token
 */
export async function refresh(sessionToken: string): Promise<RefreshResponse> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_token: sessionToken }),
    });

    const text = await response.text();

    if (!text) {
      return {
        success: false,
        message: '服务器未返回响应',
      };
    }

    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    console.error('Refresh error:', error);
    return {
      success: false,
      message: '网络请求失败，请稍后重试',
    };
  }
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
 * @param email - 邮箱
 * @param password - 密码
 * @param username - 用户名（可选）
 * @returns ApiResponse<RegisterData>
 */
export async function register(email: string, password: string, username?: string): Promise<ApiResponse<RegisterData>> {
  const key = `register:${email}`;
  return deduplicatedRequest(key, () =>
    request<RegisterData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username }),
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
