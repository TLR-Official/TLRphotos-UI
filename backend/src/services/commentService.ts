/**
 * @file commentService.ts
 * @description V3.0.0 通用评论领域服务：评论主题参数化（photo/article），
 *              论坛第二阶段的帖子主题可零改动复用。
 *
 *              职责：
 *              1. 主题存在性校验（FR-1）；
 *              2. 发表：服务端计算 root/depth/reply_to，严格三级封顶
 *                 （对 depth=3 再回复时 depth 仍为 3，永不产生 depth=4）；
 *              3. 读取：L1 分页（默认 20，最新/最热），每楼回复默认携带、
 *                 上限 100 条，超出经 listThreadReplies 二次加载；归档线程以索引返回；
 *              4. 点赞：联合主键去重、幂等，联动 like_count 与热度重算；
 *              5. 删除：本人或管理员，L1 整楼、L2/L3 单条；
 *                 旧迁移评论（user_id 为空）仅管理员可删；归档楼联动删除云对象。
 *              归档/回迁通过网关接口注入，避免与归档服务产生循环依赖。
 */
import crypto from 'crypto';
import type { Database } from 'sqlite';
import { recalculateThreadHeat, type HeatConfig } from './commentHeatService';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 评论内容上限（FR-4：≤1000 字） */
export const MAX_COMMENT_CONTENT_LENGTH = 1000;
/** L1 列表默认每页条数 */
export const DEFAULT_COMMENT_PAGE_SIZE = 20;
/** 单楼随 L1 携带回复的上限，超出二次加载 */
export const THREAD_REPLY_LIMIT = 100;

/** 一期支持的评论主题；第二阶段扩展 'post' 等即可复用全部模块 */
export type CommentSubjectType = 'photo' | 'article' | 'thread';

/** 评论行（与 comments 表结构一致） */
export interface CommentRow {
  id: string;
  subject_type: CommentSubjectType;
  subject_id: string;
  root_id: string;
  parent_id: string | null;
  depth: number;
  user_id: string | null;
  author: string;
  /** V4.7.0：写入时固化的作者称号快照（无称号为 NULL） */
  author_title: string | null;
  reply_to_user_id: string | null;
  reply_to_user_name: string | null;
  /** V4.7.0：被回复者称号快照（L3 互回展示） */
  reply_to_user_title: string | null;
  content: string;
  like_count: number;
  created_at: string;
}

/** 评论领域错误码（路由层据此映射 HTTP 状态） */
export type CommentErrorCode =
  | 'COMMENT_CONTENT_EMPTY' // 400
  | 'COMMENT_CONTENT_TOO_LONG' // 400
  | 'PARENT_SUBJECT_MISMATCH' // 400
  | 'SUBJECT_NOT_FOUND' // 404
  | 'PARENT_NOT_FOUND' // 404
  | 'COMMENT_NOT_FOUND' // 404
  | 'COMMENT_DELETE_FORBIDDEN'; // 403

/** 评论领域错误：携带稳定错误码 */
export class CommentServiceError extends Error {
  constructor(
    public readonly code: CommentErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'CommentServiceError';
  }
}

/** 发表评论的操作人（路由已保证登录 + 邮箱确权） */
export interface CommentActor {
  userId: string;
  /** 展示名（username），写入 author 文本 */
  author: string;
  /** V4.7.0：作者称号，写入 author_title 快照（无称号为 null） */
  authorTitle?: string | null;
}

/** 删除操作人：管理员标识决定越权删除能力 */
export interface CommentDeleteActor {
  userId: string;
  isAdmin: boolean;
}

/** 归档云对象删除网关（Task 4 提供 OSS 实现） */
export interface CommentArchiveGateway {
  /** 删除归档对象；对象不存在视为成功（幂等）。索引行由本服务删除 */
  deleteArchivedObject(rootId: string): Promise<void>;
  /**
   * 读取归档线程楼主归属（删除前所有权校验）；不存在返回 null。
   * rootUserId 为 null（旧迁移评论）时仅管理员可删。
   */
  readArchivedThreadOwner?(
    rootId: string
  ): Promise<{ rootUserId: string | null } | null>;
}

