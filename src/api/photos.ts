/**
 * @file 照片 API
 * @description
 *  封装与照片资源相关的后端接口。
 *  核心功能：
 *   1. 照片列表 / 搜索 / 详情 / 标签查询。
 *   2. 点赞 / 取消点赞 / 浏览数自增。
 *   3. 上传：预签名 URL 模式（getPresignedUrl + completeUpload）与直传模式（directUpload）。
 *   4. 删除照片。
 *   5. 公开用户信息与用户照片列表查询。
 *  注意：directUpload / deletePhoto / getPublicUser / getUserPhotos 直接使用 fetch，
 *       因上传与删除需自定义 Authorization 头与 FormData 处理，且需检测非 JSON 响应避免解析异常。
 */

import { request } from './client';
import type { ApiResponse } from './client';
import type { PhotoListItem, PhotoDetail } from '../features/gallery/types';

/** 搜索参数 */
export interface SearchParams {
  keyword?: string;                                  // 关键词
  tag?: string;                                       // 标签
  category?: string;                                  // 分区 ID（aviation/railway/automobile）
  sortBy?: 'created_at' | 'likes' | 'views' | 'title'; // 排序字段
  sortOrder?: 'asc' | 'desc';                         // 排序方向
}

/** 照片上传元数据（含 EXIF 信息与水印配置） */
export interface PhotoUploadMeta {
  title?: string;
  tags?: string[] | string;
  description?: string;
  camera_model?: string;     // 相机型号
  vehicle?: string;          // 拍摄车辆
  location?: string;         // 拍摄地点
  altitude?: number;         // 海拔
  focal_length?: string;     // 焦距
  iso?: number;              // ISO
  shutter_speed?: string;    // 快门速度
  aperture?: string;         // 光圈
  width?: number;            // 图片宽度
  height?: number;           // 图片高度
  watermarkText?: string;    // 水印文本
  watermarkX?: number;       // 水印 X 坐标
  watermarkY?: number;       // 水印 Y 坐标
  watermarkOpacity?: number; // 水印透明度
  watermarkSize?: number;    // 水印字号
}

/** 预签名 URL 响应（用于 OSS 直传） */
export interface PresignedUrlResponse {
  uploadUrl: string; // OSS 预签名上传 URL
  key: string;       // OSS 对象 key
}

/** 上传完成响应 */
export interface UploadCompleteResponse {
  photoId: string;      // 数据库生成的照片 ID
  key: string;          // OSS 对象 key
  url: string;          // 原图访问 URL
  thumbnailUrl: string; // 缩略图 URL
}

/**
 * 获取全部照片列表
 * @param category - 可选分区 ID，传入时仅返回该分区照片
 * @returns ApiResponse<PhotoListItem[]>
 */
export async function getPhotos(category?: string): Promise<ApiResponse<PhotoListItem[]>> {
  const query = new URLSearchParams();
  if (category) query.set('category', category);
  const qs = query.toString();
  return request<PhotoListItem[]>(qs ? `/photos?${qs}` : '/photos');
}

/**
 * 搜索照片
 * @param params - 搜索与排序参数
 * @returns ApiResponse<PhotoListItem[]>
 */
export async function searchPhotos(params: SearchParams): Promise<ApiResponse<PhotoListItem[]>> {
  // 通过 URLSearchParams 拼接 query string，仅包含非空字段
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.tag) query.set('tag', params.tag);
  if (params.category) query.set('category', params.category);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  return request<PhotoListItem[]>(`/photos/search?${query.toString()}`);
}

/**
 * 获取全部标签列表
 * @returns ApiResponse<string[]>，标签名数组
 */
export async function getTags(): Promise<ApiResponse<string[]>> {
  return request<string[]>('/photos/tags');
}

/**
 * 根据 ID 获取照片详情
 * @param id - 照片 ID
 * @returns ApiResponse<PhotoDetail>
 */
export async function getPhotoById(id: string): Promise<ApiResponse<PhotoDetail>> {
  return request<PhotoDetail>(`/photos/${id}`);
}

/**
 * 点赞照片
 * @param id - 照片 ID
 * @returns ApiResponse，data.likes 为最新点赞数
 */
