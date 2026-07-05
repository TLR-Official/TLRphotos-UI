import { request } from './client';
import type { ApiResponse } from './client';
import type { PhotoListItem, PhotoDetail } from '../features/gallery/types';
import { mockPhotos, mockPhotoDetails } from '../features/gallery/mockData';

export async function getPhotos(): Promise<ApiResponse<PhotoListItem[]>> {
  const response = await request<PhotoListItem[]>('/photos');
  if (response.success && response.data) {
    return response;
  }
  return { success: true, data: mockPhotos };
}

export async function getPhotoById(id: string): Promise<ApiResponse<PhotoDetail>> {
  const response = await request<PhotoDetail>(`/photos/${id}`);
  if (response.success && response.data) {
    return response;
  }
  const mockData = mockPhotoDetails[id];
  return mockData ? { success: true, data: mockData } : { success: false, message: '照片不存在' };
}

export async function likePhoto(id: string): Promise<ApiResponse<{ likes: number }>> {
  const response = await request<{ likes: number }>(`/photos/${id}/like`, {
    method: 'POST',
  });
  if (response.success && response.data) {
    return response;
  }
  const photo = mockPhotoDetails[id];
  if (photo) {
    return { success: true, data: { likes: photo.likes + 1 } };
  }
  return { success: false, message: '操作失败' };
}

export async function unlikePhoto(id: string): Promise<ApiResponse<{ likes: number }>> {
  const response = await request<{ likes: number }>(`/photos/${id}/like`, {
    method: 'DELETE',
  });
  if (response.success && response.data) {
    return response;
  }
  const photo = mockPhotoDetails[id];
  if (photo) {
    return { success: true, data: { likes: Math.max(0, photo.likes - 1) } };
  }
  return { success: false, message: '操作失败' };
}

export async function incrementView(id: string): Promise<ApiResponse<{ views: number }>> {
  const response = await request<{ views: number }>(`/photos/${id}/view`, {
    method: 'POST',
  });
  if (response.success && response.data) {
    return response;
  }
  const photo = mockPhotoDetails[id];
  if (photo) {
    return { success: true, data: { views: photo.views + 1 } };
  }
  return { success: false, message: '操作失败' };
}
