/**
 * @file 公开用户主页 API（V4.1.0）
 * @description
 *  封装公开用户主页三端点（后端 120 次/分限速，均不含 email/IP 等隐私字段）：
 *   1. GET /users/:id/profile  公开档案（本人访问经 JWT 可选解析返回 is_self 与待审计数）。
 *   2. GET /users/:id/photos   公开作品列表（仅 approved，分页 + 分区筛选）。
 *   3. GET /users/:id/threads  公开论坛发帖记录（仅已发布，分页）。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 活跃处罚公开信息（仅四字段，已撤销/已过期由后端过滤） */
export interface PublicPenalty {
  /** 处罚等级：1=警告 / 2=功能封禁 / 3=账号封禁 */
  level: number;
  reason: string;
  /** 到期时间（L2/L3 有值；L1 为 null 表示无固定期限） */
  expires_at: string | null;
  created_at: string;
}

/** 公开用户档案 */
export interface UserProfile {
  id: string;
  username: string;
  avatar_url: string | null;
  /** V4.7.0：邀请码授予的专属称号（未获称号为 null） */
  title?: string | null;
  /** 省份地区（后端「未知」兜底） */
  region: string;
  /** 加入天数（now - created_at 取整） */
  joined_days: number;
  /** 本人访问为 true */
  is_self: boolean;
  /** 已通过作品数 */
  approved_count: number;
  /** 已通过作品总浏览数 */
  total_views: number;
  public_penalties: PublicPenalty[];
  /** 本人访问时返回：待审核作品数 */
  pending_count?: number;
  /** 本人访问时返回：未通过作品数 */
  rejected_count?: number;
}

/** 公开作品条目（字段形状对齐画廊列表，缩略图/预览图已由后端改写为代理 URL） */
export interface UserPhotoItem {
  id: string;
  title: string;
  thumbnail_path: string;
  preview_url: string | null;
  tags: string[];
  width: number;
  height: number;
  /** 分区 ID（aviation/railway/automobile 等，与画廊一致） */
  category: string | null;
  likes: number;
  views: number;
  created_at: string;
}

/** 公开作品分页响应 */
export interface UserPhotosPage {
  items: UserPhotoItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 公开发帖记录条目 */
export interface UserThreadItem {
  id: string;
  title: string;
  board_id: string;
  reply_count: number;
  like_count: number;
  created_at: string;
}

/** 公开发帖记录分页响应 */
export interface UserThreadsPage {
  items: UserThreadItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * 获取公开用户档案
 * @param userId 用户 ID
 * @returns ApiResponse<UserProfile>，404 时 code=USER_NOT_FOUND
 */
export async function getUserProfile(userId: string): Promise<ApiResponse<UserProfile>> {
  return request<UserProfile>(`/users/${encodeURIComponent(userId)}/profile`);
}

/**
 * 获取公开作品列表（仅 approved）
 * @param userId 用户 ID
 * @param page 页码（从 1 起）
 * @param pageSize 每页条数（后端默认 12，上限 50）
 * @param category 分区筛选（可选，值域与画廊一致）
 */
export async function getUserPhotos(
  userId: string,
  page = 1,
  pageSize = 12,
  category?: string
): Promise<ApiResponse<UserPhotosPage>> {
  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('page_size', String(pageSize));
  if (category) query.set('category', category);
  return request<UserPhotosPage>(`/users/${encodeURIComponent(userId)}/photos?${query.toString()}`);
}

/**
 * 获取公开论坛发帖记录（仅已发布）
 * @param userId 用户 ID
 * @param page 页码（从 1 起）
 * @param pageSize 每页条数（后端默认 10，上限 50）
 */
export async function getUserThreads(
  userId: string,
  page = 1,
  pageSize = 10
): Promise<ApiResponse<UserThreadsPage>> {
  return request<UserThreadsPage>(
    `/users/${encodeURIComponent(userId)}/threads?page=${page}&page_size=${pageSize}`
  );
}
