/**
 * @file 关于我们 API
 * @description
 *  封装关于我们页面使用的公开接口。
 *  核心功能：
 *   1. 站点数据统计（开站天数 / 已入库作品数）。
 *  注意：该接口为公开端点（无需登录），复用全局 request 客户端获得
 *       超时、重试与非 JSON 响应的统一容错处理；失败时上层页面展示重试按钮。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 站点数据统计 */
export interface AboutStats {
  site_days: number;      // 已开站天数（按固定开站日起算）
  approved_count: number; // 已入库作品数（approved 状态总数）
}

/**
 * 获取站点统计数据
 * @returns ApiResponse<AboutStats>，data 含 site_days 与 approved_count
 */
export async function getAboutStats(): Promise<ApiResponse<AboutStats>> {
  return request<AboutStats>('/about/stats');
}
