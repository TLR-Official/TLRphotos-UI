/**
 * @file 用户侧申诉 API（V4.0.0）
 * @description
 *  封装用户对被驳回照片的申诉接口：
 *   1. POST   /photos/:id/appeal  发起申诉（仅所有者、仅 rejected、reason 必填；重复发起 409 APPEAL_IN_PROGRESS）。
 *   2. GET    /my-appeals         本人申诉列表（联照片标题与当前照片状态）。
 *   3. DELETE /my-appeals/:id     撤回待处理申诉（仅 pending 可撤，撤回后可重新发起）。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 申诉状态（与后端 appeals 表一致） */
export type AppealStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** 申诉条目（GET /my-appeals 返回行） */
export interface MyAppeal {
  id: string;
  photo_id: string;
  /** 申诉理由 */
  reason: string;
  status: AppealStatus;
  /** 管理员裁决答复（未裁决为 null） */
  response: string | null;
  decided_at: string | null;
  created_at: string;
  /** 联表字段：照片标题（照片已删除时为 null） */
  photo_title: string | null;
  /** 联表字段：照片当前状态 */
  photo_status: string | null;
}

/**
 * 对被驳回的照片发起申诉（需登录）
 * @param photoId 照片 ID
 * @param reason 申诉理由（必填）
 * @returns 201 时 data.appeal_id 为新申诉 ID；409 code=APPEAL_IN_PROGRESS 表示已有待处理申诉
 */
export async function createAppeal(
  photoId: string,
  reason: string
): Promise<ApiResponse<{ appeal_id: string }>> {
  return request<{ appeal_id: string }>(`/photos/${photoId}/appeal`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * 获取本人申诉记录列表（按创建时间倒序）
 */
export async function getMyAppeals(): Promise<ApiResponse<MyAppeal[]>> {
  return request<MyAppeal[]>('/my-appeals');
}

/**
 * 撤回本人待处理的申诉（仅 pending 可撤回）
 * @param appealId 申诉 ID
 */
export async function withdrawAppeal(appealId: string): Promise<ApiResponse<null>> {
  return request<null>(`/my-appeals/${appealId}`, { method: 'DELETE' });
}
