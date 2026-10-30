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
  /** 飞机注册号（旧数据可能为 null） */
  registration_number?: string | null;
  /** 自动识别的机型（V4.6.0，如 "Boeing 777-300ER"；未识别为空串或 null） */
  aircraft_type?: string | null;
  /** 自动识别的所属航司（V4.6.0，如 "Air China"；未识别为空串或 null） */
  airline?: string | null;
  /** 热门意愿标记：1=上传者愿意推荐为热门 */
  is_hot?: number;
  /** 浏览量（V4.1.2-beta.3：热门接口与部分列表接口返回，用于轮播/推荐页展示） */
  views?: number;
  /** 点赞数（V4.1.2-beta.3：热门接口与部分列表接口返回，用于轮播/推荐页展示） */
  likes?: number;
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
  /** 当前登录用户是否已点赞；未登录或未点赞时为 false */
  is_liked?: boolean;
  uploader?: Uploader | null;
  user_id?: string | null;
  /** 审核状态：approved / pending / rejected */
  status?: string;
  /** 审核驳回理由（仅 rejected 状态非空） */
  rejection_reason?: string | null;
  /** 原审核员信息（V4.1.2-beta.3：仅 rejected 状态非空，用于展示审核员编号） */
  reviewer?: { name: string; reviewed_at: string | null } | null;
}
