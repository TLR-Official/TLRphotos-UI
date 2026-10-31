/**
 * @file 文章 API
 * @description
 *  封装文章（Article）相关的后端接口。
 *  核心功能：
 *   1. 文章详情 / 内容获取（新闻正文复用内容端点）。
 *   2. 文章点赞 / 取消点赞 / 浏览数自增。
 *  评论自 V3.0.0 起迁移至通用评论模块（src/api/comments.ts）。
 *  V4.8.0 起首页专栏入口改为「最近新闻」，文章列表与专栏信息接口不再由前端调用。
 *  Article 类型从 features/column/types 复用，本文件仅做导出别名。
 */

import { request } from './client';
import type { ApiResponse } from './client';
import type { Article as ArticleType } from '../features/column/types';

// 复用 features 层类型，统一对外导出
export type Article = ArticleType;

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