/** 归档线程回迁网关（Task 4 提供 OSS 实现，FR-10） */
export interface CommentRehydrateGateway {
  /** 凭 comment_archives 索引拉取云 JSON、校验后原样写回本地并标记 rehydrated_at */
  rehydrateThread(rootId: string): Promise<void>;
}

/** 校验主题存在；不存在抛 SUBJECT_NOT_FOUND */
async function assertSubjectExists(
  database: Database,
  subjectType: CommentSubjectType,
  subjectId: string
): Promise<void> {
  const table = subjectType === 'photo' ? 'photos' : subjectType === 'thread' ? 'forum_threads' : 'articles';
  const row = await database.get(`SELECT id FROM ${table} WHERE id = ?`, [subjectId]);
  if (!row) {
    throw new CommentServiceError('SUBJECT_NOT_FOUND');
  }
}

/** 读取评论行；不存在抛 COMMENT_NOT_FOUND */
async function getCommentOrThrow(
  database: Database,
  commentId: string
): Promise<CommentRow> {
  const row = (await database.get('SELECT * FROM comments WHERE id = ?', [
    commentId,
  ])) as CommentRow | undefined;
  if (!row) {
    throw new CommentServiceError('COMMENT_NOT_FOUND');
  }
  return row;
}

/** 发表参数 */
export interface CreateCommentParams {
  subjectType: CommentSubjectType;
  subjectId: string;
  /** 被回复评论 id；空表示发表 L1 主评论 */
  parentId?: string | null;
  /** 回复归档线程时由客户端提供的线程 root_id（活跃线程无需提供） */
  rootId?: string | null;
  content: string;
}

/** 发表选项：时钟/热度配置/回迁网关可注入 */
export interface CreateCommentOptions {
  now?: Date;
  heatConfig?: HeatConfig;
  rehydrateGateway?: CommentRehydrateGateway;
}

/**
 * 发表评论或回复。
 * 全部写操作（评论行、主题计数、heat）在一个事务内完成；
 * 归档线程回复先经回迁网关回迁，再按常规回复追加。
 *
 * @returns 新建评论行
 */
