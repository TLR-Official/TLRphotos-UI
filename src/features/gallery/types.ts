// 照片数据类型定义 - 符合 .ai/context.md 规范

export interface Photo {
  id: string;
  title: string;
  thumbnail_path: string; // 本地缩略图路径 (WebP Blob)
  original_url: string; // Cloudflare R2 原图 URL
  created_at: string;
  tags: string[];
  width?: number; // 缩略图宽度
  height?: number; // 缩略图高度
}

// 列表查询返回的精简字段（按需查询规范）
export interface PhotoListItem {
  id: string;
  title: string;
  thumbnail_path: string;
  tags: string[];
  width?: number;
  height?: number;
}

// 详情页返回的完整字段
export interface PhotoDetail extends PhotoListItem {
  original_url: string;
  created_at: string;
}