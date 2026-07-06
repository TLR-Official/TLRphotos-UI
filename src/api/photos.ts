import { request } from './client';
import type { ApiResponse } from './client';
import type { PhotoListItem, PhotoDetail } from '../features/gallery/types';

export async function getPhotos(): Promise<ApiResponse<PhotoListItem[]>> {
  return request<PhotoListItem[]>('/photos');
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
