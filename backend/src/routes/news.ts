/**
 * @file news.ts（V4.0.0）
 * @description 新闻区路由模块：新闻落 articles 表（type='news'），配图关联 news_images。
 *
 *              管理端（本文件导出 adminNewsRouter，挂载于 /api/admin/news）：
 *              - POST   /       创建新闻（标题≤200、正文必填、板块白名单、配图授权确认）
 *              - PUT    /:id    编辑新闻（同校验；配图全删全插，事务内）
 *              - GET    /       新闻管理列表（分页，含作者与配图数）
 *              - DELETE /:id    删除新闻（硬删，news_images 级联清理）
 *              权限：requireRole(['super','news_editor'])，其他管理角色一律 403。
 *
 *              公开端（默认导出，挂载于 /api/news，120 次/分限速）：
 *              - GET /       公开新闻列表（含封面首图代理 URL）
 *              - GET /:id    公开新闻详情（配图代理 URL 数组 + 版权声明）
 *
 *              配图规范：photo_id 必须为已审核通过（approved）的照片，且每张配图
 *              均须 authorization_confirmed=true（未确认授权返回 400 AUTHORIZATION_REQUIRED）。
 *              新闻正文以 Markdown 文件形式写入 articles/news/（与专栏 content_path 语义一致）。
 */
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, CANONICAL_FORUM_BOARDS } from '../db';
import { adminAuthMiddleware, requireRole } from '../middleware/adminAuth';
import { logAdminAction } from '../services/adminService';
import { createRateLimiter } from '../middleware/rateLimit';
import { getProxyUrl } from '../utils/url';

/** 新闻发布板块白名单：首批仅允许航空板块（取自三大基础板块定义，保证 id 一致） */
const NEWS_ALLOWED_BOARD_IDS: string[] = (() => {
  const aviation = CANONICAL_FORUM_BOARDS.find((b) => b.name === '航空');
  return aviation ? [aviation.id] : ['aviation'];
})();

/** 新闻正文 Markdown 存放目录：与 articles.ts /:id/content 的路径解析规则保持一致 */
const NEWS_CONTENT_DIR = path.join(__dirname, '../../..', 'articles', 'news');

/** 标题长度上限 */
const NEWS_TITLE_MAX = 200;

// 公开读取限速：与 photos.ts 公开浏览同款（120 次/分，测试环境自动放行）
const newsReadLimiter = createRateLimiter({ max: 120, message: '浏览过于频繁，请稍后再试' });

/** 管理端权限门禁（POST/PUT/GET/DELETE 共用） */
const newsAdminAccess = [adminAuthMiddleware, requireRole(['super', 'news_editor'])] as const;

/**
 * 将新闻正文写入 Markdown 文件，返回 content_path（供 /api/articles/:id/content 读取）。
 */
function writeNewsContent(articleId: string, content: string): string {
  fs.mkdirSync(NEWS_CONTENT_DIR, { recursive: true });
  const fileName = `${articleId}.md`;
  fs.writeFileSync(path.join(NEWS_CONTENT_DIR, fileName), content, 'utf-8');
  return `/articles/news/${fileName}`;
}

/** 删除新闻正文文件（幂等：文件不存在时静默忽略） */
function removeNewsContent(articleId: string): void {
  try {
    fs.unlinkSync(path.join(NEWS_CONTENT_DIR, `${articleId}.md`));
  } catch {
    // 文件不存在或已删除：忽略
  }
}

/** 由正文生成摘要（去空白后截取前 120 字） */
function buildExcerpt(content: string): string {
  const plain = content.replace(/\s+/g, ' ').trim();
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

/** 配图载荷校验结果 */
type ImagesValidation =
  | { ok: true; photoIds: string[] }
  | { ok: false; code: string; message: string };

/**
 * 校验配图载荷：
 * - images 必填且至少 1 张（400 IMAGES_REQUIRED）
 * - 每项 photo_id 必填、authorization_confirmed 必须为 true（400 AUTHORIZATION_REQUIRED）
 */
function validateImagesPayload(images: unknown): ImagesValidation {
  if (!Array.isArray(images) || images.length < 1) {
    return { ok: false, code: 'IMAGES_REQUIRED', message: '请至少提供一张配图' };
  }
  const photoIds: string[] = [];
  for (const raw of images) {
    const photoId = typeof raw?.photo_id === 'string' ? raw.photo_id.trim() : '';
    if (!photoId) {
      return { ok: false, code: 'IMAGES_REQUIRED', message: '配图 photo_id 不合法' };
    }
    // 授权确认为硬性要求：未勾选一律拒绝入库
    if (raw?.authorization_confirmed !== true) {
      return {
        ok: false,
        code: 'AUTHORIZATION_REQUIRED',
        message: '每张配图均须确认已获得摄影师授权',
      };
    }
    photoIds.push(photoId);
  }
  return { ok: true, photoIds };
}

/**
 * 校验配图照片均存在且已审核通过。
 * @returns 通过返回 null；否则返回错误描述
 */
async function ensurePhotosApproved(photoIds: string[]): Promise<string | null> {
  for (const photoId of photoIds) {
    const photo = await db.get("SELECT id FROM photos WHERE id = ? AND status = 'approved'", photoId);
    if (!photo) {
      return `配图照片不存在或未通过审核：${photoId}`;
    }
  }
  return null;
}

/** 新闻管理端通用错误响应 */
function respondError(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, code, message });
}

