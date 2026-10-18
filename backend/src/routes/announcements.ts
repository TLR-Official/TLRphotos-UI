/**
 * @file announcements.ts（V4.1.0）
 * @description 公告横幅路由模块：站点 Top Banner 公告的公开读取与管理端 CRUD + 手动上下线。
 *
 *              公开端（默认导出，挂载于 /api/announcements，120 次/分限速）：
 *              - GET /  仅返回 is_active=1 的公告，created_at 倒序；
 *                返回 id/title/content/cover_url/created_at/updated_at（不含 created_by 内部字段）。
 *
 *              管理端（导出 adminAnnouncementsRouter，挂载于 /api/admin/announcements）：
 *              - GET    /        公告管理列表（含已下线，分页可选）
 *              - POST   /        创建公告（title ≤100、content ≤5000、cover_url 可选 ≤500 且 http(s) 开头）
 *              - PUT    /:id     编辑公告（同校验，更新 updated_at）
 *              - PUT    /:id/toggle  上线/下线翻转，返回新状态
 *              - DELETE /:id     删除公告
 *              权限：super / news_editor，其他管理角色一律 403 ANNOUNCEMENT_DENIED。
 */
import express from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { logAdminAction } from '../services/adminService';
import { createRateLimiter } from '../middleware/rateLimit';

/** 标题长度上限 */
const ANNOUNCEMENT_TITLE_MAX = 100;
/** 正文长度上限 */
const ANNOUNCEMENT_CONTENT_MAX = 5000;
/** 封面图 URL 长度上限 */
const ANNOUNCEMENT_COVER_MAX = 500;

// 公开读取限速：与 photos.ts 公开浏览同款（120 次/分，测试环境自动放行）
const announcementReadLimiter = createRateLimiter({ max: 120, message: '请求过于频繁，请稍后再试' });

/** 校验结果：通过返回归一化字段；失败统一 400 ANNOUNCEMENT_FIELDS_INVALID */
type AnnouncementPayload =
  | { ok: true; title: string; content: string; cover_url: string | null }
  | { ok: false };

/**
 * 校验公告载荷：
 * - title 必填 ≤100 字、content 必填 ≤5000 字
 * - cover_url 可选：非空时 ≤500 字且须以 http:// 或 https:// 开头
 */
function validateAnnouncementPayload(body: unknown): AnnouncementPayload {
  const { title, content, cover_url } = (body || {}) as Record<string, unknown>;

  if (typeof title !== 'string' || !title.trim() || title.length > ANNOUNCEMENT_TITLE_MAX) {
    return { ok: false };
  }
  if (typeof content !== 'string' || !content.trim() || content.length > ANNOUNCEMENT_CONTENT_MAX) {
    return { ok: false };
  }
  // 封面图为选填：空/未传归一化为 null；传了则校验协议与长度
  let cover: string | null = null;
  if (cover_url !== undefined && cover_url !== null && String(cover_url).trim() !== '') {
    if (typeof cover_url !== 'string' || cover_url.length > ANNOUNCEMENT_COVER_MAX) {
      return { ok: false };
    }
    const trimmed = cover_url.trim();
    if (!/^https?:\/\//.test(trimmed)) {
      return { ok: false };
    }
    cover = trimmed;
  }
  return { ok: true, title: title.trim(), content: content.trim(), cover_url: cover };
}

/** 公告不存在统一响应（404 ANNOUNCEMENT_NOT_FOUND） */
function respondNotFound(res: express.Response) {
  return res.status(404).json({ success: false, code: 'ANNOUNCEMENT_NOT_FOUND', message: '公告不存在' });
}

// ═══════════════════════════════════════════════════════════════════════════
// 管理端（挂载 /api/admin/announcements）
// ═══════════════════════════════════════════════════════════════════════════

export const adminAnnouncementsRouter = express.Router();

/**
 * 公告管理权限门禁：super / news_editor 可管理。
 * 独立于通用 requireRole，以返回专属错误码 ANNOUNCEMENT_DENIED。
 */
const announcementAccess = [
  adminAuthMiddleware,
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.admin || (req.admin.role !== 'super' && req.admin.role !== 'news_editor')) {
      return res.status(403).json({ success: false, code: 'ANNOUNCEMENT_DENIED', message: '无公告管理权限' });
    }
    next();
  },
] as const;

/**
 * 公告管理列表（全部含已下线，分页可选）。
 * @query page 默认 1；page_size 默认 20，上限 50
 */
