/**
 * @file notificationService.ts
 * @description 通知中心服务（V4.0.0）。
 *              提供站内通知的写入、未读计数、分页查询、已读标记与过期清理能力。
 *              通知由业务侧事件驱动产生：点赞/下载/热门确认/处罚/申诉裁决/召回/论坛回复。
 *              一次性过审（approve）不产生通知，仅纠错类动作（recall/hot/appeal/penalty）产生通知。
 */

import crypto from 'crypto';
import { db } from '../db';

/** 通知业务类型白名单 */
export type NotificationType =
  | 'photo_liked' // 作品收到新点赞
  | 'photo_downloaded' // 作品被下载
  | 'photo_hot' // 作品被评为热门
  | 'penalty' // 账号处罚通知
  | 'appeal_approved' // 申诉通过
  | 'appeal_rejected' // 申诉驳回
  | 'photo_recalled' // 作品被召回重新审核
  | 'forum_reply'; // 论坛帖子收到回复

/** 创建通知入参 */
export interface CreateNotificationInput {
  user_id: string;
  type: NotificationType;
  title: string;
  content?: string | null;
  related_type?: string | null;
  related_id?: string | null;
}

/** 通知实体（对应 notifications 表） */
export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  content: string | null;
  related_type: string | null;
  related_id: string | null;
  is_read: number;
  created_at: string;
}

/**
 * 创建一条通知。
 * ID 沿用项目通用做法（crypto.randomUUID），时间戳为 ISO 字符串。
 * @returns 新建通知 ID
 */
export async function createNotification(input: CreateNotificationInput): Promise<string> {
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO notifications (id, user_id, type, title, content, related_type, related_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      input.user_id,
      input.type,
      input.title,
      input.content ?? null,
      input.related_type ?? null,
      input.related_id ?? null,
      new Date().toISOString(),
    ]
  );
  return id;
}

/**
 * 查询用户未读通知数量。
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const row = await db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0',
    userId
  );
  return row?.c ?? 0;
}

/**
 * 分页查询用户通知列表（按创建时间倒序）。
 * @param page 页码（从 1 开始）
 * @param limit 每页条数（1-100，默认 20）
 */
export async function listNotifications(
  userId: string,
  page = 1,
  limit = 20
): Promise<{ items: NotificationRow[]; total: number }> {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const offset = (safePage - 1) * safeLimit;

  const items = (await db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [userId, safeLimit, offset]
  )) as NotificationRow[];
  const totalRow = await db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?',
    userId
  );

  return { items, total: totalRow?.c ?? 0 };
}

/**
 * 标记单条通知为已读（仅限本人通知）。
 * @returns 是否实际更新（false 表示通知不存在或不属于该用户）
 */
export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await db.run(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
  return (result.changes ?? 0) > 0;
}

/**
 * 标记用户全部未读通知为已读。
 * @returns 本次标记的条数
 */
export async function markAllRead(userId: string): Promise<number> {
  const result = await db.run(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
    userId
  );
  return result.changes ?? 0;
}

/**
 * 清理 90 天前的已读通知（server.ts 每日清理任务调用），防止表无限膨胀。
 * 未读通知不清理，避免用户长期未登录时丢失消息。
 * @returns 删除的记录数
 */
export async function cleanupOldNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.run('DELETE FROM notifications WHERE is_read = 1 AND created_at < ?', [
    cutoff,
  ]);
  return result.changes ?? 0;
}
