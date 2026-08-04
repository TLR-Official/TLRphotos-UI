/**
 * @file 文章 API
 * @description
 *  封装文章（Article）、专栏（Column）与评论（Comment）相关的后端接口。
 *  核心功能：
 *   1. 文章列表 / 详情 / 内容获取。
 *   2. 专栏信息获取。
 *   3. 文章点赞 / 取消点赞 / 浏览数自增。
 *   4. 评论列表获取与创建。
 *  Article / Column 类型从 features/column/types 复用，本文件仅做导出别名。
 */

import { request } from './client';
import type { ApiResponse } from './client';
import type { Article as ArticleType, Column as ColumnType } from '../features/column/types';

// 复用 features 层类型，统一对外导出
export type Article = ArticleType;
export type Column = ColumnType;

/**
 * 获取文章列表
 * @returns ApiResponse<Article[]>
 */
export async function getArticles(): Promise<ApiResponse<Article[]>> {
  return request<Article[]>('/articles');
}

/**
 * 根据 ID 获取文章详情
 * @param id - 文章 ID
 * @returns ApiResponse<Article>
 */
export async function getArticleById(id: string): Promise<ApiResponse<Article>> {
  return request<Article>(`/articles/${id}`);
}

/**
 * 获取文章正文内容（HTML 或 Markdown 字符串）
 * @param articleId - 文章 ID
 * @returns ApiResponse<string>
 */
export async function getArticleContent(articleId: string): Promise<ApiResponse<string>> {
  return request<string>(`/articles/${articleId}/content`);
}

/**
 * 获取专栏信息
 * @returns ApiResponse<Column>
 */
export async function getColumn(): Promise<ApiResponse<Column>> {
  return request<Column>('/column');
}

/**
 * 点赞文章
 * @param id - 文章 ID
 * @returns ApiResponse，data.like_count 为最新点赞数
 */
export async function likeArticle(id: string): Promise<ApiResponse<{ like_count: number }>> {
  return request<{ like_count: number }>(`/articles/${id}/like`, {
    method: 'POST',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

/**
 * 取消点赞文章
 * @param id - 文章 ID
 * @returns ApiResponse，data.like_count 为最新点赞数
 */
export async function unlikeArticle(id: string): Promise<ApiResponse<{ like_count: number }>> {
  return request<{ like_count: number }>(`/articles/${id}/like`, {
    method: 'DELETE',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

/**
 * 文章浏览数自增
 * @param id - 文章 ID
 * @returns ApiResponse，data.read_count 为最新阅读数
 */
export async function incrementArticleView(id: string): Promise<ApiResponse<{ read_count: number }>> {
  return request<{ read_count: number }>(`/articles/${id}/view`, {
    method: 'POST',
  });
}

/** 评论数据结构 */
export interface Comment {
  id: string;
  author: string;       // 评论者昵称
  content: string;      // 评论内容
  created_at: string;   // 创建时间
}

/**
 * 获取文章评论列表
 * @param articleId - 文章 ID
 * @returns ApiResponse<Comment[]>
 */
export async function getComments(articleId: string): Promise<ApiResponse<Comment[]>> {
  return request<Comment[]>(`/articles/${articleId}/comments`);
}

/**
 * 创建评论
 * @param articleId - 文章 ID
 * @param content - 评论内容
 * @returns ApiResponse<Comment>，返回新建的评论
 */
export async function createComment(articleId: string, content: string): Promise<ApiResponse<Comment>> {
  return request<Comment>(`/articles/${articleId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author: '访客', content }),
  });
}