// ═══════════════════════════════════════════════════════════════════════════
// 管理端（挂载 /api/admin/news）
// ═══════════════════════════════════════════════════════════════════════════

export const adminNewsRouter = express.Router();

/**
 * 创建新闻。
 * @body title 必填 ≤200 字
 * @body content 必填（Markdown 正文）
 * @body board_id 必填，首批仅允许航空板块（400 BOARD_NOT_ALLOWED）
 * @body images 必填 ≥1 项 [{photo_id, authorization_confirmed:true}]
 */
adminNewsRouter.post('/', ...newsAdminAccess, async (req, res) => {
  try {
    const { title, content, board_id, images } = req.body || {};

    // 标题校验：必填且 ≤200 字
    if (typeof title !== 'string' || !title.trim() || title.length > NEWS_TITLE_MAX) {
      return respondError(res, 400, 'TITLE_INVALID', `标题必填且不可超过 ${NEWS_TITLE_MAX} 字`);
    }
    // 正文校验：必填
    if (typeof content !== 'string' || !content.trim()) {
      return respondError(res, 400, 'CONTENT_REQUIRED', '新闻正文不能为空');
    }
    // 板块校验：首批仅允许航空板块
    if (typeof board_id !== 'string' || !NEWS_ALLOWED_BOARD_IDS.includes(board_id)) {
      return respondError(res, 400, 'BOARD_NOT_ALLOWED', '该板块暂不开放新闻发布，首批仅支持航空板块');
    }
    // 配图载荷校验
    const imagesCheck = validateImagesPayload(images);
    if (!imagesCheck.ok) {
      return respondError(res, 400, imagesCheck.code, imagesCheck.message);
    }
    // 配图照片必须存在且已审核通过
    const photoError = await ensurePhotosApproved(imagesCheck.photoIds);
    if (photoError) {
      return respondError(res, 400, 'PHOTO_INVALID', photoError);
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const authorName = req.admin!.name || req.admin!.username;

    // 正文落盘（失败则整体失败，不产生脏数据）
    let contentPath: string;
    try {
      contentPath = writeNewsContent(id, content);
    } catch (e) {
      console.error('[News] write content failed:', e);
      return respondError(res, 500, 'NEWS_CREATE_FAILED', '创建新闻失败：正文写入异常');
    }

    try {
      await db.exec('BEGIN');
      await db.run(
        `INSERT INTO articles (id, title, excerpt, content_path, author, published_at, read_count, like_count, comment_count, tags, type, board_id)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, 'news', ?)`,
        [id, title.trim(), buildExcerpt(content), contentPath, authorName, nowIso, board_id]
      );
      // 配图批量插入，sort_order 即数组顺序（首位为封面）
      for (let i = 0; i < imagesCheck.photoIds.length; i++) {
        await db.run(
          'INSERT INTO news_images (id, article_id, photo_id, authorization_confirmed, sort_order) VALUES (?, ?, ?, 1, ?)',
          [crypto.randomUUID(), id, imagesCheck.photoIds[i], i]
        );
      }
      await db.exec('COMMIT');
    } catch (txError) {
      await db.exec('ROLLBACK');
      // 数据库失败：回滚已写入的正文文件，避免脏文件残留
      removeNewsContent(id);
      throw txError;
    }

    await logAdminAction(req.admin!, 'create_news', 'article', id, { title: title.trim(), board_id }, req.ip || undefined);
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    console.error('[News] create error:', error);
    res.status(500).json({ success: false, message: '创建新闻失败' });
  }
});

/**
 * 编辑新闻：同创建校验；配图全删全插（事务内保证一致性）。
 * 作者保留创建者不变；正文文件按文章 id 覆盖写。
 */
adminNewsRouter.put('/:id', ...newsAdminAccess, async (req, res) => {
  try {
    const article = await db.get("SELECT id FROM articles WHERE id = ? AND type = 'news'", req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: '新闻不存在' });
    }

    const { title, content, board_id, images } = req.body || {};

    if (typeof title !== 'string' || !title.trim() || title.length > NEWS_TITLE_MAX) {
      return respondError(res, 400, 'TITLE_INVALID', `标题必填且不可超过 ${NEWS_TITLE_MAX} 字`);
    }
    if (typeof content !== 'string' || !content.trim()) {
      return respondError(res, 400, 'CONTENT_REQUIRED', '新闻正文不能为空');
    }
    if (typeof board_id !== 'string' || !NEWS_ALLOWED_BOARD_IDS.includes(board_id)) {
      return respondError(res, 400, 'BOARD_NOT_ALLOWED', '该板块暂不开放新闻发布，首批仅支持航空板块');
    }
    const imagesCheck = validateImagesPayload(images);
    if (!imagesCheck.ok) {
      return respondError(res, 400, imagesCheck.code, imagesCheck.message);
    }
    const photoError = await ensurePhotosApproved(imagesCheck.photoIds);
    if (photoError) {
      return respondError(res, 400, 'PHOTO_INVALID', photoError);
    }

    // 正文覆盖写（同 id 同文件，旧内容被替换）
    let contentPath: string;
    try {
      contentPath = writeNewsContent(article.id, content);
    } catch (e) {
      console.error('[News] write content failed:', e);
      return respondError(res, 500, 'NEWS_UPDATE_FAILED', '更新新闻失败：正文写入异常');
    }

    try {
      await db.exec('BEGIN');
      await db.run(
        'UPDATE articles SET title = ?, excerpt = ?, content_path = ?, board_id = ? WHERE id = ?',
        [title.trim(), buildExcerpt(content), contentPath, board_id, article.id]
      );
      // 配图全删全插：编辑后的图序以本次数组顺序为准
      await db.run('DELETE FROM news_images WHERE article_id = ?', article.id);
      for (let i = 0; i < imagesCheck.photoIds.length; i++) {
        await db.run(
          'INSERT INTO news_images (id, article_id, photo_id, authorization_confirmed, sort_order) VALUES (?, ?, ?, 1, ?)',
          [crypto.randomUUID(), article.id, imagesCheck.photoIds[i], i]
        );
      }
      await db.exec('COMMIT');
    } catch (txError) {
      await db.exec('ROLLBACK');
      throw txError;
    }

    await logAdminAction(req.admin!, 'update_news', 'article', article.id, { title: title.trim(), board_id }, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[News] update error:', error);
    res.status(500).json({ success: false, message: '更新新闻失败' });
  }
});

