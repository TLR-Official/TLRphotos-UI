/**
 * @file commentArchiveService.ts
 * @description V3.0.0 评论归档/回迁领域服务。
 *
 *              归档（FR-7，"先写云并校验、后删本地"）：
 *              选出 retain_until 已到期的非 pinned 线程 → 整线程序列化为版本化 JSON
 *              → 写入存储 → 校验对象存在与大小 → 事务内写归档索引、删本地评论/点赞/heat
 *              并扣减主题计数。任一云步骤失败则本地数据不动。
 *
 *              回迁（FR-10）：
 *              凭归档索引读取 JSON → 结构与主题校验 → 事务内原样写回评论/点赞/heat
 *              （保留 id 与时间戳）、恢复主题计数 → 索引标记 rehydrated_at（索引保留）。
 *
 *              作业锁：归档与回迁共用同一把进程内互斥锁，防重入/并发交叉。
 *              存储后端与时钟均可注入。
 */
import type { Database } from 'sqlite';
import { getFileUrl } from './ossService';
import { heatConfigFromEnv } from './commentHeatService';
import type { CommentRow, CommentSubjectType, CommentArchiveRow } from './commentService';
import { archiveKeyOf } from './commentArchiveStore';
import type {
  ICommentArchiveStore,
  ArchivedThreadPayload,
  ArchivedLike,
} from './commentArchiveStore';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 归档服务错误码 */
export type ArchiveServiceErrorCode =
  | 'ARCHIVE_NOT_FOUND'
  | 'ARCHIVE_PAYLOAD_INVALID'
  | 'ARCHIVE_JOB_LOCKED';

/** 归档服务错误 */
export class ArchiveServiceError extends Error {
  constructor(
    public readonly code: ArchiveServiceErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'ArchiveServiceError';
  }
}

/** 归档作业结果 */
export interface ArchiveJobResult {
  archivedRootIds: string[];
  scanned: number;
}

/**
 * 归档服务。实例持有作业锁；测试可 new 新实例获得干净状态。
 */
export class CommentArchiveService {
  private locked = false;

  /** 当前是否有归档/回迁作业在执行 */
  isLocked(): boolean {
    return this.locked;
  }

  /** 尝试获取作业锁，失败抛 ARCHIVE_JOB_LOCKED */
  private acquire(): void {
    if (this.locked) {
      throw new ArchiveServiceError('ARCHIVE_JOB_LOCKED');
    }
    this.locked = true;
  }

  private release(): void {
    this.locked = false;
  }

