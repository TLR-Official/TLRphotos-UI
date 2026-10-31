/** 论坛类型定义（V3.1.0） */

export interface Board {
  id: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  thread_count: number;
}

export interface Thread {
  id: string;
  board_id: string;
  title: string;
  content_md: string;
  author_id: string;
  author_name: string;
  /** V4.7.0：作者称号快照（未获称号为 null） */
  author_title?: string | null;
  status: string;
  is_pinned: number;
  view_count: number;
  like_count: number;
  reply_count: number;
  ref_type: string | null;
  ref_id: string | null;
  last_reply_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadListItem {
  id: string;
  board_id: string;
  title: string;
  author_id: string;
  author_name: string;
  /** V4.7.0：作者称号快照（未获称号为 null） */
  author_title?: string | null;
  is_pinned: number;
  view_count: number;
  like_count: number;
  reply_count: number;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
  last_reply_at: string | null;
}

export interface ThreadListResponse {
  items: ThreadListItem[];
  total: number;
  page: number;
  page_size: number;
}

export type ThreadSort = 'latest' | 'hot';