/**
 * 新闻管理列表（分页）：联作者（articles.author 即创建管理员名）与配图数。
 * @query page 默认 1；page_size 默认 20，上限 50
 */
adminNewsRouter.get('/', ...newsAdminAccess, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.page_size)) || 20));
    const offset = (page - 1) * pageSize;

    const items = await db.all(
      `SELECT a.id, a.title, a.excerpt, a.author, a.published_at, a.board_id,
              (SELECT COUNT(*) FROM news_images ni WHERE ni.article_id = a.id) AS image_count
       FROM articles a WHERE a.type = 'news'
       ORDER BY a.published_at DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    const totalRow = await db.get("SELECT COUNT(*) AS c FROM articles WHERE type = 'news'");

    res.json({
      success: true,
      data: { items, total: totalRow?.c ?? 0, page, page_size: pageSize },
    });
  } catch (error) {
    console.error('[News] admin list error:', error);
    res.status(500).json({ success: false, message: '获取新闻列表失败' });
  }
});

/**
 * 删除新闻（硬删，与 articles 无既有删除模式保持一致的直接删除）：
 * 事务内先删 news_images（外键亦有级联兜底），再删 articles 行；正文文件幂等清理。
 */
adminNewsRouter.delete('/:id', ...newsAdminAccess, async (req, res) => {
  try {
    const article = await db.get("SELECT id FROM articles WHERE id = ? AND type = 'news'", req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: '新闻不存在' });
    }

    await db.exec('BEGIN');
    try {
      await db.run('DELETE FROM news_images WHERE article_id = ?', article.id);
      await db.run('DELETE FROM articles WHERE id = ?', article.id);
      await db.exec('COMMIT');
    } catch (txError) {
      await db.exec('ROLLBACK');
      throw txError;
    }
    removeNewsContent(article.id);

    await logAdminAction(req.admin!, 'delete_news', 'article', article.id, undefined, req.ip || undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('[News] delete error:', error);
    res.status(500).json({ success: false, message: '删除新闻失败' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 公开端（挂载 /api/news）
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();

/**
 * 公开新闻列表（分页，按发布时间倒序）。
 * 返回 id/title/board_id/author_name/created_at/摘要/封面首图代理 URL。
 */
router.get('/', newsReadLimiter, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.page_size)) || 10));
    const offset = (page - 1) * pageSize;

    // 封面取 sort_order 最小的配图，联 photos 取图片路径后改写为代理 URL
    const items = await db.all(
      `SELECT a.id, a.title, a.excerpt, a.author AS author_name, a.published_at AS created_at, a.board_id,
              cover.photo_id AS cover_photo_id, cover_photo.thumbnail_path AS cover_thumbnail,
              cover_photo.preview_url AS cover_preview, cover_photo.watermarked_url AS cover_watermarked
       FROM articles a
       LEFT JOIN (
         SELECT ni.article_id, ni.photo_id
         FROM news_images ni
         WHERE ni.sort_order = (SELECT MIN(ni2.sort_order) FROM news_images ni2 WHERE ni2.article_id = ni.article_id)
       ) cover ON cover.article_id = a.id
       LEFT JOIN photos cover_photo ON cover_photo.id = cover.photo_id
       WHERE a.type = 'news'
       ORDER BY a.published_at DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    const totalRow = await db.get("SELECT COUNT(*) AS c FROM articles WHERE type = 'news'");

    const data = items.map((row: any) => ({
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
      board_id: row.board_id,
      author_name: row.author_name,
      created_at: row.created_at,
      // 封面代理 URL：优先预览图，其次水印图，最后缩略图
      cover_image:
        row.cover_photo_id
          ? getProxyUrl(row.cover_preview || row.cover_watermarked || row.cover_thumbnail, row.cover_photo_id)
          : null,
    }));

    res.json({
      success: true,
      data: { items: data, total: totalRow?.c ?? 0, page, page_size: pageSize },
    });
  } catch (error) {
    console.error('[News] public list error:', error);
    res.status(500).json({ success: false, message: '获取新闻列表失败' });
  }
});