  /**
   * 执行每日归档作业。
   *
   * @param database 数据库
   * @param options.now 作业时间（默认系统时钟）
   * @param options.store 归档存储（默认 OSS）
   * @param options.batchLimit 单次扫描上限（默认 200）
   */
  async runArchiveJob(
    database: Database,
    options: { now?: Date; store?: ICommentArchiveStore; batchLimit?: number } = {}
  ): Promise<ArchiveJobResult> {
    const now = options.now ?? new Date();
    const store = options.store ?? (await import('./ossCommentArchiveStore')).ossCommentArchiveStore;
    const batchLimit = options.batchLimit ?? 200;
    this.acquire();

    try {
      const expired = (await database.all(
        `SELECT h.root_id, h.tier AS heat_tier, h.retain_until,
                c.subject_type, c.subject_id, c.created_at
           FROM comment_heat h
           JOIN comments c ON c.id = h.root_id
          WHERE h.pinned = 0 AND h.retain_until <= ?
          LIMIT ?`,
        [now.toISOString(), batchLimit]
      )) as Array<{
        root_id: string;
        heat_tier: string;
        subject_type: CommentSubjectType;
        subject_id: string;
        created_at: string;
      }>;

      const archivedRootIds: string[] = [];

      for (const root of expired) {
        const comments = (await database.all(
          'SELECT * FROM comments WHERE root_id = ? ORDER BY created_at ASC',
          [root.root_id]
        )) as CommentRow[];

        const likes = (await database.all(
          `SELECT cl.comment_id, cl.user_id, cl.created_at
             FROM comment_likes cl
             JOIN comments c ON c.id = cl.comment_id
            WHERE c.root_id = ?`,
          [root.root_id]
        )) as ArchivedLike[];

        const payload: ArchivedThreadPayload = {
          formatVersion: 1,
          subject: { type: root.subject_type, id: root.subject_id },
          root: { id: root.root_id, createdAt: root.created_at },
          comments,
          likes,
          archivedAt: now.toISOString(),
        };

        // 先写云 → 校验存在与大小；任一步失败本线程本地数据不动
        const uploaded = await store.put(root.root_id, payload);
        const probe = await store.exists(root.root_id);
        if (!probe.exists || probe.size !== uploaded.size) {
          throw new ArchiveServiceError(
            'ARCHIVE_PAYLOAD_INVALID',
            `归档对象校验失败: ${root.root_id}`
          );
        }

        const lastReplyAt = comments[comments.length - 1].created_at;
        const idSet = comments.map((c) => c.id);
        const placeholders = idSet.map(() => '?').join(',');

        // 事务：写索引 → 删点赞/评论/heat → 扣减主题计数
        await database.exec('BEGIN');
        try {
          await database.run(
            `INSERT INTO comment_archives
               (root_id, subject_type, subject_id, oss_key, archived_at, root_created_at,
                reply_count, heat_tier, last_reply_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(root_id) DO UPDATE SET
               oss_key = excluded.oss_key,
               archived_at = excluded.archived_at,
               reply_count = excluded.reply_count,
               heat_tier = excluded.heat_tier,
               last_reply_at = excluded.last_reply_at,
               rehydrated_at = NULL`,
            [
              root.root_id,
              root.subject_type,
              root.subject_id,
              archiveKeyOf(root.root_id),
              now.toISOString(),
              root.created_at,
              comments.length - 1,
              root.heat_tier,
              lastReplyAt,
            ]
          );
          await database.run(
            `DELETE FROM comment_likes WHERE comment_id IN (${placeholders})`,
            idSet
          );
          await database.run('DELETE FROM comments WHERE root_id = ?', [root.root_id]);
          await database.run('DELETE FROM comment_heat WHERE root_id = ?', [root.root_id]);

          const subjectTable = root.subject_type === 'photo' ? 'photos' : 'articles';
          await database.run(
            `UPDATE ${subjectTable}
               SET comment_count = MAX(0, comment_count - ?)
             WHERE id = ?`,
            [comments.length, root.subject_id]
          );
          await database.exec('COMMIT');
        } catch (txError) {
          await database.exec('ROLLBACK');
          throw txError;
        }

        archivedRootIds.push(root.root_id);
        console.log(
          `[CommentArchive] 线程已归档: root=${root.root_id}, 评论=${comments.length}, 主题=${root.subject_type}:${root.subject_id}`
        );
      }

      return { archivedRootIds, scanned: expired.length };
    } finally {
      this.release();
    }
  }

