/**
 * @file commentArchiveStore.ts
 * @description V3.0.0 评论归档存储抽象。归档服务只依赖本接口，
 *              生产实现为 OSS（ossCommentArchiveStore），测试以内存假存储注入，
 *              生命周期逻辑因此不触真实云服务（NFR-4）。
 */
import type { CommentRow } from './commentService';

/** 归档对象中保存的点赞记录（回迁时原样恢复） */
export interface ArchivedLike {
  comment_id: string;
  user_id: string;
  created_at: string;
}

/**
 * 归档线程 JSON 负载。
 * formatVersion 用于未来结构演进；归档对象粒度为每个 L1 线程一个 JSON。
 */
export interface ArchivedThreadPayload {
  /** 负载格式版本（当前 1） */
  formatVersion: 1;
  subject: { type: string; id: string };
  root: { id: string; createdAt: string };
  /** 线程全部评论（含 L1），原样保留 id/作者/时间戳 */
  comments: CommentRow[];
  /** 归档时的点赞关联（回迁恢复） */
  likes: ArchivedLike[];
  archivedAt: string;
}

/** 归档存储接口：put/get/delete/exists */
export interface ICommentArchiveStore {
  /** 写入（覆盖）归档对象，返回字节大小 */
  put(rootId: string, payload: ArchivedThreadPayload): Promise<{ size: number }>;
  /** 读取归档对象；不存在返回 null */
  get(rootId: string): Promise<ArchivedThreadPayload | null>;
  /** 删除归档对象；对象不存在视为成功（幂等） */
  delete(rootId: string): Promise<void>;
  /** 探测对象是否存在与字节大小（上传后校验用） */
  exists(rootId: string): Promise<{ exists: true; size: number } | { exists: false }>;
}

/** OSS 归档 key 前缀 */
export const COMMENT_ARCHIVE_KEY_PREFIX = 'comments-archive/';

/** 线程 root_id → OSS 对象 key */
export function archiveKeyOf(rootId: string): string {
  return `${COMMENT_ARCHIVE_KEY_PREFIX}${rootId}.json`;
}
