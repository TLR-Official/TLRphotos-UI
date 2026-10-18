/**
 * @file forum.ts（V3.1.0）
 * @description 论坛公开路由：板块列表、帖子流、帖子详情、发帖、点赞、删除。
 *              帖子即 subject_type='thread' 的评论主题，评论区由通用 /api/comments 承载。
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail';
import { loadAuthUser } from '../services/authService';
import { ensureHumanVerified } from '../services/verificationService';
import { deleteFromOSS } from '../services/ossService';
import { checkPenaltyCap } from '../services/penaltyService';

const router = express.Router();
const CLIENT_IP_HEADER = 'x-forwarded-for';

function getClientIp(req: express.Request): string {
  const xff = req.headers[CLIENT_IP_HEADER];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** 获取板块列表（仅启用） */
router.get('/boards', async (_req, res) => {
  try {
    const boards = await db.all(
      'SELECT id, name, description, icon, sort_order, thread_count FROM forum_boards WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    res.json({ success: true, data: boards });
  } catch (e) {
    console.error('[Forum] boards error:', e);
    res.status(500).json({ success: false, message: '获取板块列表失败' });
  }
});

/** 帖子流（支持板块筛选、排序、分页） */
router.get('/threads', async (req, res) => {
  try {
    const boardId = typeof req.query.board_id === 'string' ? req.query.board_id : null;
    const sort = req.query.sort === 'hot' ? 'hot' : 'latest';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.page_size as string) || 20));
    const offset = (page - 1) * pageSize;

    const where = boardId ? 'WHERE board_id = ? AND status = \'published\'' : 'WHERE status = \'published\'';
    const params: any[] = boardId ? [boardId] : [];

    const orderBy = sort === 'hot'
      ? 'is_pinned DESC, (reply_count + like_count) DESC, last_reply_at DESC'
      : 'is_pinned DESC, COALESCE(last_reply_at, created_at) DESC';

    const threads = await db.all(
      `SELECT id, board_id, title, author_id, author_name, is_pinned, view_count, like_count, reply_count, ref_type, ref_id, created_at, last_reply_at
       FROM forum_threads ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM forum_threads ${where}`,
      params
    );

    res.json({ success: true, data: { items: threads, total: totalRow.c, page, page_size: pageSize } });
  } catch (e) {
    console.error('[Forum] threads list error:', e);
    res.status(500).json({ success: false, message: '获取帖子列表失败' });
  }
});

/** 帖子详情（含正文，浏览数 24h 去重自增） */
router.get('/threads/:id', async (req, res) => {
  try {
    const thread = await db.get(
      'SELECT * FROM forum_threads WHERE id = ? AND status = \'published\'',
      [req.params.id]
    );
    if (!thread) {
      return res.status(404).json({ success: false, message: '帖子不存在' });
    }

    // 浏览数去重自增（24h 窗口）
    const { user: authUser } = await loadAuthUser(req);
    const viewerKey = authUser ? `user:${authUser.id}` : `ip:${getClientIp(req)}`;
    const nowMs = Date.now();
    const WINDOW_MS = 24 * 60 * 60 * 1000;
    const existing = await db.get(
      'SELECT last_viewed_at FROM thread_views WHERE thread_id = ? AND viewer_key = ?',
      [req.params.id, viewerKey]
    );
    if (!existing || nowMs - existing.last_viewed_at > WINDOW_MS) {
      await db.run(
        'INSERT OR REPLACE INTO thread_views (thread_id, viewer_key, last_viewed_at) VALUES (?, ?, ?)',
        [req.params.id, viewerKey, nowMs]
      );
      await db.run('UPDATE forum_threads SET view_count = view_count + 1 WHERE id = ?', [req.params.id]);
      thread.view_count = (thread.view_count as number) + 1;
    }

    res.json({ success: true, data: thread });
  } catch (e) {
    console.error('[Forum] thread detail error:', e);
    res.status(500).json({ success: false, message: '获取帖子详情失败' });
  }
});

/** 发帖（需确权 + Turnstile） */
router.post('/threads', requireVerifiedEmail, async (req, res) => {
  try {
    const { user: authUser } = await loadAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    // V4.1.0 Wave 3A：论坛发帖权限项检查（管理员可单独关闭用户发帖能力，V1.7.0 权限检查模式）
    const postPerm = await db.get<{ can_forum_post: number }>('SELECT can_forum_post FROM users WHERE id = ?', [authUser.id]);
    if (postPerm && !postPerm.can_forum_post) {
      return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message: '您已被禁止在论坛发帖' });
    }

    // V4.1.0：L2 处罚论坛发帖封禁执法点（认证后、业务逻辑前拦截）
    const { banned: postBanned } = await checkPenaltyCap(authUser.id, 'forum_post');
    if (postBanned) {
      return res.status(403).json({
        success: false,
        code: 'FORUM_POST_BANNED',
        message: '您的账号发帖功能已被限制，如有疑问请联系管理员',
      });
    }

    const denied = await ensureHumanVerified('user', authUser.id, req);
    if (denied) {
      return res.status(denied.status).json(denied.payload);
    }

    const { board_id, title, content_md, ref_type, ref_id } = req.body || {};
    if (!board_id || typeof board_id !== 'string') {
      return res.status(400).json({ success: false, message: '请选择板块' });
    }
    if (!title || typeof title !== 'string' || title.trim().length < 1 || title.length > 120) {
      return res.status(400).json({ success: false, message: '标题长度须为 1-120 字' });
    }
    if (!content_md || typeof content_md !== 'string' || content_md.trim().length < 1 || content_md.length > 20000) {
      return res.status(400).json({ success: false, message: '正文长度须为 1-20000 字' });
    }

    const board = await db.get('SELECT id, is_active FROM forum_boards WHERE id = ?', [board_id]);
    if (!board || board.is_active !== 1) {
      return res.status(400).json({ success: false, message: '板块不存在或已停用' });
    }

    const id = randomUUID();
    const nowIso = new Date().toISOString();
    await db.run(
      `INSERT INTO forum_threads (id, board_id, title, content_md, author_id, author_name, status, is_pinned, view_count, like_count, reply_count, ref_type, ref_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', 0, 0, 0, 0, ?, ?, ?, ?)`,
      [id, board_id, title.trim(), content_md, authUser.id, authUser.username || authUser.email, ref_type || null, ref_id || null, nowIso, nowIso]
    );
    await db.run('UPDATE forum_boards SET thread_count = thread_count + 1 WHERE id = ?', [board_id]);

    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    console.error('[Forum] create thread error:', e);
    res.status(500).json({ success: false, message: '发帖失败' });
  }
});

