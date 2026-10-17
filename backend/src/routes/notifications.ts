/**
 * @file notifications.ts
 * @description 通知中心路由模块（V4.0.0）。
 *              提供当前登录用户的站内通知查询、未读计数、单条已读与全部已读接口。
 *              所有端点均需 JWT 登录（requireAuth），数据严格按 user_id 隔离。
 */
import express from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { db } from '../db';
import {
  getUnreadCount,
  listNotifications,
  markRead,
  markAllRead,
} from '../services/notificationService';

const router = express.Router();

// 本模块全部端点均需登录：统一挂载强制认证中间件（req.authUser 由其注入）
router.use(requireAuth);

/**
 * 获取当前用户通知列表（分页，按创建时间倒序）。
 * @query page 页码（默认 1）
 * @query limit 每页条数（默认 20，上限 100）
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const page = parseInt(String(req.query.page)) || 1;
    const limit = parseInt(String(req.query.limit)) || 20;

    const { items, total } = await listNotifications(userId, page, limit);

    res.json({
      success: true,
      data: items,
      pagination: {
        page: Math.max(1, page),
        limit: Math.min(100, Math.max(1, limit)),
        total,
      },
    });
  } catch (error) {
    console.error('Error listing notifications:', error);
    res.status(500).json({ success: false, message: '获取通知列表失败' });
  }
});

/**
 * 获取当前用户未读通知数量。
 * 注意：本路由为固定路径，必须注册在无 GET /:id 类参数路由的模块中，无顺序冲突。
 */
router.get('/unread-count', async (req, res) => {
  try {
    const count = await getUnreadCount(req.authUser!.id);
    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error counting unread notifications:', error);
    res.status(500).json({ success: false, message: '获取未读数量失败' });
  }
});

/**
 * 全部标记已读。
 * @returns 本次标记为已读的条数
 */
router.put('/read-all', async (req, res) => {
  try {
    const changed = await markAllRead(req.authUser!.id);
    res.json({ success: true, message: '已全部标记为已读', data: { changed } });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    res.status(500).json({ success: false, message: '标记已读失败' });
  }
});

/**
 * 标记单条通知为已读（仅限本人的通知，他人的通知返回 404）。
 * @param id 通知 ID
 */
router.put('/:id/read', async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const updated = await markRead(userId, req.params.id);
    if (!updated) {
      return res.status(404).json({ success: false, message: '通知不存在' });
    }
    res.json({ success: true, message: '已标记为已读' });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ success: false, message: '标记已读失败' });
  }
});

export default router;
