import { request } from './client';
import type { ApiResponse } from './client';

export interface TagCategory {
  id: string;
  name: string;
  name_en: string;
  description: string;
  icon: string;
}

export interface TagAttribute {
  id: string;
  object_id: string;
  key: string;
  key_en: string;
  label: string;
  type: 'text' | 'select' | 'number';
  options: string[];
}

export interface TagObject {
  id: string;
  category_id: string;
  name: string;
  name_en: string;
  description: string;
  attributes: TagAttribute[];
}

export interface CategoryTagsResponse {
  category: TagCategory;
  objects: TagObject[];
}

export async function getTagCategories(): Promise<ApiResponse<TagCategory[]>> {
  return request<TagCategory[]>('/tags');
}

export async function getCategoryTags(categoryId: string): Promise<ApiResponse<CategoryTagsResponse>> {
  return request<CategoryTagsResponse>(`/tags/${categoryId}`);
}

export async function getCategoryObjects(categoryId: string): Promise<ApiResponse<TagObject[]>> {
  return request<TagObject[]>(`/tags/${categoryId}/objects`);
}

export async function getObjectAttributes(objectId: string): Promise<ApiResponse<TagAttribute[]>> {
  return request<TagAttribute[]>(`/tags/objects/${objectId}/attributes`);
}