/** 帖子点赞 */
router.post('/threads/:id/like', requireVerifiedEmail, async (req, res) => {
  try {
    const { user: authUser } = await loadAuthUser(req);
    if (!authUser) return res.status(401).json({ success: false, message: '未登录' });
    const thread = await db.get('SELECT id FROM forum_threads WHERE id = ?', [req.params.id]);
    if (!thread) return res.status(404).json({ success: false, message: '帖子不存在' });

    await db.run(
      'INSERT OR IGNORE INTO thread_likes (thread_id, user_id) VALUES (?, ?)',
      [req.params.id, authUser.id]
    );
    const result = await db.run('UPDATE forum_threads SET like_count = like_count + 1 WHERE id = ?', [req.params.id]);
    const liked = (result.changes ?? 0) > 0;
    const row = await db.get('SELECT like_count FROM forum_threads WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: { liked, like_count: row.like_count } });
  } catch (e) {
    console.error('[Forum] like error:', e);
    res.status(500).json({ success: false, message: '点赞失败' });
  }
});

/** 取消帖子点赞 */
router.delete('/threads/:id/like', requireVerifiedEmail, async (req, res) => {
  try {
    const { user: authUser } = await loadAuthUser(req);
    if (!authUser) return res.status(401).json({ success: false, message: '未登录' });
    await db.run('DELETE FROM thread_likes WHERE thread_id = ? AND user_id = ?', [req.params.id, authUser.id]);
    await db.run('UPDATE forum_threads SET like_count = MAX(0, like_count - 1) WHERE id = ?', [req.params.id]);
    const row = await db.get('SELECT like_count FROM forum_threads WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: { liked: false, like_count: row.like_count } });
  } catch (e) {
    console.error('[Forum] unlike error:', e);
    res.status(500).json({ success: false, message: '取消点赞失败' });
  }
});

/** 删除帖子（本人/管理员，级联清理评论与归档） */
router.delete('/threads/:id', requireVerifiedEmail, async (req, res) => {
  try {
    const { user: authUser } = await loadAuthUser(req);
    if (!authUser) return res.status(401).json({ success: false, message: '未登录' });
    const thread = await db.get('SELECT * FROM forum_threads WHERE id = ?', [req.params.id]);
    if (!thread) return res.status(404).json({ success: false, message: '帖子不存在' });

    // 管理员删除在 adminForum 路由处理；此处仅本人
    if (thread.author_id !== authUser.id) {
      return res.status(403).json({ success: false, message: '无权删除他人帖子' });
    }

    const denied = await ensureHumanVerified('user', authUser.id, req);
    if (denied) return res.status(denied.status).json(denied.payload);

    await deleteThreadCascade(thread.id, thread.board_id);
    res.json({ success: true });
  } catch (e) {
    console.error('[Forum] delete thread error:', e);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

/** 级联删除帖子：评论行、热度、归档索引+OSS、板块计数 */
export async function deleteThreadCascade(threadId: string, boardId: string): Promise<void> {
  await db.exec('BEGIN');
  try {
    // 评论点赞
    await db.run('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE subject_type = ? AND subject_id = ?)', ['thread', threadId]);
    // 归档索引 + OSS
    const archives = await db.all('SELECT root_id, oss_key FROM comment_archives WHERE subject_type = ? AND subject_id = ?', ['thread', threadId]);
    for (const a of archives) {
      try { await deleteFromOSS(a.oss_key); } catch (e) { console.warn('[Forum] archive oss delete warn:', e); }
    }
    // 评论行、热度、浏览、点赞
    await db.run('DELETE FROM comments WHERE subject_type = ? AND subject_id = ?', ['thread', threadId]);
    await db.run('DELETE FROM comment_heat WHERE root_id IN (SELECT id FROM comments WHERE subject_type = ? AND subject_id = ?)', ['thread', threadId]);
    await db.run('DELETE FROM thread_views WHERE thread_id = ?', [threadId]);
    await db.run('DELETE FROM thread_likes WHERE thread_id = ?', [threadId]);
    // 帖子本身 + 板块计数
    await db.run('DELETE FROM forum_threads WHERE id = ?', [threadId]);
    await db.run('UPDATE forum_boards SET thread_count = MAX(0, thread_count - 1) WHERE id = ?', [boardId]);
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

// thread_views 旧记录定时清理（与 photo_views 同款，7 天，每小时）
const THREAD_VIEWS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - THREAD_VIEWS_RETENTION_MS;
  db.run('DELETE FROM thread_views WHERE last_viewed_at < ?', cutoff).catch((e) => console.error('[ThreadViews] cleanup failed:', e));
}, 60 * 60 * 1000);

export default router;
