/**
 * @file adminForum.ts（V3.1.0 / V4.0.0）
 * @description 论坛管理路由：板块 CRUD、帖子置顶/删除。
 *              V4.0.0：角色收敛为 super/zone_master/forum_moderator（zone_auditor 不可进入）；
 *              板块创建收敛为三大基础板块白名单（BOARD_LIMITED），三大板块禁止删除（BOARD_PROTECTED）。
 */
import express from 'express';
import { db, CANONICAL_FORUM_BOARDS } from '../db';
import { adminAuthMiddleware, requireRole } from '../middleware/adminAuth';
import { logAdminAction } from '../services/adminService';
import { ensureHumanVerified } from '../services/verificationService';
import { deleteThreadCascade } from './forum';

const router = express.Router();
router.use(adminAuthMiddleware);
// V4.0.0：论坛管理端点角色门禁——保持 super/zone_master 原有权不变，
// 新增论坛管理员（forum_moderator）；分区审核员（zone_auditor）不得进入论坛管理
router.use(requireRole(['super', 'zone_master', 'forum_moderator']));

function getClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

/** 板块列表（含停用） */
router.get('/boards', async (_req, res) => {
  const boards = await db.all('SELECT * FROM forum_boards ORDER BY sort_order ASC');
  res.json({ success: true, data: boards });
});

/**
 * 创建板块（V4.0.0 收敛）。
 * 仅允许三大基础板块（航空/铁路/公路）：名称不在白名单 → 400 BOARD_LIMITED；
 * 板块已存在（按 id 或名称判断）→ 幂等返回 200，不重复插入。
 */
router.post('/boards', async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ success: false, message: 'name 必填' });
  }
  // 白名单校验：仅允许三大基础板块，禁止自建第 4 个板块
  const canonical = CANONICAL_FORUM_BOARDS.find((b) => b.name === name.trim());
  if (!canonical) {
    return res.status(400).json({
      success: false,
      code: 'BOARD_LIMITED',
      message: `仅允许三大基础板块：${CANONICAL_FORUM_BOARDS.map((b) => b.name).join('、')}`,
    });
  }
  // 幂等：板块已存在（id 或名称命中）则直接返回，不报错不重复插入
  const exists = await db.get('SELECT id FROM forum_boards WHERE id = ? OR name = ?', [canonical.id, canonical.name]);
  if (exists) {
    return res.json({ success: true, data: { id: canonical.id, name: canonical.name, existed: true } });
  }
  // 以白名单的标准定义落库（忽略请求传入的 id/description 等，防止仿冒三大板块）
  await db.run(
    'INSERT INTO forum_boards (id, name, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [canonical.id, canonical.name, canonical.description, canonical.icon, canonical.sort_order]
  );
  await logAdminAction(req.admin!, 'create_board', 'forum_board', canonical.id, { name: canonical.name }, getClientIp(req));
  res.status(201).json({ success: true, data: { id: canonical.id, name: canonical.name, existed: false } });
});

/** 更新板块 */
router.put('/boards/:id', async (req, res) => {
  const { name, description, icon, sort_order, is_active } = req.body || {};
  const board = await db.get('SELECT id FROM forum_boards WHERE id = ?', [req.params.id]);
  if (!board) return res.status(404).json({ success: false, message: '板块不存在' });
  await db.run(
    'UPDATE forum_boards SET name = COALESCE(?, name), description = COALESCE(?, description), icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ?',
    [name ?? null, description ?? null, icon ?? null, sort_order ?? null, is_active ?? null, req.params.id]
  );
  await logAdminAction(req.admin!, 'update_board', 'forum_board', req.params.id, req.body, getClientIp(req));
  res.json({ success: true });
});

/** 删除板块（V4.0.0：三大基础板块禁止删除 → 400 BOARD_PROTECTED；其余板块仍要求无关联帖子） */
router.delete('/boards/:id', async (req, res) => {
  // 三大基础板块为论坛结构基石，一律保护
  if (CANONICAL_FORUM_BOARDS.some((b) => b.id === req.params.id)) {
    return res.status(400).json({
      success: false,
      code: 'BOARD_PROTECTED',
      message: '航空/铁路/公路三大基础板块不可删除',
    });
  }
  const count = await db.get('SELECT COUNT(*) AS c FROM forum_threads WHERE board_id = ?', [req.params.id]);
  if (count.c > 0) {
    return res.status(409).json({ success: false, message: `该板块下仍有 ${count.c} 篇帖子，请先迁移或删除` });
  }
  await db.run('DELETE FROM forum_boards WHERE id = ?', [req.params.id]);
  await logAdminAction(req.admin!, 'delete_board', 'forum_board', req.params.id, undefined, getClientIp(req));
  res.json({ success: true });
});

/** 帖子置顶切换 */
router.put('/threads/:id/pin', async (req, res) => {
  const thread = await db.get('SELECT id, is_pinned FROM forum_threads WHERE id = ?', [req.params.id]);
  if (!thread) return res.status(404).json({ success: false, message: '帖子不存在' });
  const newPinned = thread.is_pinned === 1 ? 0 : 1;
  await db.run('UPDATE forum_threads SET is_pinned = ? WHERE id = ?', [newPinned, req.params.id]);
  await logAdminAction(req.admin!, newPinned ? 'pin_thread' : 'unpin_thread', 'forum_thread', req.params.id, { is_pinned: newPinned }, getClientIp(req));
  res.json({ success: true, data: { is_pinned: newPinned } });
});

/** 管理员删除帖子（级联） */
router.delete('/threads/:id', async (req, res) => {
  const denied = await ensureHumanVerified('admin', req.admin!.id, req);
  if (denied) return res.status(denied.status).json(denied.payload);
  const thread = await db.get('SELECT id, board_id FROM forum_threads WHERE id = ?', [req.params.id]);
  if (!thread) return res.status(404).json({ success: false, message: '帖子不存在' });
  await deleteThreadCascade(thread.id, thread.board_id);
  await logAdminAction(req.admin!, 'delete_thread', 'forum_thread', req.params.id, undefined, getClientIp(req));
  res.json({ success: true });
});

export default router;