  /**
   * 回迁归档线程（FR-10）。已在本地时直接返回（幂等）。
   *
   * @param database 数据库
   * @param rootId 线程 root_id
   * @param options.now 回迁时间
   * @param options.store 归档存储（默认 OSS）
   */
  async rehydrateThread(
    database: Database,
    rootId: string,
    options: { now?: Date; store?: ICommentArchiveStore } = {}
  ): Promise<void> {
    const now = options.now ?? new Date();
    const store = options.store ?? (await import('./ossCommentArchiveStore')).ossCommentArchiveStore;
    this.acquire();

    try {
      const index = (await database.get('SELECT * FROM comment_archives WHERE root_id = ?', [
        rootId,
      ])) as CommentArchiveRow | undefined;
      if (!index) {
        throw new ArchiveServiceError('ARCHIVE_NOT_FOUND');
      }

      // 幂等：heat 行已在本地说明线程活跃，无需回迁
      const existingHeat = await database.get(
        'SELECT root_id FROM comment_heat WHERE root_id = ?',
        [rootId]
      );
      if (existingHeat) {
        console.log(`[CommentArchive] 线程已在本地，跳回迁: root=${rootId}`);
        return;
      }

      const payload = await store.get(rootId);
      if (!payload) {
        throw new ArchiveServiceError('ARCHIVE_PAYLOAD_INVALID', `归档对象缺失: ${rootId}`);
      }

      this.validatePayload(payload, index);

      const retainDays = heatConfigFromEnv().retainDays;
      const replyCount = payload.comments.length - 1;
      const likeCount = payload.likes.length;

      await database.exec('BEGIN');
      try {
        for (const comment of payload.comments) {
          await database.run(
            `INSERT OR IGNORE INTO comments
               (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
                reply_to_user_id, reply_to_user_name, content, like_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              comment.id,
              comment.subject_type,
              comment.subject_id,
              comment.root_id,
              comment.parent_id,
              comment.depth,
              comment.user_id,
              comment.author,
              comment.reply_to_user_id,
              comment.reply_to_user_name,
              comment.content,
              comment.like_count,
              comment.created_at,
            ]
          );
        }
        for (const like of payload.likes) {
          await database.run(
            'INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)',
            [like.comment_id, like.user_id, like.created_at]
          );
        }

        // heat 重建：恢复计数，retain_until 从回迁时刻重新起算（后续回复会再触发重算）
        await database.run(
          `INSERT OR IGNORE INTO comment_heat
             (root_id, reply_count, like_count, score, velocity, tier, last_calc_at,
              retain_until, pinned)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)`,
          [
            rootId,
            replyCount,
            likeCount,
            replyCount * 2 + likeCount,
            index.heat_tier,
            now.toISOString(),
            new Date(now.getTime() + retainDays * DAY_MS).toISOString(),
          ]
        );

        // 恢复主题计数
        const subjectTable = index.subject_type === 'photo' ? 'photos' : 'articles';
        await database.run(
          `UPDATE ${subjectTable} SET comment_count = comment_count + ? WHERE id = ?`,
          [payload.comments.length, index.subject_id]
        );

        await database.run('UPDATE comment_archives SET rehydrated_at = ? WHERE root_id = ?', [
          now.toISOString(),
          rootId,
        ]);
        await database.exec('COMMIT');
      } catch (txError) {
        await database.exec('ROLLBACK');
        throw txError;
      }

      console.log(
        `[CommentArchive] 线程已回迁: root=${rootId}, 评论=${payload.comments.length}, 点赞=${payload.likes.length}`
      );
    } finally {
      this.release();
    }
  }

  /** 校验归档负载：版本、主题一致性、root 唯一性、depth/root 字段合法 */
  private validatePayload(payload: ArchivedThreadPayload, index: CommentArchiveRow): void {
    const invalid = (reason: string) =>
      new ArchiveServiceError('ARCHIVE_PAYLOAD_INVALID', reason);

    if (payload.formatVersion !== 1) {
      throw invalid(`不支持的格式版本: ${String(payload.formatVersion)}`);
    }
    if (payload.subject.type !== index.subject_type || payload.subject.id !== index.subject_id) {
      throw invalid('负载主题与归档索引不一致');
    }
    if (payload.root.id !== index.root_id) {
      throw invalid('负载 root 与索引不一致');
    }
    if (payload.comments.length === 0) {
      throw invalid('负载不含评论');
    }

    let l1Count = 0;
    for (const comment of payload.comments) {
      if (comment.root_id !== index.root_id) throw invalid('存在跨线程评论');
      if (comment.subject_type !== index.subject_type || comment.subject_id !== index.subject_id) {
        throw invalid('评论主题与索引不一致');
      }
      if (comment.depth < 1 || comment.depth > 3) throw invalid('存在非法 depth');
      if (comment.depth === 1) {
        l1Count += 1;
        if (comment.id !== index.root_id || comment.parent_id !== null) {
          throw invalid('L1 节点不合法');
        }
      }
    }
    if (l1Count !== 1) {
      throw invalid(`L1 节点数量异常: ${l1Count}`);
    }
  }

  /**
   * 获取归档线程的预签名直读 URL（24h 有效）。
   * 归档索引不存在时返回 null（路由映射 404）。
   */
  async getArchiveReadUrl(
    database: Database,
    rootId: string
  ): Promise<{ url: string; archive: CommentArchiveRow } | null> {
    const archive = (await database.get(
      'SELECT * FROM comment_archives WHERE root_id = ?',
      [rootId]
    )) as CommentArchiveRow | undefined;
    if (!archive) return null;
    const url = await getFileUrl(archive.oss_key);
    return { url, archive };
  }
}

/** 归档服务单例：server.ts 与评论服务网关共用 */
export const commentArchiveService = new CommentArchiveService();
