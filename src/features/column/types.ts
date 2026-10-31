/**
 * 文章模块类型定义
 * 定义文章数据结构，供文章详情页与文章 API 共享使用。
 * V4.8.0：首页专栏改为「最近新闻」，Column 类型随专栏入口一并移除。
 */

/** 文章（含封面、作者、阅读/点赞/评论统计及标签） */
export interface Article {
  id: string;
  title: string;
  excerpt: string;
  content_path: string;
  cover_image?: string;
  author: string;
  published_at: string;
  read_count: number;
  like_count: number;
  comment_count: number;
  tags: string[];
}
