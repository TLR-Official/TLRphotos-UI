/** 论坛 API（V3.1.0） */
import { request } from './client';
import type { ApiResponse } from './client';
import type { Board, Thread, ThreadListResponse, ThreadSort } from '../features/forum/types';

export async function getBoards(): Promise<ApiResponse<Board[]>> {
  return request<Board[]>('/forum/boards');
}

export async function getThreads(params: {
  board_id?: string;
  sort?: ThreadSort;
  page?: number;
  page_size?: number;
}): Promise<ApiResponse<ThreadListResponse>> {
  const qs = new URLSearchParams();
  if (params.board_id) qs.set('board_id', params.board_id);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  return request<ThreadListResponse>(`/forum/threads?${qs.toString()}`);
}

export async function getThread(id: string): Promise<ApiResponse<Thread>> {
  return request<Thread>(`/forum/threads/${id}`);
}

export async function createThread(data: {
  board_id: string;
  title: string;
  content_md: string;
  ref_type?: string;
  ref_id?: string;
}): Promise<ApiResponse<{ id: string }>> {
  return request<{ id: string }>('/forum/threads', { method: 'POST', body: JSON.stringify(data) });
}

export async function likeThread(id: string): Promise<ApiResponse<{ liked: boolean; like_count: number }>> {
  return request(`/forum/threads/${id}/like`, { method: 'POST' });
}

export async function unlikeThread(id: string): Promise<ApiResponse<{ liked: boolean; like_count: number }>> {
  return request(`/forum/threads/${id}/like`, { method: 'DELETE' });
}

export async function deleteThread(id: string): Promise<ApiResponse<void>> {
  return request<void>(`/forum/threads/${id}`, { method: 'DELETE' });
}
