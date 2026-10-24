/**
 * @file users.ts（V4.1.0）
 * @description 公开用户主页路由模块（挂载于 /api/users，120 次/分限速）：
 *              - GET /:id/profile  公开档案（昵称/头像/省份/加入天数/作品统计/活跃处罚公开信息）
 *              - GET /:id/photos   公开作品列表（仅 approved，分页 + 分区筛选）
 *              - GET /:id/threads  公开论坛发帖记录（分页）
 *
 *              隐私红线：响应绝不包含 email/IP/banned_until/can_ban_manage 等管理字段；
 *              未通过/待审核作品不对他人公开（仅 is_self 返回 pending/rejected 计数）。
 *              处罚公开信息经 getActivePenalties 过滤（已撤销/已过期不返回），
 *              且仅映射 level/reason/expires_at/created_at（不含 capabilities/revoked 内部字段）。
 */
import express from 'express';
import { db } from '../db';
import { getActivePenalties } from '../services/penaltyService';
import { createRateLimiter } from '../middleware/rateLimit';
import { getProxyUrl } from '../utils/url';
import { parsePhotoTags } from '../utils/photoTags';
import { getOptionalUserId } from '../utils/optionalAuth';
import { parsePagination } from '../utils/pagination';

const router = express.Router();

// 公开读取限速：与 photos.ts 公开浏览同款（120 次/分，测试环境自动放行）
const profileReadLimiter = createRateLimiter({ max: 120, message: '浏览过于频繁，请稍后再试' });

/** 加入天数计算的毫秒换算 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 公开用户档案统一列集：仅公开字段，绝不含 email/IP/banned_until/can_ban_manage */
const PUBLIC_USER_COLUMNS = 'id, username, avatar_url, region, created_at';

/** 用户不存在统一响应（404 USER_NOT_FOUND） */
function respondUserNotFound(res: express.Response) {
  return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
}

/**
 * GET /:id/profile — 公开用户档案。
 * 返回：id/username（昵称）/avatar_url/region（「未知」兜底）/joined_days（now - created_at 取整）/
 *       is_self（JWT 可选解析，本人访问为 true）/作品统计（approved_count/total_views）/
 *       public_penalties（活跃处罚公开信息）；is_self 额外返回 pending_count/rejected_count。
 */
router.get('/:id/profile', profileReadLimiter, async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim();
    if (!targetId) {
      return respondUserNotFound(res);
    }
    const user = await db.get<{ id: string; username: string | null; avatar_url: string | null; region: string | null; created_at: string }>(
      `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`,
      targetId
    );
    if (!user) {
      return respondUserNotFound(res);
    }

    const isSelf = getOptionalUserId(req) === user.id;

    // 作品统计：已通过数 + 已通过作品总浏览数（SUM views）
    const statRow = await db.get<{ c: number; v: number | null }>(
      `SELECT COUNT(*) AS c, SUM(views) AS v FROM photos WHERE user_id = ? AND status = 'approved'`,
      targetId
    );

    // 活跃处罚公开信息：已撤销/已过期由 getActivePenalties 过滤；仅映射公开四字段
    const activePenalties = await getActivePenalties(targetId);

    const createdMs = Date.parse(user.created_at);
    const data: Record<string, unknown> = {
      id: user.id,
      username: user.username || '用户',
      avatar_url: user.avatar_url,
      region: user.region || '未知',
      joined_days: Number.isFinite(createdMs) ? Math.max(0, Math.floor((Date.now() - createdMs) / DAY_MS)) : 0,
      is_self: isSelf,
      approved_count: statRow?.c ?? 0,
      total_views: statRow?.v ?? 0,
      public_penalties: activePenalties.map((p) => ({
        level: p.level,
        reason: p.reason,
        expires_at: p.expires_at,
        created_at: p.created_at,
      })),
    };

    // 本人访问：额外返回待审核/未通过计数（未通过作品本体不对他人公开，此处仅计数）
    if (isSelf) {
      const statusRow = await db.get<{ pending: number | null; rejected: number | null }>(
        `SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
         FROM photos WHERE user_id = ?`,
        targetId
      );
      data.pending_count = statusRow?.pending ?? 0;
      data.rejected_count = statusRow?.rejected ?? 0;
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Users] profile error:', error);
    res.status(500).json({ success: false, message: '获取用户主页失败' });
  }
});

/**
 * GET /:id/photos — 公开作品列表（仅 approved）。
 * 分页（page/page_size 默认 1/12，上限 50）+ category 分区筛选（可选）。
 * 字段形状对齐公开画廊列表：缩略图/预览图改写为代理 URL，tags 解析为数组。
 */
router.get('/:id/photos', profileReadLimiter, async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim();
    if (!targetId) {
      return respondUserNotFound(res);
    }
    const user = await db.get('SELECT id FROM users WHERE id = ?', targetId);
    if (!user) {
      return respondUserNotFound(res);
    }

    const { page, pageSize, offset } = parsePagination(req, { defaultSize: 12 });

    const params: unknown[] = [targetId];
    let where = "WHERE user_id = ? AND status = 'approved'";
    // 分区筛选：参数化精确匹配（值域与画廊一致：aviation/railway/road）
    const { category } = req.query;
    if (category) {
      where += ' AND category = ?';
      params.push(String(category));
    }

    const items = await db.all(
      `SELECT id, title, thumbnail_path, preview_url, tags, width, height, category, likes, views, created_at
       FROM photos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM photos ${where}`, params);

    const data = (items ?? []).map((photo: any) => ({
      ...photo,
      tags: parsePhotoTags(photo.tags),
      thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
      preview_url: photo.preview_url ? getProxyUrl(photo.preview_url, photo.id) : null,
    }));

    res.json({ success: true, data: { items: data, total: totalRow?.c ?? 0, page, page_size: pageSize } });
  } catch (error) {
    console.error('[Users] photos error:', error);
    res.status(500).json({ success: false, message: '获取用户作品失败' });
  }
});

/**
 * GET /:id/threads — 公开论坛发帖记录。
 * 仅返回已发布（status='published'）帖子，分页（page/page_size 默认 1/10，上限 50）。
 */
router.get('/:id/threads', profileReadLimiter, async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim();
    if (!targetId) {
      return respondUserNotFound(res);
    }
    const user = await db.get('SELECT id FROM users WHERE id = ?', targetId);
    if (!user) {
      return respondUserNotFound(res);
    }

    const { page, pageSize, offset } = parsePagination(req, { defaultSize: 10 });

    const items = await db.all(
      `SELECT id, title, board_id, reply_count, like_count, created_at
       FROM forum_threads WHERE author_id = ? AND status = 'published'
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [targetId, pageSize, offset]
    );
    const totalRow = await db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM forum_threads WHERE author_id = ? AND status = 'published'`,
      targetId
    );

    res.json({
      success: true,
      data: { items: items ?? [], total: totalRow?.c ?? 0, page, page_size: pageSize },
    });
  } catch (error) {
    console.error('[Users] threads error:', error);
    res.status(500).json({ success: false, message: '获取用户发帖记录失败' });
  }
});

export default router;
