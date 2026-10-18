/**
 * @file 站点公告 API（V4.1.0）
 * @description
 *  封装公开公告端点（后端 120 次/分限速）：
 *   GET /announcements — 仅返回 is_active=1 的公告，created_at 倒序。
 *  供 TopBanner 组件消费；管理端 CRUD 走 admin 域，不在此文件。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 公告条目（公开字段，不含 created_by 内部字段） */
export interface Announcement {
  id: string;
  title: string;
  content: string;
  /** 封面图 URL（可空） */
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 获取已上线公告列表
 * @returns ApiResponse<Announcement[]>，按 created_at 倒序
 */
export async function getAnnouncements(): Promise<ApiResponse<Announcement[]>> {
  return request<Announcement[]>('/announcements');
}
