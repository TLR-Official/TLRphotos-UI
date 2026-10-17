/**
 * @file myAppeals.ts
 * @description 用户侧申诉管理路由模块（V4.0.0）。
 *              提供当前登录用户查看本人申诉记录与撤回待处理申诉的接口。
 *              发起申诉入口在 photos.ts（POST /api/photos/:id/appeal），
 *              本模块仅负责"我的申诉"列表与撤回。数据严格按 user_id 隔离。
 */
import express from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { db } from '../db';

const router = express.Router();

// 本模块全部端点均需登录：统一挂载强制认证中间件
router.use(requireAuth);

/**
 * 获取本人申诉记录列表（按创建时间倒序，联照片标题与当前照片状态）。
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const appeals = await db.all(
      `SELECT a.id, a.photo_id, a.reason, a.status, a.response, a.decided_at, a.created_at,
              p.title AS photo_title, p.status AS photo_status
       FROM appeals a
       LEFT JOIN photos p ON a.photo_id = p.id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.id DESC`,
      userId
    );
    res.json({ success: true, data: appeals });
  } catch (error) {
    console.error('Error listing my appeals:', error);
    res.status(500).json({ success: false, message: '获取申诉列表失败' });
  }
});

/**
 * 撤回本人待处理的申诉（仅 pending 可撤回）。
 * 撤回后 status=withdrawn，用户可对该照片重新发起申诉。
 * @param id 申诉 ID
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const appeal = await db.get<{ id: string; user_id: string; status: string }>(
      'SELECT id, user_id, status FROM appeals WHERE id = ?',
      req.params.id
    );

    if (!appeal || appeal.user_id !== userId) {
      return res.status(404).json({ success: false, message: '申诉不存在' });
    }
    if (appeal.status !== 'pending') {
      return res.status(400).json({ success: false, message: '该申诉已处理完毕，无法撤回' });
    }

    await db.run(
      "UPDATE appeals SET status = 'withdrawn', decided_at = ? WHERE id = ?",
      [new Date().toISOString(), req.params.id]
    );
    res.json({ success: true, message: '申诉已撤回，可重新发起' });
  } catch (error) {
    console.error('Error withdrawing appeal:', error);
    res.status(500).json({ success: false, message: '撤回申诉失败' });
  }
});

export default router;
