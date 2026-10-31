/**
 * @file comments.ts
 * @description V3.0.0 通用评论路由（主题参数化：photo/article，供论坛二期复用）。
 *
 *              端点：
 *              - GET    /                         L1 分页列表（含归档线程索引）
 *              - POST   /                         发表 L1 / 回复（严格三级封顶）
 *              - GET    /archives/:rootId/url     归档线程 24h 预签名直读 URL
 *              - GET    /:rootId/replies          单楼回复二次加载
 *              - POST   /:id/like                 点赞
 *              - DELETE /:id/like                 取消点赞
 *              - DELETE /:id                      删除（本人；高危人机门）
 *
 *              写操作要求登录且邮箱已确权；删除额外要求人机验证状态。
 *              领域错误码在本文件统一映射 HTTP 状态，未知错误交全局处理器脱敏。
 */
import express from 'express';
import { db } from '../db';
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail';
import { loadAuthUser } from '../services/authService';
import { ensureHumanVerified, getVerificationIp } from '../services/verificationService';
import {
  CommentServiceError,
  createComment,
  listRootComments,
  listThreadReplies,
  setCommentLike,
  deleteComment,
  type CommentErrorCode,
  type CommentSubjectType,
  type CommentArchiveGateway,
  type CommentRehydrateGateway,
} from '../services/commentService';
import { commentArchiveService, ArchiveServiceError } from '../services/commentArchiveService';
import { heatConfigFromEnv } from '../services/commentHeatService';
import { createNotification } from '../services/notificationService';
import { deleteFromOSS } from '../services/ossService';
import { archiveKeyOf } from '../services/commentArchiveStore';
import { ossCommentArchiveStore } from '../services/ossCommentArchiveStore';
import { checkPenaltyCap } from '../services/penaltyService';

const router = express.Router();

const SUBJECT_TYPES: readonly CommentSubjectType[] = ['photo', 'article', 'thread'];

/** 领域错误码 → HTTP 状态映射 */
const COMMENT_ERROR_STATUS: Record<CommentErrorCode, number> = {
  COMMENT_CONTENT_EMPTY: 400,
  COMMENT_CONTENT_TOO_LONG: 400,
  PARENT_SUBJECT_MISMATCH: 400,
  SUBJECT_NOT_FOUND: 404,
  PARENT_NOT_FOUND: 404,
  COMMENT_NOT_FOUND: 404,
  COMMENT_DELETE_FORBIDDEN: 403,
};

const COMMENT_ERROR_MESSAGE: Record<CommentErrorCode, string> = {
  COMMENT_CONTENT_EMPTY: '评论内容不能为空',
  COMMENT_CONTENT_TOO_LONG: '评论内容不可超过 1000 字',
  PARENT_SUBJECT_MISMATCH: '不能跨主题回复评论',
  SUBJECT_NOT_FOUND: '评论主题不存在',
  PARENT_NOT_FOUND: '被回复的评论不存在',
  COMMENT_NOT_FOUND: '评论不存在',
  COMMENT_DELETE_FORBIDDEN: '无权删除该评论',
};

/** 评论领域错误映射响应；非领域错误返回 false 交由全局错误处理 */
function respondCommentError(res: express.Response, error: unknown): boolean {
  if (error instanceof ArchiveServiceError) {
    const status =
      error.code === 'ARCHIVE_JOB_LOCKED'
        ? 409
        : error.code === 'ARCHIVE_NOT_FOUND'
          ? 404
          : 502;
    res.status(status).json({ success: false, code: error.code, message: error.message });
    return true;
  }
  if (!(error instanceof CommentServiceError)) return false;
  res.status(COMMENT_ERROR_STATUS[error.code]).json({
    success: false,
    code: error.code,
    message: COMMENT_ERROR_MESSAGE[error.code],
  });
  return true;
}

/** 校验并归一化主题参数；非法返回 null */
function parseSubject(input: {
  subject_type?: unknown;
  subject_id?: unknown;
}): { subjectType: CommentSubjectType; subjectId: string } | null {
  const subjectType = input.subject_type;
  const subjectId = input.subject_id;
  if (
    typeof subjectType !== 'string' ||
    !SUBJECT_TYPES.includes(subjectType as CommentSubjectType)
  ) {
    return null;
  }
  if (typeof subjectId !== 'string' || subjectId.trim().length === 0 || subjectId.length > 128) {
    return null;
  }
  return { subjectType: subjectType as CommentSubjectType, subjectId: subjectId.trim() };
}

/**
 * 查询评论主题标题（V4.0.0 回复通知文案用）。
 * 表名经白名单映射（thread→forum_threads / photo→photos / article→articles），无注入面。
 * @returns 主题标题；主题已被删除时返回 null（此时跳过通知）
 */
