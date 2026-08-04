/**
 * @file articles.ts
 * @description 文章业务路由模块。
 *              提供文章列表、详情、Markdown 原文读取、点赞、浏览量统计、
 *              评论列表与发表评论等接口。文章正文以 Markdown 文件形式存储于本地文件系统。
 */
import express from 'express';
import { db } from '../db';
import path from 'path';

const router = express.Router();

/**
 * 获取文章列表（按发布时间倒序）。
 * 仅返回列表展示所需字段（不含正文），tags 字段反序列化为数组。
 */
router.get('/', async (req, res) => {
  try {
    const articles = await db.all('SELECT id, title, excerpt, cover_image, author, published_at, read_count, like_count, comment_count, tags FROM articles ORDER BY published_at DESC');

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
 * 文章点赞。
 * 基于文章 ID + 用户 ID 联合主键去重，重复点赞幂等返回当前计数。
 * @param id 文章 ID
 * @body userId 用户 ID，未传时记为 anonymous
 * @returns 最新点赞数
 */
router.post('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'anonymous' } = req.body || {};

    // 已点赞：幂等返回当前点赞数
    const existingLike = await db.get('SELECT * FROM article_likes WHERE article_id = ? AND user_id = ?', id, userId);

    if (existingLike) {
      const currentArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);
      return res.json({ success: true, data: { like_count: currentArticle?.like_count || 0 } });
    }

    // 未点赞：写入记录并累加 like_count
    await db.run('INSERT INTO article_likes (article_id, user_id) VALUES (?, ?)', id, userId);
    await db.run('UPDATE articles SET like_count = like_count + 1 WHERE id = ?', id);
    const updatedArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);

    res.json({ success: true, data: { like_count: updatedArticle?.like_count || 0 } });
  } catch (error) {
    console.error('Error liking article:', error);
    res.status(500).json({ success: false, message: '点赞失败' });
  }
});

/**
 * 取消文章点赞。
 * 与点赞接口对称，未点赞时幂等返回；已点赞则删除记录并扣减计数（MAX(0, ...) 防止负数）。
 */
router.delete('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'anonymous' } = req.body || {};

    const existingLike = await db.get('SELECT * FROM article_likes WHERE article_id = ? AND user_id = ?', id, userId);

    if (!existingLike) {
      const currentArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);
      return res.json({ success: true, data: { like_count: currentArticle?.like_count || 0 } });
    }

    await db.run('DELETE FROM article_likes WHERE article_id = ? AND user_id = ?', id, userId);
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

/**
 * 获取文章评论列表（按时间倒序）。
 * @param id 文章 ID
 */
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const comments = await db.all('SELECT id, author, content, created_at FROM comments WHERE article_id = ? ORDER BY created_at DESC', id);

    res.json({ success: true, data: comments });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ success: false, message: '获取评论失败' });
  }
});

/**
 * 发表文章评论。
 * 校验内容非空后写入评论表，并同步累加文章 comment_count。
 * @param id 文章 ID
 * @body author 评论者名称（默认访客）
 * @body content 评论内容
 */
router.post('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { author = '访客', content } = req.body || {};

    if (!content) {
      return res.status(400).json({ success: false, message: '评论内容不能为空' });
    }

    // 评论 ID 使用时间戳生成，保证单进程内唯一
    const newComment = {
      id: `comment_${Date.now()}`,
      article_id: id,
      author,
      content,
      created_at: new Date().toISOString(),
    };

    await db.run(
      'INSERT INTO comments (id, article_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)',
      newComment.id,
      newComment.article_id,
      newComment.author,
      newComment.content,
      newComment.created_at
    );
    // 同步累加文章评论计数
    await db.run('UPDATE articles SET comment_count = comment_count + 1 WHERE id = ?', id);

    res.json({ success: true, data: newComment });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ success: false, message: '发表评论失败' });
  }
});

export default router;
