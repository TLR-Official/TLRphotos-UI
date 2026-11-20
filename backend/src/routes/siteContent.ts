/**
 * @file siteContent.ts（V4.15.0，Q13/Q14）
 * @description 站点内容后台可维护：合作伙伴与规则文件链接。
 *
 *              公开端（默认导出，挂载于 /api）：
 *              - GET /partners    仅返回 is_active=1 的合作伙伴，按 sort_order 升序；
 *              - GET /rule-files  仅返回 is_active=1 的规则文件，按 sort_order 升序。
 *
 *              管理端（导出 adminSiteContentRouter，挂载于 /api/admin/site-content）：
 *              - GET/POST/PUT/DELETE /partners
 *              - GET/POST/PUT/DELETE /rule-files
 *              - PUT /partners/:id/toggle、PUT /rule-files/:id/toggle 上下线
 *              权限：super / news_editor，其他管理角色 403 SITE_CONTENT_DENIED。
 */
import express from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { logAdminAction } from '../services/adminService';
import { createRateLimiter } from '../middleware/rateLimit';

/** 公开读取限速：与照片/公告公开接口同口径 */
const siteContentReadLimiter = createRateLimiter({ max: 120, message: '请求过于频繁，请稍后再试' });

/** 名称/标题长度上限 */
const TITLE_MAX = 100;
/** 简介/说明长度上限 */
const DESCRIPTION_MAX = 1000;
/** 链接长度上限 */
const URL_MAX = 500;
/** LOGO 文案长度上限 */
const LOGO_TEXT_MAX = 16;
/** 体积/版本文案长度上限 */
const SHORT_TEXT_MAX = 50;

/** 链接校验：http(s) 绝对地址或站内绝对路径 */
function isValidLink(value: string): boolean {
  return /^https?:\/\/.+/.test(value) || value.startsWith('/');
}

/** 归一化 sort_order：整数，默认 0 */
function normalizeSortOrder(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : 0;
}

/** 管理端权限门禁：super / news_editor */
const siteContentAccess = [
  adminAuthMiddleware,
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.admin || (req.admin.role !== 'super' && req.admin.role !== 'news_editor')) {
      return res.status(403).json({ success: false, code: 'SITE_CONTENT_DENIED', message: '无站点内容管理权限' });
    }
    next();
  },
] as const;

/** 合作伙伴载荷 */
interface PartnerPayload {
  name: string;
  description: string;
  logo_url: string | null;
  logo_text: string | null;
  sort_order: number;
}

/** 规则文件载荷 */
interface RuleFilePayload {
  title: string;
  description: string;
  url: string;
  size_text: string | null;
  version_text: string | null;
  sort_order: number;
}

/** 校验合作伙伴载荷 */
function validatePartner(body: unknown): { ok: true; value: PartnerPayload } | { ok: false; message: string } {
  const raw = (body || {}) as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!name || name.length > TITLE_MAX) return { ok: false, message: '名称必填且不超过 100 字' };
  if (description.length > DESCRIPTION_MAX) return { ok: false, message: '简介不超过 1000 字' };

  let logoUrl: string | null = null;
  if (raw.logo_url !== undefined && raw.logo_url !== null && String(raw.logo_url).trim() !== '') {
    const value = String(raw.logo_url).trim();
    if (typeof raw.logo_url !== 'string' || value.length > URL_MAX || !isValidLink(value)) {
      return { ok: false, message: 'LOGO 地址须为 http(s) 链接或站内路径且不超过 500 字符' };
    }
    logoUrl = value;
  }
  const logoText = typeof raw.logo_text === 'string' && raw.logo_text.trim()
    ? raw.logo_text.trim().slice(0, LOGO_TEXT_MAX)
    : null;

  return { ok: true, value: { name, description, logo_url: logoUrl, logo_text: logoText, sort_order: normalizeSortOrder(raw.sort_order) } };
}

/** 校验规则文件载荷 */
function validateRuleFile(body: unknown): { ok: true; value: RuleFilePayload } | { ok: false; message: string } {
  const raw = (body || {}) as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!title || title.length > TITLE_MAX) return { ok: false, message: '标题必填且不超过 100 字' };
  if (description.length > DESCRIPTION_MAX) return { ok: false, message: '说明不超过 1000 字' };
  if (!url || url.length > URL_MAX || !isValidLink(url)) {
    return { ok: false, message: '文件链接必填，须为 http(s) 链接或站内路径且不超过 500 字符' };
  }
  const sizeText = typeof raw.size_text === 'string' && raw.size_text.trim()
    ? raw.size_text.trim().slice(0, SHORT_TEXT_MAX)
    : null;
  const versionText = typeof raw.version_text === 'string' && raw.version_text.trim()
    ? raw.version_text.trim().slice(0, SHORT_TEXT_MAX)
    : null;

  return { ok: true, value: { title, description, url, size_text: sizeText, version_text: versionText, sort_order: normalizeSortOrder(raw.sort_order) } };
}