export async function likePhoto(id: string): Promise<ApiResponse<{ likes: number }>> {
  return request<{ likes: number }>(`/photos/${id}/like`, {
    method: 'POST',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

/**
 * 取消点赞
 * @param id - 照片 ID
 * @returns ApiResponse，data.likes 为最新点赞数
 */
export async function unlikePhoto(id: string): Promise<ApiResponse<{ likes: number }>> {
  return request<{ likes: number }>(`/photos/${id}/like`, {
    method: 'DELETE',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

/**
 * 浏览数自增
 * @param id - 照片 ID
 * @returns ApiResponse，data.views 为最新浏览数
 */
export async function incrementView(id: string): Promise<ApiResponse<{ views: number }>> {
  return request<{ views: number }>(`/photos/${id}/view`, {
    method: 'POST',
  });
}

/**
 * 获取 OSS 预签名上传 URL
 * @param fileName - 文件名（用于生成 OSS key）
 * @returns ApiResponse<PresignedUrlResponse>
 */
export async function getPresignedUrl(
  fileName: string
): Promise<ApiResponse<PresignedUrlResponse>> {
  return request<PresignedUrlResponse>('/photos/upload/presigned', {
    method: 'POST',
    body: JSON.stringify({ fileName }),
  });
}

/**
 * 上传完成回调：通知后端 OSS 对象已上传，由后端入库并生成缩略图
 * @param key - OSS 对象 key
 * @param meta - 照片元数据
 * @returns ApiResponse<UploadCompleteResponse>
 */
export async function completeUpload(
  key: string,
  meta?: PhotoUploadMeta
): Promise<ApiResponse<UploadCompleteResponse>> {
  return request<UploadCompleteResponse>('/photos/upload/complete', {
    method: 'POST',
    body: JSON.stringify({ key, ...meta }),
  });
}

/** 直传响应 */
export interface DirectUploadResponse {
  photoId: string;          // 照片 ID
  thumbnailUrl: string;     // 缩略图 URL
  previewUrl: string;       // 预览图 URL
  watermarkedUrl?: string;  // 带水印图 URL（可选）
}

/**
 * 直传上传（不经 request 客户端，使用 FormData）
 * @param file - 图片文件
 * @param meta - 照片元数据（扁平化追加到 FormData）
 * @param token - 认证 Token（绕过 request 客户端的 localStorage 读取）
 * @returns ApiResponse<DirectUploadResponse>
 */
export async function directUpload(
  file: File,
  meta: PhotoUploadMeta,
  token?: string
): Promise<ApiResponse<DirectUploadResponse>> {
  const formData = new FormData();
  formData.append('image', file);

  // 将 meta 字段扁平化追加到 FormData，过滤 null / undefined
  Object.entries(meta).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });

  // 手动注入 Authorization 头（绕过 request 客户端）
  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch('/api/photos/upload', {
    method: 'POST',
    body: formData,
    headers,
  });

  if (!response.ok) {
    return {
      success: false,
      message: `上传失败: ${response.status} ${response.statusText}`,
    };
  }

  // 检测响应类型，避免非 JSON 响应导致解析异常
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    return {
      success: false,
      message: `服务器返回非JSON响应: ${text.substring(0, 100)}`,
    };
  }

  return response.json();
}

/**
 * 删除照片
 * @param id - 照片 ID
 * @param token - 认证 Token
 * @returns ApiResponse，data.message 提示删除结果
 */
export async function deletePhoto(id: string, token: string): Promise<ApiResponse<{ message: string }>> {
  const response = await fetch(`/api/photos/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  // 检测响应类型，避免非 JSON 响应导致解析异常
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    return {
      success: false,
      message: `服务器返回非JSON响应: ${text.substring(0, 100)}`,
    };
  }

  return response.json();
}

/** 公开用户信息（脱敏后） */
export interface PublicUser {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
  website?: string | null;
  location?: string | null;
  created_at?: string;
}

/** 用户照片列表响应 */
export interface UserPhotosResponse {
  photos: PhotoListItem[];
  total: number;
}

/**
 * 获取指定用户的公开信息
 * @param userId - 用户 ID
 * @returns ApiResponse<PublicUser>
 */
export async function getPublicUser(userId: string): Promise<ApiResponse<PublicUser>> {
  const response = await fetch(`/api/auth/users/${userId}`);

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    return {
      success: false,
      message: `服务器返回非JSON响应: ${text.substring(0, 100)}`,
    };
  }

  return response.json();
}

/**
 * 获取指定用户的照片列表（分页）
 * @param userId - 用户 ID
 * @param page - 页码（默认 1）
 * @param pageSize - 每页数量（默认 20）
 * @returns ApiResponse<UserPhotosResponse>
 */
export async function getUserPhotos(userId: string, page = 1, pageSize = 20): Promise<ApiResponse<UserPhotosResponse>> {
  const response = await fetch(`/api/auth/users/${userId}/photos?page=${page}&pageSize=${pageSize}`);

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    return {
      success: false,
      message: `服务器返回非JSON响应: ${text.substring(0, 100)}`,
    };
  }

  return response.json();
}
