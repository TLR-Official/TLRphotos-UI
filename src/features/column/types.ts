/**
 * 栏目模块类型定义
 * 定义文章与栏目两类数据结构，供栏目列表、文章详情等页面共享使用。
 */

/** 文章（栏目下的单篇内容，含封面、作者、阅读/点赞/评论统计及标签） */
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

/** 栏目（文章集合的容器，含栏目基本信息与其下文章列表） */
export interface Column {
  id: string;
  name: string;
  description: string;
  cover_image?: string;
  articles: Article[];
}