// ═══════════════════════════════════════════════════════════════════════════
// 公开端（挂载 /api）
// ═══════════════════════════════════════════════════════════════════════════

const publicRouter = express.Router();

/** 公开合作伙伴列表（仅上线，按排序值升序） */
publicRouter.get('/partners', siteContentReadLimiter, async (_req, res) => {
  try {
    const items = await db.all(
      'SELECT id, name, description, logo_url, logo_text, sort_order FROM partners WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC'
    );
    res.json({ success: true, data: items ?? [] });
  } catch (error) {
    console.error('[SiteContent] public partners error:', error);
    res.status(500).json({ success: false, message: '获取合作伙伴失败' });
  }
});

/** 公开规则文件列表（仅上线，按排序值升序） */
publicRouter.get('/rule-files', siteContentReadLimiter, async (_req, res) => {
  try {
    const items = await db.all(
      'SELECT id, title, description, url, size_text, version_text, sort_order FROM rule_files WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC'
    );
    res.json({ success: true, data: items ?? [] });
  } catch (error) {
    console.error('[SiteContent] public rule files error:', error);
    res.status(500).json({ success: false, message: '获取规则文件失败' });
  }
});

export default publicRouter;

// ═══════════════════════════════════════════════════════════════════════════
// 管理端（挂载 /api/admin/site-content）
// ═══════════════════════════════════════════════════════════════════════════

export const adminSiteContentRouter = express.Router();

// ── 合作伙伴 ──────────────────────────────────────────────────────────────

/** 合作伙伴管理列表（含已下线） */
adminSiteContentRouter.get('/partners', ...siteContentAccess, async (_req, res) => {
  try {
    const items = await db.all(
      'SELECT id, name, description, logo_url, logo_text, sort_order, is_active, created_at, updated_at FROM partners ORDER BY sort_order ASC, created_at ASC'
    );
    res.json({ success: true, data: items ?? [] });
  } catch (error) {
    console.error('[SiteContent] admin partners error:', error);
    res.status(500).json({ success: false, message: '获取合作伙伴列表失败' });
  }
});

/** 新建合作伙伴（默认上线） */
adminSiteContentRouter.post('/partners', ...siteContentAccess, async (req, res) => {
  try {
    const check = validatePartner(req.body);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: 'PARTNER_FIELDS_INVALID', message: check.message });
    }
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.run(
      `INSERT INTO partners (id, name, description, logo_url, logo_text, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, check.value.name, check.value.description, check.value.logo_url, check.value.logo_text, check.value.sort_order, nowIso, nowIso]
    );
    await logAdminAction(req.admin!, 'create_partner', 'partner', id, { name: check.value.name }, req.ip || undefined);
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    console.error('[SiteContent] create partner error:', error);
    res.status(500).json({ success: false, message: '创建合作伙伴失败' });
  }
});

/** 编辑合作伙伴 */
adminSiteContentRouter.put('/partners/:id', ...siteContentAccess, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM partners WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ success: false, code: 'PARTNER_NOT_FOUND', message: '合作伙伴不存在' });

    const check = validatePartner(req.body);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: 'PARTNER_FIELDS_INVALID', message: check.message });
    }
    await db.run(
      `UPDATE partners SET name = ?, description = ?, logo_url = ?, logo_text = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      [check.value.name, check.value.description, check.value.logo_url, check.value.logo_text, check.value.sort_order, new Date().toISOString(), existing.id]
    );
    await logAdminAction(req.admin!, 'update_partner', 'partner', existing.id, { name: check.value.name }, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[SiteContent] update partner error:', error);
    res.status(500).json({ success: false, message: '更新合作伙伴失败' });
  }
});

