/**
 * @file 通用评论 API（V3.0.0）
 * @description 主题参数化的评论端点封装；第二阶段论坛帖子仅传 subject_type='post'
 *              即可复用全部接口，无需改动本文件。
 *
 *              覆盖：L1 列表（含归档索引）、发表、回复二次加载、
 *              点赞/取消、删除、归档签名 URL 获取。
 */
import { request } from './client';
import type { ApiResponse } from './client';

/** 一期支持的评论主题；扩展联合类型即可支持论坛帖子等新主题 */
export type CommentSubjectType = 'photo' | 'article';

/** 评论主题定位（全部接口的通用参数） */
export interface CommentSubject {
  subjectType: CommentSubjectType;
  subjectId: string;
}

/** 评论 DTO（与后端 comments 行一致） */
export interface CommentDTO {
  id: string;
  subject_type: CommentSubjectType;
  subject_id: string;
  root_id: string;
  parent_id: string | null;
  depth: number;
  user_id: string | null;
  author: string;
  reply_to_user_id: string | null;
  reply_to_user_name: string | null;
  content: string;
  like_count: number;
  created_at: string;
  is_liked?: boolean;
}

/** 线程内回复（点赞态必返） */
export interface ThreadReplyDTO extends CommentDTO {
  is_liked: boolean;
}

/** L1 线程摘要：首批回复 + 截断标记 */
export interface RootCommentSummaryDTO extends CommentDTO {
  is_liked: boolean;
  replies: ThreadReplyDTO[];
  total_reply_count: number;
  has_more_replies: boolean;
}

/** 归档索引行 */
export interface ArchivedThreadIndexDTO {
  root_id: string;
  subject_type: CommentSubjectType;
  subject_id: string;
  oss_key: string;
  archived_at: string;
  root_created_at: string;
  reply_count: number;
  heat_tier: string;
  last_reply_at: string;
  rehydrated_at: string | null;
}

/** L1 列表结果 */
export interface RootCommentListDTO {
  items: RootCommentSummaryDTO[];
  archiveThreads: ArchivedThreadIndexDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 归档线程云负载（与后端 ArchivedThreadPayload 一致） */
export interface ArchivedThreadPayloadDTO {
  formatVersion: number;
  subject: { type: CommentSubjectType; id: string };
  root: { id: string; createdAt: string };
  comments: CommentDTO[];
  likes: Array<{ comment_id: string; user_id: string; created_at: string }>;
  archivedAt: string;
}

export interface ListCommentsOptions {
  page?: number;
  pageSize?: number;
  sort?: 'latest' | 'hottest';
}

/** 编码查询串 */
function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * L1 主评论分页列表（公开读取；登录态由请求层注入，返回 is_liked）。
 */
export function fetchComments(
  subject: CommentSubject,
  options: ListCommentsOptions = {}
): Promise<ApiResponse<RootCommentListDTO>> {
  return request<RootCommentListDTO>(
    `/comments${buildQuery({
      subject_type: subject.subjectType,
      subject_id: subject.subjectId,
      page: options.page,
      page_size: options.pageSize,
      sort: options.sort,
    })}`
  );
}

export interface PublishCommentParams extends CommentSubject {
  content: string;
  /** 被回复评论 id；空表示发表 L1 */
  parentId?: string | null;
  /** 回复归档线程时提供线程 root_id */
  rootId?: string | null;
}

/**
 * 发表主评论或回复（须登录且邮箱确权；后端三级封顶）。
 */
export function publishComment(
  params: PublishCommentParams
): Promise<ApiResponse<CommentDTO>> {
  return request<CommentDTO>('/comments', {
    method: 'POST',
    body: JSON.stringify({
      subject_type: params.subjectType,
      subject_id: params.subjectId,
      parent_id: params.parentId ?? null,
      root_id: params.rootId ?? null,
      content: params.content,
    }),
  });
}

/**
 * 单楼回复二次加载（"查看全部回复"）。
 */
export function fetchThreadReplies(
  rootId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<
  ApiResponse<{
    items: ThreadReplyDTO[];
    total: number;
    limit: number;
    offset: number;
  }>
> {
  return request(
    `/comments/${encodeURIComponent(rootId)}/replies${buildQuery({
      limit: options.limit,
      offset: options.offset,
    })}`
  );
}

/**
 * 点赞 / 取消点赞（幂等）。
 */
export function setCommentLikeApi(
  commentId: string,
  liked: boolean
): Promise<ApiResponse<{ like_count: number; is_liked: boolean }>> {
  return request(`/comments/${encodeURIComponent(commentId)}/like`, {
    method: liked ? 'POST' : 'DELETE',
  });
}

/**
 * 删除评论（本人；高危操作须人机验证状态，403 code=HUMAN_VERIFICATION_REQUIRED）。
 */
export function removeCommentApi(
  commentId: string
): Promise<ApiResponse<{ deletedThread: boolean; removedCount: number }>> {
  return request(`/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
}

/** 归档签名 URL 响应 */
export interface ArchiveReadUrlDTO {
  url: string;
  archived_at: string;
  root_created_at: string;
  reply_count: number;
}

/**
 * 获取归档线程 24h 预签名直读 URL；后端索引不存在时返回 404 ARCHIVE_NOT_FOUND。
 */
export function fetchArchiveReadUrl(
  rootId: string
): Promise<ApiResponse<ArchiveReadUrlDTO>> {
  return request(`/comments/archives/${encodeURIComponent(rootId)}/url`);
}
