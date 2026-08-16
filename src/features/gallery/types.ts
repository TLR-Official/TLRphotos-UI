/**
 * 画廊模块类型定义
 * 定义照片列表项、上传者、照片详情等数据结构，供画廊相关页面与组件共享使用。
 */

/** 照片列表项（画廊缩略图列表使用，仅含展示所需的最小字段集合） */
export interface PhotoListItem {
  id: string;
  title: string;
  thumbnail_path: string;
  tags: string[];
  width?: number;
  height?: number;
}

/** 上传者信息（嵌入在照片详情中，用于展示上传者头像与昵称） */
export interface Uploader {
  id: string;
  username: string;
  avatar_url?: string | null;
}

/** 照片详情（在列表项基础上扩展原图/预览/水印/拍摄参数/统计等完整字段） */
export interface PhotoDetail extends PhotoListItem {
  original_url: string;
  preview_url?: string;
  watermarked_url?: string;
  watermark_config?: string;
  created_at: string;
  description: string;
  camera_model: string;
  vehicle: string;
  location: string;
  focal_length: string;
  iso: number;
  shutter_speed: string;
  aperture: string;
  likes: number;
  views: number;
  uploader?: Uploader | null;
  user_id?: string | null;
  /** 审核状态：approved / pending / rejected */
  status?: string;
}