/** 合作伙伴上线/下线 */
adminSiteContentRouter.put('/partners/:id/toggle', ...siteContentAccess, async (req, res) => {
  try {
    const existing = await db.get<{ id: string; is_active: number }>('SELECT id, is_active FROM partners WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ success: false, code: 'PARTNER_NOT_FOUND', message: '合作伙伴不存在' });
    const nextActive = existing.is_active === 1 ? 0 : 1;
    await db.run('UPDATE partners SET is_active = ?, updated_at = ? WHERE id = ?', [nextActive, new Date().toISOString(), existing.id]);
    await logAdminAction(req.admin!, nextActive === 1 ? 'publish_partner' : 'unpublish_partner', 'partner', existing.id, undefined, req.ip || undefined);
    res.json({ success: true, data: { is_active: nextActive } });
  } catch (error) {
    console.error('[SiteContent] toggle partner error:', error);
    res.status(500).json({ success: false, message: '切换合作伙伴状态失败' });
  }
});

/** 删除合作伙伴 */
adminSiteContentRouter.delete('/partners/:id', ...siteContentAccess, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM partners WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ success: false, code: 'PARTNER_NOT_FOUND', message: '合作伙伴不存在' });
    await db.run('DELETE FROM partners WHERE id = ?', existing.id);
    await logAdminAction(req.admin!, 'delete_partner', 'partner', existing.id, undefined, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[SiteContent] delete partner error:', error);
    res.status(500).json({ success: false, message: '删除合作伙伴失败' });
  }
});

// ── 规则文件 ──────────────────────────────────────────────────────────────

/** 规则文件管理列表（含已下线） */
adminSiteContentRouter.get('/rule-files', ...siteContentAccess, async (_req, res) => {
  try {
    const items = await db.all(
      'SELECT id, title, description, url, size_text, version_text, sort_order, is_active, created_at, updated_at FROM rule_files ORDER BY sort_order ASC, created_at ASC'
    );
    res.json({ success: true, data: items ?? [] });
  } catch (error) {
    console.error('[SiteContent] admin rule files error:', error);
    res.status(500).json({ success: false, message: '获取规则文件列表失败' });
  }
});

/** 新建规则文件链接（默认上线） */
adminSiteContentRouter.post('/rule-files', ...siteContentAccess, async (req, res) => {
  try {
    const check = validateRuleFile(req.body);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: 'RULE_FILE_FIELDS_INVALID', message: check.message });
    }
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.run(
      `INSERT INTO rule_files (id, title, description, url, size_text, version_text, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, check.value.title, check.value.description, check.value.url, check.value.size_text, check.value.version_text, check.value.sort_order, nowIso, nowIso]
    );
    await logAdminAction(req.admin!, 'create_rule_file', 'rule_file', id, { title: check.value.title }, req.ip || undefined);
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    console.error('[SiteContent] create rule file error:', error);
    res.status(500).json({ success: false, message: '创建规则文件失败' });
  }
});

/** 编辑规则文件 */
adminSiteContentRouter.put('/rule-files/:id', ...siteContentAccess, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM rule_files WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ success: false, code: 'RULE_FILE_NOT_FOUND', message: '规则文件不存在' });

    const check = validateRuleFile(req.body);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: 'RULE_FILE_FIELDS_INVALID', message: check.message });
    }
    await db.run(
      `UPDATE rule_files SET title = ?, description = ?, url = ?, size_text = ?, version_text = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      [check.value.title, check.value.description, check.value.url, check.value.size_text, check.value.version_text, check.value.sort_order, new Date().toISOString(), existing.id]
    );
    await logAdminAction(req.admin!, 'update_rule_file', 'rule_file', existing.id, { title: check.value.title }, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[SiteContent] update rule file error:', error);
    res.status(500).json({ success: false, message: '更新规则文件失败' });
  }
});

/** 规则文件上线/下线（下线即「撤销前端链接」） */
adminSiteContentRouter.put('/rule-files/:id/toggle', ...siteContentAccess, async (req, res) => {
  try {
    const existing = await db.get<{ id: string; is_active: number }>('SELECT id, is_active FROM rule_files WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ success: false, code: 'RULE_FILE_NOT_FOUND', message: '规则文件不存在' });
    const nextActive = existing.is_active === 1 ? 0 : 1;
    await db.run('UPDATE rule_files SET is_active = ?, updated_at = ? WHERE id = ?', [nextActive, new Date().toISOString(), existing.id]);
    await logAdminAction(req.admin!, nextActive === 1 ? 'publish_rule_file' : 'unpublish_rule_file', 'rule_file', existing.id, undefined, req.ip || undefined);
    res.json({ success: true, data: { is_active: nextActive } });
  } catch (error) {
    console.error('[SiteContent] toggle rule file error:', error);
    res.status(500).json({ success: false, message: '切换规则文件状态失败' });
  }
});

/** 删除规则文件 */
adminSiteContentRouter.delete('/rule-files/:id', ...siteContentAccess, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM rule_files WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ success: false, code: 'RULE_FILE_NOT_FOUND', message: '规则文件不存在' });
    await db.run('DELETE FROM rule_files WHERE id = ?', existing.id);
    await logAdminAction(req.admin!, 'delete_rule_file', 'rule_file', existing.id, undefined, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[SiteContent] delete rule file error:', error);
    res.status(500).json({ success: false, message: '删除规则文件失败' });
  }
});
