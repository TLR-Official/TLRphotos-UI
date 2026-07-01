import { request } from './client';
import type { Article as ArticleType, Column as ColumnType } from '../features/column/types';
import { mockArticles, mockColumn } from '../features/column/mockData';

export type Article = ArticleType;
export type Column = ColumnType;

export async function getArticles(): Promise<{ success: boolean; data?: Article[]; message?: string }> {
  const response = await request<Article[]>('/articles');
  if (response.success && response.data) {
    return response;
  }
  return { success: true, data: mockArticles };
}

export async function getArticleById(id: string): Promise<{ success: boolean; data?: Article; message?: string }> {
  const response = await request<Article>(`/articles/${id}`);
  if (response.success && response.data) {
    return response;
  }
  const mockData = mockArticles.find((a) => a.id === id);
  return mockData ? { success: true, data: mockData } : { success: false, message: '文章不存在' };
}

export async function getArticleContent(contentPath: string): Promise<{ success: boolean; data?: string; message?: string }> {
  try {
    const response = await fetch(contentPath);
    if (!response.ok) {
      return { success: false, message: '文章内容加载失败' };
    }
    const text = await response.text();
    return { success: true, data: text };
  } catch (error) {
    console.error('Failed to load article content:', error);
    return { success: false, message: '网络请求失败' };
  }
}

export async function getColumn(): Promise<{ success: boolean; data?: Column; message?: string }> {
  const response = await request<Column>('/column');
  if (response.success && response.data) {
    return response;
  }
  return { success: true, data: mockColumn };
}

export async function likeArticle(id: string): Promise<{ success: boolean; data?: { like_count: number }; message?: string }> {
  const response = await request<{ like_count: number }>(`/articles/${id}/like`, {
    method: 'POST',
  });
  if (response.success && response.data) {
    return response;
  }
  const article = mockArticles.find((a) => a.id === id);
  if (article) {
    return { success: true, data: { like_count: article.like_count + 1 } };
  }
  return { success: false, message: '操作失败' };
}

export async function unlikeArticle(id: string): Promise<{ success: boolean; data?: { like_count: number }; message?: string }> {
  const response = await request<{ like_count: number }>(`/articles/${id}/like`, {
    method: 'DELETE',
  });
  if (response.success && response.data) {
    return response;
  }
  const article = mockArticles.find((a) => a.id === id);
  if (article) {
    return { success: true, data: { like_count: Math.max(0, article.like_count - 1) } };
  }
  return { success: false, message: '操作失败' };
}

export async function incrementArticleView(id: string): Promise<{ success: boolean; data?: { read_count: number }; message?: string }> {
  const response = await request<{ read_count: number }>(`/articles/${id}/view`, {
    method: 'POST',
  });
  if (response.success && response.data) {
    return response;
  }
  const article = mockArticles.find((a) => a.id === id);
  if (article) {
    return { success: true, data: { read_count: article.read_count + 1 } };
  }
  return { success: false, message: '操作失败' };
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  created_at: string;
}

export async function getComments(articleId: string): Promise<{ success: boolean; data?: Comment[]; message?: string }> {
  const response = await request<Comment[]>(`/articles/${articleId}/comments`);
  if (response.success && response.data) {
    return response;
  }
  const mockComments: Comment[] = [
    {
      id: 'comment_001',
      author: '摄影爱好者',
      content: '这篇文章太棒了！',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'comment_002',
      author: '技术达人',
      content: '公式渲染特别清晰！',
      created_at: new Date(Date.now() - 7200000).toISOString(),
    },
  ];
  return { success: true, data: mockComments };
}

export async function createComment(articleId: string, content: string): Promise<{ success: boolean; data?: Comment; message?: string }> {
  const response = await request<Comment>(`/articles/${articleId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  if (response.success && response.data) {
    return response;
  }
  const newComment: Comment = {
    id: `comment_${Date.now()}`,
    author: '访客',
    content,
    created_at: new Date().toISOString(),
  };
  return { success: true, data: newComment };
}
