/**
 * @file 站点内容公开接口（V4.15.0，Q13/Q14）
 * @description
 *  合作伙伴与规则文件由后台维护，前端通过公开接口读取（仅返回已上线内容）。
 *  读取失败时由页面决定降级展示，不阻塞其他区块。
 */
import { request } from './client';
import type { ApiResponse } from './client';

/** 合作伙伴（关于我们页展示） */
export interface Partner {
  id: string;
  name: string;
  description: string;
  logo_url: string | null;
  logo_text: string | null;
  sort_order: number;
}

/** 规则文件（传图 / 网站规则页展示） */
export interface RuleFile {
  id: string;
  title: string;
  description: string;
  url: string;
  size_text: string | null;
  version_text: string | null;
  sort_order: number;
}

/** 获取已上线的合作伙伴列表 */
export async function getPartners(): Promise<ApiResponse<Partner[]>> {
  return request<Partner[]>('/partners');
}

/** 获取已上线的规则文件列表 */
export async function getRuleFiles(): Promise<ApiResponse<RuleFile[]>> {
  return request<RuleFile[]>('/rule-files');
}
