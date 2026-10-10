/**
 * @file adminComments.ts
 * @description V3.0.0 管理端评论路由（挂载于 /api/admin/comments）。
 *
 *              端点：
 *              - DELETE /:id          管理员删除任意评论（L1 整楼 / L2/L3 单条）
 *              - PUT    /:rootId/pin  线程置顶 / 取消置顶（置顶线程不参与归档）
 *
 *              全部操作经 admin JWT 鉴权并写入 admin_logs 审计。
 */
import express from 'express';
import { db } from '../db';
import { verifyAdminToken, logAdminAction, type AdminUser } from '../services/adminService';
import {
  deleteComment,
  type CommentArchiveGateway,
} from '../services/commentService';
import { setThreadPinned } from '../services/commentHeatService';
import { deleteFromOSS } from '../services/ossService';
import { archiveKeyOf } from '../services/commentArchiveStore';
import { ossCommentArchiveStore } from '../services/ossCommentArchiveStore';
import { ensureHumanVerified, getVerificationIp } from '../services/verificationService';

const router = express.Router();

/** OSS 归档对象删除网关（管理员删除归档楼时使用） */
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

/** 解析并校验管理员 JWT；失败返回 null */
async function loadAdmin(req: express.Request): Promise<AdminUser | null> {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return verifyAdminToken(token);
}

/**
 * 管理员删除任意评论。
 * - L1：整楼删除（含云对象/归档索引）
 * - L2/L3：单条删除
 * 审计动作 comment_delete，记录删除范围与条数。
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const admin = await loadAdmin(req);
    if (!admin) {
      return res.status(401).json({ success: false, message: '未授权或登录已过期' });
    }

    // 管理员删除评论为高危操作，需管理员人机验证状态（168h 内同 IP 有效）
    const denied = await ensureHumanVerified('admin', admin.id, req);
    if (denied) {
      return res.status(denied.status).json(denied.payload);
    }

    const result = await deleteComment(
      db,
      req.params.id,
      { userId: admin.id, isAdmin: true },
      { archiveGateway }
    );

    await logAdminAction(
      admin,
      'comment_delete',
      'comment',
      req.params.id,
      { deletedThread: result.deletedThread, removedCount: result.removedCount },
      getVerificationIp(req)
    );

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * 线程置顶 / 取消置顶。
 * @body pinned 布尔；缺省视为 true（置顶）
 * 置顶线程不参与超期归档；取消置顶后按 retain_until 正常参与。
 */
router.put('/:rootId/pin', async (req, res, next) => {
  try {
    const admin = await loadAdmin(req);
    if (!admin) {
      return res.status(401).json({ success: false, message: '未授权或登录已过期' });
    }

    const pinned = req.body?.pinned !== false;

    try {
      await setThreadPinned(db, req.params.rootId, pinned);
    } catch (error) {
      if (error instanceof Error && error.message === 'COMMENT_HEAT_NOT_FOUND') {
        return res
          .status(404)
          .json({ success: false, code: 'COMMENT_NOT_FOUND', message: '评论线程不存在' });
      }
      throw error;
    }

    await logAdminAction(
      admin,
      pinned ? 'comment_pin' : 'comment_unpin',
      'comment_thread',
      req.params.rootId,
      undefined,
      getVerificationIp(req)
    );

    res.json({ success: true, data: { root_id: req.params.rootId, pinned } });
  } catch (error) {
    next(error);
  }
});

export default router;
