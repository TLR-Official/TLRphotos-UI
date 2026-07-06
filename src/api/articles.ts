import { request } from './client';
import type { ApiResponse } from './client';
import type { Article as ArticleType, Column as ColumnType } from '../features/column/types';

export type Article = ArticleType;
export type Column = ColumnType;

export async function getArticles(): Promise<ApiResponse<Article[]>> {
  return request<Article[]>('/articles');
}

export async function getArticleById(id: string): Promise<ApiResponse<Article>> {
  return request<Article>(`/articles/${id}`);
}

export async function getArticleContent(articleId: string): Promise<ApiResponse<string>> {
  return request<string>(`/articles/${articleId}/content`);
}

export async function getColumn(): Promise<ApiResponse<Column>> {
  return request<Column>('/column');
}

export async function likeArticle(id: string): Promise<ApiResponse<{ like_count: number }>> {
  return request<{ like_count: number }>(`/articles/${id}/like`, {
    method: 'POST',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

export async function unlikeArticle(id: string): Promise<ApiResponse<{ like_count: number }>> {
  return request<{ like_count: number }>(`/articles/${id}/like`, {
    method: 'DELETE',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

export async function incrementArticleView(id: string): Promise<ApiResponse<{ read_count: number }>> {
  return request<{ read_count: number }>(`/articles/${id}/view`, {
    method: 'POST',
  });
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  created_at: string;
}

export async function getComments(articleId: string): Promise<ApiResponse<Comment[]>> {
  return request<Comment[]>(`/articles/${articleId}/comments`);
}

export async function createComment(articleId: string, content: string): Promise<ApiResponse<Comment>> {
  return request<Comment>(`/articles/${articleId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author: '访客', content }),
  });
}