export async function createComment(
  database: Database,
  params: CreateCommentParams,
  actor: CommentActor,
  options: CreateCommentOptions = {}
): Promise<CommentRow> {
  const now = options.now ?? new Date();
  const content = params.content.trim();
  if (content.length === 0) {
    throw new CommentServiceError('COMMENT_CONTENT_EMPTY');
  }
  if (content.length > MAX_COMMENT_CONTENT_LENGTH) {
    throw new CommentServiceError('COMMENT_CONTENT_TOO_LONG');
  }

  await assertSubjectExists(database, params.subjectType, params.subjectId);

  const newId = crypto.randomUUID();
  let rootId: string;
  let parentId: string | null = null;
  let depth: number;
  let replyToUserId: string | null = null;
  let replyToUserName: string | null = null;
  let replyToUserTitle: string | null = null;

  if (!params.parentId) {
    // L1：root 为自身
    rootId = newId;
    depth = 1;
  } else {
    parentId = params.parentId;
    let parent = (await database.get('SELECT * FROM comments WHERE id = ?', [
      parentId,
    ])) as CommentRow | undefined;

    // 本地找不到父评论：可能是已归档线程，经回迁网关恢复后重试
    if (!parent) {
      const archiveRootId = params.rootId ?? params.parentId;
      const archiveIndex = (await database.get(
        'SELECT root_id FROM comment_archives WHERE root_id = ?',
        [archiveRootId]
      )) as { root_id: string } | undefined;
      if (archiveIndex && options.rehydrateGateway) {
        await options.rehydrateGateway.rehydrateThread(archiveRootId);
        parent = (await database.get('SELECT * FROM comments WHERE id = ?', [
          parentId,
        ])) as CommentRow | undefined;
      }
      if (!parent) {
        throw new CommentServiceError('PARENT_NOT_FOUND');
      }
    }

    // 跨主题/跨线程 parent 拒绝
    if (
      parent.subject_type !== params.subjectType ||
      parent.subject_id !== params.subjectId
    ) {
      throw new CommentServiceError('PARENT_SUBJECT_MISMATCH');
    }

    rootId = parent.root_id;
    // 三级封顶：parent depth 1 → 2；parent depth 2 → 3；parent depth 3 → 仍为 3
    depth = Math.min(parent.depth + 1, 3);
    // reply_to 仅用于 L3 互回的"回复@用户"展示
    if (depth === 3) {
      replyToUserId = parent.user_id;
      replyToUserName = parent.author;
      // V4.7.0：快照被回复者称号（父评论已固化，归档回迁后同样可用）
      replyToUserTitle = parent.author_title ?? null;
    }
  }

  const createdAtIso = now.toISOString();

  await database.exec('BEGIN');
  try {
    await database.run(
      `INSERT INTO comments
         (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
          author_title, reply_to_user_id, reply_to_user_name, reply_to_user_title,
          content, like_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        newId,
        params.subjectType,
        params.subjectId,
        rootId,
        parentId,
        depth,
        actor.userId,
        actor.author,
        actor.authorTitle ?? null,
        replyToUserId,
        replyToUserName,
        replyToUserTitle,
        content,
        createdAtIso,
      ]
    );

    // 主题评论计数 +1（thread 额外同步 reply_count 与 last_reply_at）
    if (params.subjectType === 'thread') {
      await database.run(
        `UPDATE forum_threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?`,
        [createdAtIso, params.subjectId]
      );
    } else {
      const subjectTable = params.subjectType === 'photo' ? 'photos' : 'articles';
      await database.run(
        `UPDATE ${subjectTable} SET comment_count = comment_count + 1 WHERE id = ?`,
        [params.subjectId]
      );
    }

    if (depth === 1) {
      // 新线程初始化 heat：normal 档，retain_until = 发布 + 基础保留天数
      const retainDays =
        options.heatConfig?.retainDays ?? (Number(process.env.COMMENT_RETAIN_DAYS) || 10);
      await database.run(
        `INSERT INTO comment_heat
           (root_id, reply_count, like_count, score, velocity, tier, last_calc_at, retain_until, pinned)
         VALUES (?, 0, 0, 0, 0, 'normal', ?, ?, 0)`,
        [newId, createdAtIso, new Date(now.getTime() + retainDays * DAY_MS).toISOString()]
      );
    }
    await database.exec('COMMIT');
  } catch (txError) {
    await database.exec('ROLLBACK');
    throw txError;
  }

  // 回复的热度重算放在事务外（recalculateThreadHeat 自身做聚合 + upsert，
  // 语义为读已提交数据，失败不影响评论发布成功）
  if (depth > 1) {
    await recalculateThreadHeat(database, rootId, {
      now,
      config: options.heatConfig,
    });
  }

  return getCommentOrThrow(database, newId);
}

/** 线程内单条评论（携带点赞态） */
export interface ThreadReply extends CommentRow {
  is_liked: boolean;
}

/** L1 线程摘要：携带首批回复与截断标记 */
export interface RootCommentSummary extends CommentRow {
  is_liked: boolean;
  replies: ThreadReply[];
  total_reply_count: number;
  has_more_replies: boolean;
}

/** 归档索引行（comment_archives 表） */
export interface CommentArchiveRow {
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
export interface RootCommentList {
  items: RootCommentSummary[];
  /** 已归档线程索引（本地无评论行），前端展示 ArchiveBanner */
  archiveThreads: CommentArchiveRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 列表参数 */
export interface ListCommentsParams {
  subjectType: CommentSubjectType;
  subjectId: string;
  page?: number;
  pageSize?: number;
  sort?: 'latest' | 'hottest';
}

/** 批量附加当前用户的点赞态 */
async function attachLikeState<T extends { id: string }>(
  database: Database,
  rows: T[],
  viewerId: string | null
): Promise<(T & { is_liked: boolean })[]> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, is_liked: false }));
  const liked = new Set<string>();
  if (viewerId) {
    const placeholders = rows.map(() => '?').join(',');
    const likes = (await database.all(
      `SELECT comment_id FROM comment_likes
        WHERE user_id = ? AND comment_id IN (${placeholders})`,
      [viewerId, ...rows.map((r) => r.id)]
    )) as Array<{ comment_id: string }>;
    for (const l of likes) liked.add(l.comment_id);
  }
  return rows.map((r) => ({ ...r, is_liked: liked.has(r.id) }));
}

/**
 * L1 分页列表（活跃线程）+ 归档索引。
 * 每个 L1 携带前 THREAD_REPLY_LIMIT 条回复（按时间正序）；
 * 超出时 has_more_replies=true，由 listThreadReplies 二次加载。
 */
export async function listRootComments(
  database: Database,
  params: ListCommentsParams,
  viewerId: string | null = null
): Promise<RootCommentList> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_COMMENT_PAGE_SIZE;
  const sort = params.sort ?? 'latest';
  const offset = (page - 1) * pageSize;

  const orderSql =
    sort === 'hottest'
      ? 'heat_score DESC, c.created_at DESC'
      : 'c.created_at DESC';

  const countRow = (await database.get(
    'SELECT COUNT(*) AS c FROM comments WHERE subject_type = ? AND subject_id = ? AND depth = 1',
    [params.subjectType, params.subjectId]
  )) as { c: number };
  const total = countRow.c;

  const roots = (await database.all(
    `SELECT c.*, COALESCE(h.score, 0) AS heat_score
       FROM comments c
       LEFT JOIN comment_heat h ON h.root_id = c.id
      WHERE c.subject_type = ? AND c.subject_id = ? AND c.depth = 1
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?`,
    [params.subjectType, params.subjectId, pageSize, offset]
  )) as Array<CommentRow>;

  const archiveThreads = (await database.all(
    'SELECT * FROM comment_archives WHERE subject_type = ? AND subject_id = ? ORDER BY archived_at DESC',
    [params.subjectType, params.subjectId]
  )) as CommentArchiveRow[];

  const items: RootCommentSummary[] = [];
  for (const root of roots) {
    const totalReplyRow = (await database.get(
      'SELECT COUNT(*) AS c FROM comments WHERE root_id = ? AND depth > 1',
      [root.id]
    )) as { c: number };

    // 多取 1 条探测是否超限
    const replyRows = (await database.all(
      `SELECT * FROM comments
        WHERE root_id = ? AND depth > 1
        ORDER BY created_at ASC
        LIMIT ?`,
      [root.id, THREAD_REPLY_LIMIT + 1]
    )) as CommentRow[];

    const hasMoreReplies = replyRows.length > THREAD_REPLY_LIMIT;
    const visibleReplies = hasMoreReplies ? replyRows.slice(0, THREAD_REPLY_LIMIT) : replyRows;
    const repliesWithLike = await attachLikeState(database, visibleReplies, viewerId);

    const rootsWithLike = await attachLikeState(database, [root], viewerId);
    items.push({
      ...rootsWithLike[0],
      replies: repliesWithLike,
      total_reply_count: totalReplyRow.c,
      has_more_replies: hasMoreReplies,
    });
  }

  return {
    items,
    archiveThreads,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** 二次加载参数 */
export interface ListRepliesParams {
  limit?: number;
  offset?: number;
}

/** 二次加载结果 */
export interface ListRepliesResult {
  items: ThreadReply[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * 单楼回复二次加载（"查看全部 n 条回复"）。
 * 线程已归档（本地无 L1）时抛 COMMENT_NOT_FOUND，由路由引导走归档读取。
 */
export async function listThreadReplies(
  database: Database,
  rootId: string,
  params: ListRepliesParams = {},
  viewerId: string | null = null
): Promise<ListRepliesResult> {
  const root = (await database.get(
    'SELECT id FROM comments WHERE id = ? AND depth = 1',
    [rootId]
  )) as { id: string } | undefined;
  if (!root) {
    throw new CommentServiceError('COMMENT_NOT_FOUND');
  }

  const limit = params.limit ?? THREAD_REPLY_LIMIT;
  const sqlOffset = Math.max(0, params.offset ?? 0);

  const totalRow = (await database.get(
    'SELECT COUNT(*) AS c FROM comments WHERE root_id = ? AND depth > 1',
    [rootId]
  )) as { c: number };
  const rows = (await database.all(
    `SELECT * FROM comments
      WHERE root_id = ? AND depth > 1
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?`,
    [rootId, limit, sqlOffset]
  )) as CommentRow[];
  const items = await attachLikeState(database, rows, viewerId);

  return { items, total: totalRow.c, limit, offset: sqlOffset };
}

/**
 * 点赞 / 取消点赞（幂等）。
 * 点赞：INSERT OR IGNORE，实际新增时 like_count+1；
 * 取消：DELETE，实际删除时 like_count-1（不出现负数）。
 * 计数写操作在事务内，提交后触发热度重算。
 *
 * @returns 评论最新 like_count 与当前用户点赞态
 */
export async function setCommentLike(
  database: Database,
  commentId: string,
  userId: string,
  liked: boolean,
  options: { now?: Date; heatConfig?: HeatConfig } = {}
): Promise<{ likeCount: number; isLiked: boolean }> {
  const now = options.now ?? new Date();
  const comment = await getCommentOrThrow(database, commentId);
  let changed = false;

  await database.exec('BEGIN');
  try {
    if (liked) {
      const insertResult = await database.run(
        'INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)',
        [commentId, userId, now.toISOString()]
      );
      changed = (insertResult.changes ?? 0) > 0;
      if (changed) {
        await database.run(
          'UPDATE comments SET like_count = like_count + 1 WHERE id = ?',
          [commentId]
        );
      }
    } else {
      const result = await database.run(
        'DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?',
        [commentId, userId]
      );
      changed = (result.changes ?? 0) > 0;
      if (changed) {
        await database.run(
          'UPDATE comments SET like_count = MAX(0, like_count - 1) WHERE id = ?',
          [commentId]
        );
      }
    }
    await database.exec('COMMIT');
  } catch (txError) {
    await database.exec('ROLLBACK');
    throw txError;
  }

  if (changed) {
    await recalculateThreadHeat(database, comment.root_id, {
      now,
      config: options.heatConfig,
    });
  }

  const updated = await getCommentOrThrow(database, commentId);
  return { likeCount: updated.like_count, isLiked: liked };
}

/** 删除结果 */
export interface DeleteCommentResult {
  /** 是否为整楼删除 */
  deletedThread: boolean;
  /** 删除的评论条数 */
  removedCount: number;
}

/** 删除选项：归档云对象删除网关可注入 */
export interface DeleteCommentOptions {
  archiveGateway?: CommentArchiveGateway;
}

/**
 * 删除评论（FR-11）：
 * - L1：整楼删除（评论行、点赞、heat），归档楼先删云对象再删索引；
 * - L2/L3：仅删该条与其点赞（子评论成为树算法中的孤儿，仍在线程内展示）。
 * 权限：管理员放行；user_id 为空的旧迁移评论仅管理员；其余须本人。
 */
export async function deleteComment(
  database: Database,
  commentId: string,
  actor: CommentDeleteActor,
  options: DeleteCommentOptions = {}
): Promise<DeleteCommentResult> {
  let comment: CommentRow;
  try {
    comment = await getCommentOrThrow(database, commentId);
  } catch (error) {
    if (
      !(error instanceof CommentServiceError) ||
      error.code !== 'COMMENT_NOT_FOUND'
    ) {
      throw error;
    }
    // 本地无评论行：尝试按"已归档 L1 整楼删除"处理（FR-11）
    const archived = (await database.get(
      'SELECT * FROM comment_archives WHERE root_id = ?',
      [commentId]
    )) as CommentArchiveRow | undefined;
    if (!archived) throw error;
    if (!options.archiveGateway) {
      throw new CommentServiceError('COMMENT_DELETE_FORBIDDEN');
    }
    // 所有权校验（F-1）：读取归档负载楼主身份，非本人且非管理员一律拒绝；
    // user_id 为 null 的旧迁移归档楼仅管理员可删
    let owner: { rootUserId: string | null } | null = null;
    if (options.archiveGateway.readArchivedThreadOwner) {
      owner = await options.archiveGateway.readArchivedThreadOwner(archived.root_id);
    }
    const isOwner = owner !== null && owner.rootUserId !== null && owner.rootUserId === actor.userId;
    if (!actor.isAdmin && !isOwner) {
      throw new CommentServiceError('COMMENT_DELETE_FORBIDDEN');
    }
    // 先删云对象（失败中止，索引保留），再删索引；主题计数在归档时已扣减
    await options.archiveGateway.deleteArchivedObject(archived.root_id);
    await database.run('DELETE FROM comment_archives WHERE root_id = ?', [archived.root_id]);
    console.log(`[CommentService] 归档线程已删除: root=${archived.root_id}`);
    return { deletedThread: true, removedCount: archived.reply_count + 1 };
  }

  const isOwner = comment.user_id !== null && comment.user_id === actor.userId;
  if (!actor.isAdmin && !isOwner) {
    throw new CommentServiceError('COMMENT_DELETE_FORBIDDEN');
  }

  if (comment.depth === 1) {
    // 归档楼：先删云对象（失败则整体中止，本地数据保留）
    const archiveIndex = (await database.get(
      'SELECT root_id FROM comment_archives WHERE root_id = ?',
      [comment.root_id]
    )) as { root_id: string } | undefined;
    if (archiveIndex) {
      if (!options.archiveGateway) {
        throw new CommentServiceError('COMMENT_DELETE_FORBIDDEN');
      }
      await options.archiveGateway.deleteArchivedObject(comment.root_id);
    }

    const threadIds = (await database.all('SELECT id FROM comments WHERE root_id = ?', [
      comment.root_id,
    ])) as Array<{ id: string }>;
    const removedCount = threadIds.length;

    await database.exec('BEGIN');
    try {
      const placeholders = threadIds.map(() => '?').join(',');
      await database.run(
        `DELETE FROM comment_likes WHERE comment_id IN (${placeholders})`,
        threadIds.map((t) => t.id)
      );
      await database.run('DELETE FROM comments WHERE root_id = ?', [comment.root_id]);
      await database.run('DELETE FROM comment_heat WHERE root_id = ?', [comment.root_id]);
      if (archiveIndex) {
        await database.run('DELETE FROM comment_archives WHERE root_id = ?', [comment.root_id]);
      }
      // 主题计数减去整楼条数（不产生负数）
      if (comment.subject_type === 'thread') {
        await database.run(
          `UPDATE forum_threads SET reply_count = 0, last_reply_at = NULL WHERE id = ?`,
          [comment.subject_id]
        );
      } else {
        const subjectTable = comment.subject_type === 'photo' ? 'photos' : 'articles';
        await database.run(
          `UPDATE ${subjectTable} SET comment_count = MAX(0, comment_count - ?) WHERE id = ?`,
          [removedCount, comment.subject_id]
        );
      }
      await database.exec('COMMIT');
    } catch (txError) {
      await database.exec('ROLLBACK');
      throw txError;
    }

    return { deletedThread: true, removedCount };
  }

  // L2/L3：单条删除
  await database.exec('BEGIN');
  try {
    await database.run('DELETE FROM comment_likes WHERE comment_id = ?', [commentId]);
    await database.run('DELETE FROM comments WHERE id = ?', [commentId]);
    if (comment.subject_type === 'thread') {
      await database.run(
        `UPDATE forum_threads SET reply_count = MAX(0, reply_count - 1), last_reply_at = (SELECT MAX(created_at) FROM comments WHERE subject_type='thread' AND subject_id=?) WHERE id = ?`,
        [comment.subject_id, comment.subject_id]
      );
    } else {
      const subjectTable = comment.subject_type === 'photo' ? 'photos' : 'articles';
      await database.run(
        `UPDATE ${subjectTable} SET comment_count = MAX(0, comment_count - 1) WHERE id = ?`,
        [comment.subject_id]
      );
    }
    await database.exec('COMMIT');
  } catch (txError) {
    await database.exec('ROLLBACK');
    throw txError;
  }

  await recalculateThreadHeat(database, comment.root_id);
  return { deletedThread: false, removedCount: 1 };
}
