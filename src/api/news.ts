/**
 * @file 新闻区 API（V4.0.0）
 * @description
 *  封装新闻区前台公开接口（后端挂载 /api/news，120 次/分限速）：
 *   1. 公开新闻列表（分页，含封面首图代理 URL）。
 *   2. 公开新闻详情（配图代理 URL 数组 + 后端拼好的版权声明 copyright_notice）。
 *  新闻正文以 Markdown 文件存放，复用既有 GET /api/articles/:id/content 端点
 *  读取（见 src/api/articles.ts 的 getArticleContent），本文件不再重复封装。
 *  管理端 CRUD 封装位于 src/admin/api.ts（需管理员 JWT）。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 公开新闻列表项 */
export interface NewsListItem {
  id: string;
  title: string;
  /** 摘要（后端由正文生成，前 120 字） */
  excerpt: string;
  /** 所属板块 id（首批固定 aviation） */
  board_id: string;
  /** 作者名（创建新闻的管理员名） */
  author_name: string;
  /** 发布时间 ISO 字符串 */
  created_at: string;
  /** 封面首图代理 URL（无配图为 null） */
  cover_image: string | null;
}

/** 公开新闻列表响应 data */
export interface NewsListData {
  items: NewsListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 新闻详情配图项（URL 均为后端代理地址） */
export interface NewsDetailImage {
  photo_id: string;
  /** 照片标题（可能为 null） */
  title: string | null;
  /** 缩略图代理 URL */
  thumbnail_url: string | null;
  /** 预览图代理 URL（无预览时后端回退水印图，均无为 null） */
  preview_url: string | null;
}

/** 公开新闻详情响应 data */
export interface NewsDetail {
  id: string;
  title: string;
  excerpt: string;
  /** 正文 Markdown 文件路径（正文经 /api/articles/:id/content 读取） */
  content_path: string;
  board_id: string;
  author_name: string;
  created_at: string;
  /** 配图数组（按 sort_order 升序，首位为封面） */
  images: NewsDetailImage[];
  /** 版权声明：`@{作者名} ©TLRphotos {年} 版权所有`（后端拼好，前端直接展示） */
  copyright_notice: string;
}

/**
 * 获取公开新闻列表（按发布时间倒序分页）
 * @param page 页码（默认 1）
 * @param pageSize 每页数量（默认 10，上限 50）
 * @returns ApiResponse<NewsListData>
 */
export async function getNewsList(page = 1, pageSize = 10): Promise<ApiResponse<NewsListData>> {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return request<NewsListData>(`/news?${query.toString()}`);
}

/**
 * 获取公开新闻详情（含配图与版权声明）
 * @param id 新闻 id
 * @returns ApiResponse<NewsDetail>
 */
export async function getNewsDetail(id: string): Promise<ApiResponse<NewsDetail>> {
  return request<NewsDetail>(`/news/${id}`);
}