async function getSubjectTitle(subjectType: CommentSubjectType, subjectId: string): Promise<string | null> {
  const table =
    subjectType === 'thread' ? 'forum_threads' : subjectType === 'photo' ? 'photos' : 'articles';
  const row = await db.get<{ title?: string }>(`SELECT title FROM ${table} WHERE id = ?`, subjectId);
  return row?.title ?? null;
}

/**
 * 发送论坛回复通知（V4.0.0 Task 5.3 后端侧）。
 * 触发条件：回复类评论（有父评论）、被回复人存在且非本人（自回复不打扰）。
 * 通知体：title=`回复 @回复人`；content=`{回复人} 回复了你在《{主题标题}》下的评论`；
 * related_type/related_id 指向评论主题（thread/photo/article），供前端跳转。
 * 通知失败仅告警，不影响评论发布主流程。
 */
async function notifyForumReply(params: {
  subjectType: CommentSubjectType;
  subjectId: string;
  parentCommentId: string;
  replierId: string;
  replierName: string;
}): Promise<void> {
  const parent = await db.get<{ user_id: string | null }>(
    'SELECT user_id FROM comments WHERE id = ?',
    params.parentCommentId
  );
  // 被回复人不存在（历史迁移评论 user_id 为空）或自回复：不通知
  if (!parent?.user_id || parent.user_id === params.replierId) return;

  const subjectTitle = await getSubjectTitle(params.subjectType, params.subjectId);
  if (!subjectTitle) return;

  await createNotification({
    user_id: parent.user_id,
    type: 'forum_reply',
    title: `回复 @${params.replierName}`,
    content: `${params.replierName} 回复了你在《${subjectTitle}》下的评论`,
    related_type: params.subjectType,
    related_id: params.subjectId,
  });
}

/** 解析正整数查询参数（带回退与上限） */
function parseIntegerParam(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/** OSS 归档对象删除网关（按 root_id 推导 key，删除幂等） */
const archiveGateway: CommentArchiveGateway = {
  deleteArchivedObject: async (rootId: string) => {
    await deleteFromOSS(archiveKeyOf(rootId));
  },
  readArchivedThreadOwner: async (rootId: string) => {
    const payload = await ossCommentArchiveStore.get(rootId);
    if (!payload) return null;
    const root = payload.comments.find((c) => c.depth === 1);
    return { rootUserId: root ? root.user_id : null };
  },
};

/** 归档线程回迁网关（回复归档线程时由评论服务调用） */
const rehydrateGateway: CommentRehydrateGateway = {
  rehydrateThread: async (rootId: string) => {
    await commentArchiveService.rehydrateThread(db, rootId);
  },
};

/**
 * L1 主评论分页列表（公开读取）。
 * @query subject_type, subject_id 必填
 * @query page 默认1，page_size 默认20（上限50），sort=latest|hottest
 * @returns 活跃线程（含首批回复、点赞态）+ 归档线程索引
 */
router.get('/', async (req, res, next) => {
  try {
    const subject = parseSubject(req.query);
    if (!subject) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PARAMS',
        message: 'subject_type 或 subject_id 不合法',
      });
    }

    const sort = req.query.sort === 'hottest' ? 'hottest' : 'latest';
    const page = parseIntegerParam(req.query.page, 1, 10000);
    const pageSize = parseIntegerParam(req.query.page_size, 20, 50);

    // 查看者为可选登录身份：仅用于附加 is_liked，不强制
    const { user: viewer } = await loadAuthUser(req);

    const result = await listRootComments(
      db,
      { ...subject, page, pageSize, sort },
      viewer?.id ?? null
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (!respondCommentError(res, error)) next(error);
  }
});

/**
 * 发表主评论或回复（须登录 + 邮箱确权）。
 * @body subject_type, subject_id 必填；parent_id/root_id 回复时提供；content ≤1000 字
 */