adminAnnouncementsRouter.get('/', ...announcementAccess, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.page_size)) || 20));
    const offset = (page - 1) * pageSize;

    const items = await db.all(
      'SELECT id, title, content, cover_url, is_active, created_by, created_at, updated_at FROM announcements ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    const totalRow = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM announcements');

    res.json({
      success: true,
      data: { items: items ?? [], total: totalRow?.c ?? 0, page, page_size: pageSize },
    });
  } catch (error) {
    console.error('[Announcements] admin list error:', error);
    res.status(500).json({ success: false, message: '获取公告列表失败' });
  }
});

/**
 * 创建公告。创建即上线（is_active=1），下线走 /:id/toggle。
 */
adminAnnouncementsRouter.post('/', ...announcementAccess, async (req, res) => {
  try {
    const check = validateAnnouncementPayload(req.body);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: 'ANNOUNCEMENT_FIELDS_INVALID', message: '公告字段校验失败：标题必填且≤100字、正文必填且≤5000字、封面URL须为http(s)链接且≤500字符' });
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.run(
      `INSERT INTO announcements (id, title, content, cover_url, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, check.title, check.content, check.cover_url, req.admin!.id, nowIso, nowIso]
    );

    await logAdminAction(req.admin!, 'create_announcement', 'announcement', id, { title: check.title }, req.ip || undefined);
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    console.error('[Announcements] create error:', error);
    res.status(500).json({ success: false, message: '创建公告失败' });
  }
});

/**
 * 编辑公告：同创建校验；updated_at 刷新为当前时间。
 */
adminAnnouncementsRouter.put('/:id', ...announcementAccess, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM announcements WHERE id = ?', req.params.id);
    if (!existing) {
      return respondNotFound(res);
    }

    const check = validateAnnouncementPayload(req.body);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: 'ANNOUNCEMENT_FIELDS_INVALID', message: '公告字段校验失败：标题必填且≤100字、正文必填且≤5000字、封面URL须为http(s)链接且≤500字符' });
    }

    await db.run(
      'UPDATE announcements SET title = ?, content = ?, cover_url = ?, updated_at = ? WHERE id = ?',
      [check.title, check.content, check.cover_url, new Date().toISOString(), existing.id]
    );

    await logAdminAction(req.admin!, 'update_announcement', 'announcement', existing.id, { title: check.title }, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[Announcements] update error:', error);
    res.status(500).json({ success: false, message: '更新公告失败' });
  }
});

/**
 * 上线/下线翻转：is_active 1↔0，返回翻转后的新状态。
 */
adminAnnouncementsRouter.put('/:id/toggle', ...announcementAccess, async (req, res) => {
  try {
    const existing = await db.get<{ id: string; is_active: number }>(
      'SELECT id, is_active FROM announcements WHERE id = ?',
      req.params.id
    );
    if (!existing) {
      return respondNotFound(res);
    }

    const nextActive = existing.is_active === 1 ? 0 : 1;
    await db.run('UPDATE announcements SET is_active = ?, updated_at = ? WHERE id = ?', [
      nextActive,
      new Date().toISOString(),
      existing.id,
    ]);

    await logAdminAction(
      req.admin!,
      nextActive === 1 ? 'publish_announcement' : 'unpublish_announcement',
      'announcement',
      existing.id,
      undefined,
      req.ip || undefined
    );
    res.json({ success: true, data: { is_active: nextActive } });
  } catch (error) {
    console.error('[Announcements] toggle error:', error);
    res.status(500).json({ success: false, message: '切换公告状态失败' });
  }
});

/**
 * 删除公告（硬删）。
 */
adminAnnouncementsRouter.delete('/:id', ...announcementAccess, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM announcements WHERE id = ?', req.params.id);
    if (!existing) {
      return respondNotFound(res);
    }

    await db.run('DELETE FROM announcements WHERE id = ?', existing.id);

    await logAdminAction(req.admin!, 'delete_announcement', 'announcement', existing.id, undefined, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[Announcements] delete error:', error);
    res.status(500).json({ success: false, message: '删除公告失败' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 公开端（挂载 /api/announcements）
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();

/**
 * 公开公告列表：仅 is_active=1，created_at 倒序。
 * 不含 created_by（内部管理员 ID 不对外暴露）。
 */
router.get('/', announcementReadLimiter, async (req, res) => {
  try {
    const items = await db.all(
      'SELECT id, title, content, cover_url, created_at, updated_at FROM announcements WHERE is_active = 1 ORDER BY created_at DESC'
    );
    res.json({ success: true, data: items ?? [] });
  } catch (error) {
    console.error('[Announcements] public list error:', error);
    res.status(500).json({ success: false, message: '获取公告列表失败' });
  }
});

export default router;
