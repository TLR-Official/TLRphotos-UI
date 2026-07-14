import { request } from './client';
import type { ApiResponse } from './client';
import type { PhotoListItem, PhotoDetail } from '../features/gallery/types';

export interface SearchParams {
  keyword?: string;
  tag?: string;
  sortBy?: 'created_at' | 'likes' | 'views' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface PhotoUploadMeta {
  title?: string;
  tags?: string[] | string;
  description?: string;
  camera_model?: string;
  vehicle?: string;
  location?: string;
  altitude?: number;
  focal_length?: string;
  iso?: number;
  shutter_speed?: string;
  aperture?: string;
  width?: number;
  height?: number;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  key: string;
}

export interface UploadCompleteResponse {
  photoId: string;
  key: string;
  url: string;
  thumbnailUrl: string;
}

export async function getPhotos(): Promise<ApiResponse<PhotoListItem[]>> {
  return request<PhotoListItem[]>('/photos');
}

export async function searchPhotos(params: SearchParams): Promise<ApiResponse<PhotoListItem[]>> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.tag) query.set('tag', params.tag);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  return request<PhotoListItem[]>(`/photos/search?${query.toString()}`);
}

export async function getTags(): Promise<ApiResponse<string[]>> {
  return request<string[]>('/photos/tags');
}

export async function getPhotoById(id: string): Promise<ApiResponse<PhotoDetail>> {
  return request<PhotoDetail>(`/photos/${id}`);
}

export async function likePhoto(id: string): Promise<ApiResponse<{ likes: number }>> {
  return request<{ likes: number }>(`/photos/${id}/like`, {
    method: 'POST',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

export async function unlikePhoto(id: string): Promise<ApiResponse<{ likes: number }>> {
  return request<{ likes: number }>(`/photos/${id}/like`, {
    method: 'DELETE',
    body: JSON.stringify({ userId: 'anonymous' }),
  });
}

export async function incrementView(id: string): Promise<ApiResponse<{ views: number }>> {
  return request<{ views: number }>(`/photos/${id}/view`, {
    method: 'POST',
  });
}

export async function getPresignedUrl(
  fileName: string
): Promise<ApiResponse<PresignedUrlResponse>> {
  return request<PresignedUrlResponse>('/photos/upload/presigned', {
    method: 'POST',
    body: JSON.stringify({ fileName }),
  });
}

export async function completeUpload(
  key: string,
  meta?: PhotoUploadMeta
): Promise<ApiResponse<UploadCompleteResponse>> {
  return request<UploadCompleteResponse>('/photos/upload/complete', {
    method: 'POST',
    body: JSON.stringify({ key, ...meta }),
  });
}
