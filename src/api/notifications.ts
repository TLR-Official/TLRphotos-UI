/**
 * @file 通知中心 API（V4.0.0）
 * @description
 *  封装当前登录用户的通知中心接口（后端 requireAuth，Token 由 client.ts 自动注入）：
 *   1. GET  /notifications               分页通知列表（created_at 倒序）。
 *   2. GET  /notifications/unread-count  未读数量。
 *   3. PUT  /notifications/:id/read      单条已读（他人的通知 404）。
 *   4. PUT  /notifications/read-all      全部已读。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 通知业务类型（与后端 notificationService.NotificationType 对齐） */
export type NotificationType =
  | 'photo_liked'      // 作品收到新点赞
  | 'photo_downloaded' // 作品被下载
  | 'photo_hot'        // 作品被评为热门
  | 'penalty'          // 账号处罚通知
  | 'appeal_approved'  // 申诉通过回执
  | 'appeal_rejected'  // 申诉驳回回执
  | 'photo_recalled'   // 作品被召回重新审核
  | 'forum_reply';     // 论坛帖子收到回复

/** 通知条目（对应 notifications 表行） */
export interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  content: string | null;
  /** 关联对象类型：photo / thread / appeal / penalty，null 表示无跳转 */
  related_type: string | null;
  related_id: string | null;
  /** 1=已读，0=未读 */
  is_read: number;
  created_at: string;
}

/** 通知列表响应（data 为条目数组，分页信息平级返回） */
export interface NotificationListResponse {
  success: boolean;
  data?: NotificationItem[];
  pagination?: { page: number; limit: number; total: number };
  message?: string;
}

/**
 * 分页获取当前用户通知列表
 * @param page 页码（从 1 开始）
 * @param limit 每页条数（默认 20，上限 100）
 */
export async function getNotifications(page = 1, limit = 20): Promise<NotificationListResponse> {
  return request<NotificationItem[]>(`/notifications?page=${page}&limit=${limit}`);
}

/**
 * 获取未读通知数量
 * @returns ApiResponse<{ count: number }>
 */
export async function getUnreadCount(): Promise<ApiResponse<{ count: number }>> {
  return request<{ count: number }>('/notifications/unread-count');
}

/**
 * 标记单条通知为已读（仅限本人通知）
 * @param id 通知 ID
 */
export async function markRead(id: string): Promise<ApiResponse<null>> {
  return request<null>(`/notifications/${id}/read`, { method: 'PUT' });
}

/**
 * 全部标记已读
 * @returns data.changed 为本次标记条数
 */
export async function markAllRead(): Promise<ApiResponse<{ changed: number }>> {
  return request<{ changed: number }>('/notifications/read-all', { method: 'PUT' });
}
