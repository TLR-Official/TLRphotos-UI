/**
 * @file 标签 API
 * @description
 *  封装标签分类（Category）与标签对象（Object）相关的后端接口。
 *  数据层级：Category（分类） → Object（对象） → Attribute（属性）。
 *  核心功能：
 *   1. 获取全部标签分类。
 *   2. 获取分类下的全部对象（含属性），或仅对象列表。
 *   3. 获取指定对象的属性列表。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 标签分类 */
export interface TagCategory {
  id: string;
  name: string;          // 中文名
  name_en: string;       // 英文名
  description: string;   // 描述
  icon: string;          // 图标标识
}

/** 标签属性定义 */
export interface TagAttribute {
  id: string;
  object_id: string;     // 所属对象 ID
  key: string;           // 属性键名（中文）
  key_en: string;        // 属性键名（英文）
  label: string;         // 显示标签
  type: 'text' | 'select' | 'number'; // 属性类型
  options: string[];     // type 为 select 时的可选项
}

/** 标签对象 */
export interface TagObject {
  id: string;
  category_id: string;   // 所属分类 ID
  name: string;          // 中文名
  name_en: string;       // 英文名
  description: string;   // 描述
  attributes: TagAttribute[]; // 属性列表
}

/** 分类及其包含的对象（聚合响应） */
export interface CategoryTagsResponse {
  category: TagCategory;
  objects: TagObject[];
}

/**
 * 获取全部标签分类
 * @returns ApiResponse<TagCategory[]>
 */
export async function getTagCategories(): Promise<ApiResponse<TagCategory[]>> {
  return request<TagCategory[]>('/tags');
}

/**
 * 获取分类下的全部对象（含属性）
 * @param categoryId - 分类 ID
 * @returns ApiResponse<CategoryTagsResponse>，含分类信息与对象列表
 */
export async function getCategoryTags(categoryId: string): Promise<ApiResponse<CategoryTagsResponse>> {
  return request<CategoryTagsResponse>(`/tags/${categoryId}`);
}

/**
 * 获取分类下的全部对象（不含属性）
 * @param categoryId - 分类 ID
 * @returns ApiResponse<TagObject[]>
 */
export async function getCategoryObjects(categoryId: string): Promise<ApiResponse<TagObject[]>> {
  return request<TagObject[]>(`/tags/${categoryId}/objects`);
}

/**
 * 获取指定对象的属性列表
 * @param objectId - 对象 ID
 * @returns ApiResponse<TagAttribute[]>
 */
export async function getObjectAttributes(objectId: string): Promise<ApiResponse<TagAttribute[]>> {
  return request<TagAttribute[]>(`/tags/objects/${objectId}/attributes`);
}
