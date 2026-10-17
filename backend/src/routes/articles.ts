/**
 * @file articles.ts
 * @description 文章业务路由模块。
 *              提供文章列表、详情、Markdown 原文读取、点赞、浏览量统计等接口。
 *              文章正文以 Markdown 文件形式存储于本地文件系统。
 *              V3.0.0：评论统一迁移至 /api/comments（subject_type=article）。
 */
import express from 'express';
import { db } from '../db';
import path from 'path';
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail';
import { loadAuthUser } from '../services/authService';

const router = express.Router();

/**
 * 获取文章列表（按发布时间倒序）。
 * V4.0.0：新增 ?board_id= 筛选（值须为论坛三大板块 id：aviation/railway/road），
 * 并在返回字段中附带 type/board_id 供前端区分专栏与新闻（type='news'）。
 * 仅返回列表展示所需字段（不含正文），tags 字段反序列化为数组。
 */
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT id, title, excerpt, cover_image, author, published_at, read_count, like_count, comment_count, tags, type, board_id FROM articles WHERE 1=1';
    const params: (string | number)[] = [];
    // 板块筛选：可选参数，传入时仅返回归属该板块的文章
    if (typeof req.query.board_id === 'string' && req.query.board_id.trim()) {
      sql += ' AND board_id = ?';
      params.push(req.query.board_id.trim());
    }
    sql += ' ORDER BY published_at DESC';
    const articles = await db.all(sql, params);

    const result = articles.map((article: any) => {
      let tags: string[] = [];
      if (article.tags) {
        try {
          tags = JSON.parse(article.tags);
        } catch {
          // 旧数据兼容：tags 可能是空格分隔字符串
          tags = article.tags.split(' ').filter(Boolean);
        }
      }
      return { ...article, tags };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ success: false, message: '获取文章列表失败' });
  }
});

/**
 * 获取文章详情（元数据，不含正文）。
 * 返回 articles 表完整字段，tags 反序列化为数组。
 * @param id 文章 ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const article = await db.get('SELECT * FROM articles WHERE id = ?', id);

    if (!article) {
      return res.status(404).json({ success: false, message: '文章不存在' });
    }

    res.json({
      success: true,
      data: {
        ...article,
        tags: article.tags ? JSON.parse(article.tags) : [],
      },
    });
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ success: false, message: '获取文章详情失败' });
  }
});

/**
 * 获取文章 Markdown 正文内容。
 * 根据文章 content_path 字段定位本地文件并读取文本内容返回。
 * @param id 文章 ID
 * @returns Markdown 原文字符串
 */
router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const article = await db.get('SELECT content_path FROM articles WHERE id = ?', id);

    if (!article) {
      return res.status(404).json({ success: false, message: '文章不存在' });
    }

    const contentPath = article.content_path;
    // 文章 Markdown 文件存放于项目根目录下的 articles 目录
    const filePath = path.join(__dirname, '../../..', contentPath);

    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文章内容文件不存在' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, data: content });
  } catch (error) {
    console.error('Error fetching article content:', error);
    res.status(500).json({ success: false, message: '获取文章内容失败' });
  }
});

/**
 * 文章点赞（V2.0.0：须邮箱确权的登录用户）。
 * 身份取自 JWT，基于文章 ID + 用户 ID 联合主键去重，重复点赞幂等返回当前计数。
 * @param id 文章 ID
 * @returns 最新点赞数
 */
router.post('/:id/like', requireVerifiedEmail, async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = await loadAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: '请先登录' });
    }

    // 已点赞：幂等返回当前点赞数
    const existingLike = await db.get('SELECT * FROM article_likes WHERE article_id = ? AND user_id = ?', id, user.id);

    if (existingLike) {
      const currentArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);
      return res.json({ success: true, data: { like_count: currentArticle?.like_count || 0 } });
    }

    // 未点赞：写入记录并累加 like_count
    await db.run('INSERT INTO article_likes (article_id, user_id) VALUES (?, ?)', id, user.id);
    await db.run('UPDATE articles SET like_count = like_count + 1 WHERE id = ?', id);
    const updatedArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);

    res.json({ success: true, data: { like_count: updatedArticle?.like_count || 0 } });
  } catch (error) {
    console.error('Error liking article:', error);
    res.status(500).json({ success: false, message: '点赞失败' });
  }
});

/**
 * 取消文章点赞（V2.0.0：须邮箱确权的登录用户）。
 * 与点赞接口对称，未点赞时幂等返回；已点赞则删除记录并扣减计数（MAX(0, ...) 防止负数）。
 */
router.delete('/:id/like', requireVerifiedEmail, async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = await loadAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: '请先登录' });
    }

    const existingLike = await db.get('SELECT * FROM article_likes WHERE article_id = ? AND user_id = ?', id, user.id);

    if (!existingLike) {
      const currentArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);
      return res.json({ success: true, data: { like_count: currentArticle?.like_count || 0 } });
    }

    await db.run('DELETE FROM article_likes WHERE article_id = ? AND user_id = ?', id, user.id);
    // MAX(0, like_count - 1) 防止并发或异常情况下计数变为负数
    await db.run('UPDATE articles SET like_count = MAX(0, like_count - 1) WHERE id = ?', id);
    const updatedArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);

    res.json({ success: true, data: { like_count: updatedArticle?.like_count || 0 } });
  } catch (error) {
    console.error('Error unliking article:', error);
    res.status(500).json({ success: false, message: '取消点赞失败' });
  }
});

/**
 * 累加文章阅读量。
 * 前端在阅读文章时调用，独立于详情接口的访问统计。
 */
router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    await db.run('UPDATE articles SET read_count = read_count + 1 WHERE id = ?', id);
    const updatedArticle = await db.get('SELECT read_count FROM articles WHERE id = ?', id);

    res.json({ success: true, data: { read_count: updatedArticle?.read_count || 0 } });
  } catch (error) {
    console.error('Error incrementing view:', error);
    res.status(500).json({ success: false, message: '更新浏览量失败' });
  }
});

export default router;