/**
 * 公开新闻详情：含配图数组（photo_id + 缩略/预览代理 URL + 照片标题）与版权声明。
 * 版权声明由后端拼好：`@{作者名} ©TLRphotos {当前年} 版权所有`
 */
router.get('/:id', newsReadLimiter, async (req, res) => {
  try {
    const article = await db.get("SELECT * FROM articles WHERE id = ? AND type = 'news'", req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: '新闻不存在' });
    }

    const imageRows = await db.all(
      `SELECT ni.photo_id, ni.sort_order, p.title AS photo_title,
              p.thumbnail_path, p.preview_url, p.watermarked_url
       FROM news_images ni
       LEFT JOIN photos p ON p.id = ni.photo_id
       WHERE ni.article_id = ?
       ORDER BY ni.sort_order ASC`,
      article.id
    );

    const images = imageRows.map((row: any) => ({
      photo_id: row.photo_id,
      title: row.photo_title ?? null,
      thumbnail_url: row.thumbnail_path ? getProxyUrl(row.thumbnail_path, row.photo_id) : null,
      preview_url: row.preview_url
        ? getProxyUrl(row.preview_url, row.photo_id)
        : row.watermarked_url
          ? getProxyUrl(row.watermarked_url, row.photo_id)
          : null,
    }));

    const authorName = article.author;
    res.json({
      success: true,
      data: {
        id: article.id,
        title: article.title,
        excerpt: article.excerpt,
        content_path: article.content_path,
        board_id: article.board_id,
        author_name: authorName,
        created_at: article.published_at,
        images,
        // 版权声明：后端拼好，前端直接展示
        copyright_notice: `@${authorName} ©TLRphotos ${new Date().getFullYear()} 版权所有`,
      },
    });
  } catch (error) {
    console.error('[News] public detail error:', error);
    res.status(500).json({ success: false, message: '获取新闻详情失败' });
  }
});

export default router;
