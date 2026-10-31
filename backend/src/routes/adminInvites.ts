/**
 * @file adminInvites.ts
 * @description 邀请码管理路由（V4.7.0）。仅超级管理员（super）可访问。
 *  端点：
 *  - GET    /           分页列表（keyword 匹配 code/title/airline）
 *  - POST   /           创建邀请码（code 可空自动生成）
 *  - PUT    /:id        更新（title/airline/max_uses/expires_at/remark/is_active）
 *  - DELETE /:id        删除（仅未被使用的码；已被使用请改为停用）
 *  所有写操作落管理员操作审计日志。
 */
import express from 'express';
import { adminAuthMiddleware, requireRole } from '../middleware/adminAuth';
import { logAdminAction } from '../services/adminService';
import {
  createInviteCode,
  listInviteCodes,
  updateInviteCode,
  deleteInviteCode,
} from '../services/inviteCodeService';

const router = express.Router();
router.use(adminAuthMiddleware);
// 邀请码涉及账号称号发放，收敛为唯一超级管理员
router.use(requireRole(['super']));

function getClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

/** 分页列表 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : '';
    const result = await listInviteCodes({ page, pageSize, keyword });
    res.json({
      success: true,
      data: { items: result.items, total: result.total, page, page_size: pageSize },
    });
  } catch (e) {
    console.error('[AdminInvites] list error:', e);
    res.status(500).json({ success: false, message: '获取邀请码列表失败' });
  }
});

/** 创建邀请码 */
router.post('/', async (req, res) => {
  try {
    const result = await createInviteCode(req.body || {}, req.admin!.id);
    if (!result.ok) {
      return res.status(400).json({ success: false, code: result.code ?? 'INVALID_PARAMS', message: result.message });
    }
    await logAdminAction(
      req.admin!,
      'create_invite_code',
      'invite_code',
      result.data.id,
      { code: result.data.code, title: result.data.title, max_uses: result.data.max_uses },
      getClientIp(req),
    );
    res.status(201).json({ success: true, data: result.data });
  } catch (e) {
    console.error('[AdminInvites] create error:', e);
    res.status(500).json({ success: false, message: '创建邀请码失败' });
  }
});

/** 更新邀请码 */
router.put('/:id', async (req, res) => {
  try {
    const result = await updateInviteCode(req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(400).json({ success: false, code: result.code ?? 'INVALID_PARAMS', message: result.message });
    }
    await logAdminAction(
      req.admin!,
      'update_invite_code',
      'invite_code',
      req.params.id,
      req.body,
      getClientIp(req),
    );
    res.json({ success: true, data: result.data });
  } catch (e) {
    console.error('[AdminInvites] update error:', e);
    res.status(500).json({ success: false, message: '更新邀请码失败' });
  }
});

/** 删除邀请码（仅未使用） */
router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteInviteCode(req.params.id);
    if (!result.ok) {
      const status = result.code === 'INVITE_CODE_IN_USE' ? 409 : 404;
      return res.status(status).json({ success: false, code: result.code ?? 'INVITE_CODE_NOT_FOUND', message: result.message });
    }
    await logAdminAction(
      req.admin!,
      'delete_invite_code',
      'invite_code',
      req.params.id,
      { code: result.data.code },
      getClientIp(req),
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[AdminInvites] delete error:', e);
    res.status(500).json({ success: false, message: '删除邀请码失败' });
  }
});

export default router;
