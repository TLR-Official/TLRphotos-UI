/**
 * @file adminForum.ts（V3.1.0）
 * @description 论坛管理路由：板块 CRUD、帖子置顶/删除。
 */
import express from 'express';
import { db } from '../db';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { logAdminAction } from '../services/adminService';
import { ensureHumanVerified } from '../services/verificationService';
import { deleteThreadCascade } from './forum';

const router = express.Router();
router.use(adminAuthMiddleware);

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

/** 创建板块 */
router.post('/boards', async (req, res) => {
  const { id, name, description, icon, sort_order } = req.body || {};
  if (!id || !name) return res.status(400).json({ success: false, message: 'id 与 name 必填' });
  const exists = await db.get('SELECT id FROM forum_boards WHERE id = ?', [id]);
  if (exists) return res.status(409).json({ success: false, message: '板块 id 已存在' });
  await db.run(
    'INSERT INTO forum_boards (id, name, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [id, name, description || '', icon || '', sort_order || 0]
  );
  await logAdminAction(req.admin!, 'create_board', 'forum_board', id, { name }, getClientIp(req));
  res.status(201).json({ success: true });
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

/** 删除板块（校验无关联帖子） */
router.delete('/boards/:id', async (req, res) => {
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