router.post('/', requireVerifiedEmail, async (req, res, next) => {
  try {
    const subject = parseSubject(req.body ?? {});
    if (!subject) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PARAMS',
        message: 'subject_type 或 subject_id 不合法',
      });
    }

    const parentId =
      typeof req.body?.parent_id === 'string' && req.body.parent_id.trim()
        ? req.body.parent_id
        : null;
    const rootId =
      typeof req.body?.root_id === 'string' && req.body.root_id.trim()
        ? req.body.root_id
        : null;

    const { user } = await loadAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: '请先登录' });
    }

    // V4.1.0 Wave 3A：评论权限项检查（管理员可单独关闭用户评论能力，V1.7.0 权限检查模式）
    const commentPerm = await db.get<{ can_comment: number }>('SELECT can_comment FROM users WHERE id = ?', [user.id]);
    if (commentPerm && !commentPerm.can_comment) {
      return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message: '您已被禁止发表评论' });
    }

    // V4.1.0：L2 处罚评论封禁执法点（认证后、业务逻辑前拦截；照片评论与帖子回复共用本入口）
    const { banned: commentBanned } = await checkPenaltyCap(user.id, 'comment');
    if (commentBanned) {
      return res.status(403).json({
        success: false,
        code: 'COMMENT_BANNED',
        message: '您的账号评论功能已被限制，如有疑问请联系管理员',
      });
    }

    const created = await createComment(
      db,
      {
        ...subject,
        parentId,
        rootId,
        content: typeof req.body?.content === 'string' ? req.body.content : '',
      },
      { userId: user.id, author: user.username || user.email || '已验证用户', authorTitle: user.user_title || null },
      { heatConfig: heatConfigFromEnv(), rehydrateGateway }
    );

    // V4.0.0：回复类评论向被回复人发送 forum_reply 站内信（自回复/被回复人缺失时静默跳过）
    if (created.parent_id) {
      try {
        await notifyForumReply({
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          parentCommentId: created.parent_id,
          replierId: user.id,
          replierName: user.username || user.email || '已验证用户',
        });
      } catch (notifyError) {
        console.warn('[Comments] forum_reply notification failed:', notifyError);
      }
    }

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (!respondCommentError(res, error)) next(error);
  }
});

/**
 * 获取归档线程的 24h 预签名直读 URL。
 * 归档索引存在 → 200 {url, archived_at}；不存在 → 404。
 */
router.get('/archives/:rootId/url', async (req, res, next) => {
  try {
    const result = await commentArchiveService.getArchiveReadUrl(db, req.params.rootId);
    if (!result) {
      return res.status(404).json({ success: false, code: 'ARCHIVE_NOT_FOUND', message: '归档评论不存在' });
    }
    res.json({
      success: true,
      data: {
        url: result.url,
        archived_at: result.archive.archived_at,
        root_created_at: result.archive.root_created_at,
        reply_count: result.archive.reply_count,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 单楼回复二次加载（公开读取，"查看全部回复"）。
 * @query limit（默认100，上限100），offset
 */
router.get('/:rootId/replies', async (req, res, next) => {
  try {
    const { user: viewer } = await loadAuthUser(req);
    const limit = parseIntegerParam(req.query.limit, 100, 100);
    const offset = parseIntegerParam(req.query.offset, 0, 100000);

    const result = await listThreadReplies(
      db,
      req.params.rootId,
      { limit, offset },
      viewer?.id ?? null
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (!respondCommentError(res, error)) next(error);
  }
});

/**
 * 点赞评论（须登录 + 邮箱确权）。
 * 重复点赞幂等：返回当前 like_count 与 is_liked。
 */
router.post('/:id/like', requireVerifiedEmail, async (req, res, next) => {
  try {
    const { user } = await loadAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: '请先登录' });
    }
    const result = await setCommentLike(db, req.params.id, user.id, true, {
      heatConfig: heatConfigFromEnv(),
    });
    res.json({ success: true, data: { like_count: result.likeCount, is_liked: result.isLiked } });
  } catch (error) {
    if (!respondCommentError(res, error)) next(error);
  }
});

/** 取消点赞（须登录 + 邮箱确权）；未点赞时幂等返回当前计数。 */
router.delete('/:id/like', requireVerifiedEmail, async (req, res, next) => {
  try {
    const { user } = await loadAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: '请先登录' });
    }
    const result = await setCommentLike(db, req.params.id, user.id, false, {
      heatConfig: heatConfigFromEnv(),
    });
    res.json({ success: true, data: { like_count: result.likeCount, is_liked: result.isLiked } });
  } catch (error) {
    if (!respondCommentError(res, error)) next(error);
  }
});

/**
 * 删除评论（本人；L1 整楼、L2/L3 单条，归档楼联动删云对象）。
 * 高危操作：除登录与邮箱确權外，还须 168h 内人机验证状态（测试 tokens 旁路）。
 */
router.delete('/:id', requireVerifiedEmail, async (req, res, next) => {
  try {
    const { user } = await loadAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: '请先登录' });
    }

    const denied = await ensureHumanVerified('user', user.id, req);
    if (denied) {
      return res.status(denied.status).json(denied.payload);
    }

    const result = await deleteComment(
      db,
      req.params.id,
      { userId: user.id, isAdmin: false },
      { archiveGateway }
    );

    console.log(
      `[Comments] 用户删除评论: id=${req.params.id}, thread=${result.deletedThread}, count=${result.removedCount}, ip=${getVerificationIp(req)}`
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (!respondCommentError(res, error)) next(error);
  }
});

export default router;
