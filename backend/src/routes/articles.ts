import express from 'express';
import { db } from '../db';
import path from 'path';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const articles = await db.all('SELECT id, title, excerpt, cover_image, author, published_at, read_count, like_count, comment_count, tags FROM articles ORDER BY published_at DESC');

    const result = articles.map((article: any) => {
      let tags: string[] = [];
      if (article.tags) {
        try {
          tags = JSON.parse(article.tags);
        } catch {
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

router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const article = await db.get('SELECT content_path FROM articles WHERE id = ?', id);

    if (!article) {
      return res.status(404).json({ success: false, message: '文章不存在' });
    }

    const contentPath = article.content_path;
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

router.post('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'anonymous' } = req.body || {};

    const existingLike = await db.get('SELECT * FROM article_likes WHERE article_id = ? AND user_id = ?', id, userId);

    if (existingLike) {
      const currentArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);
      return res.json({ success: true, data: { like_count: currentArticle?.like_count || 0 } });
    }

    await db.run('INSERT INTO article_likes (article_id, user_id) VALUES (?, ?)', id, userId);
    await db.run('UPDATE articles SET like_count = like_count + 1 WHERE id = ?', id);
    const updatedArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);

    res.json({ success: true, data: { like_count: updatedArticle?.like_count || 0 } });
  } catch (error) {
    console.error('Error liking article:', error);
    res.status(500).json({ success: false, message: '点赞失败' });
  }
});

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
    await db.run('UPDATE articles SET like_count = MAX(0, like_count - 1) WHERE id = ?', id);
    const updatedArticle = await db.get('SELECT like_count FROM articles WHERE id = ?', id);

    res.json({ success: true, data: { like_count: updatedArticle?.like_count || 0 } });
  } catch (error) {
    console.error('Error unliking article:', error);
    res.status(500).json({ success: false, message: '取消点赞失败' });
  }
});

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

router.post('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { author = '访客', content } = req.body || {};

    if (!content) {
      return res.status(400).json({ success: false, message: '评论内容不能为空' });
    }

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
    await db.run('UPDATE articles SET comment_count = comment_count + 1 WHERE id = ?', id);

    res.json({ success: true, data: newComment });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ success: false, message: '发表评论失败' });
  }
});

export default router;
