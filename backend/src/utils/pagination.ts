/**
 * @file pagination.ts
 * @description 列表接口分页参数解析的统一实现。
 *
 * 原先 users / forum / announcements / news / photos 五个路由各自手写同一套
 * 钳制公式，仅在「默认每页数 / 上限 / 参数名」上不同。此处参数化收敛，
 * 公式与原实现逐项等价：
 *   page = max(1, parseInt(page) || 1)
 *   pageSize = min(maxSize, max(1, parseInt(size) || defaultSize))
 * 注意：未做钳制的调用方（如 notifications 路由允许负页码）**不适用**本工具，
 * 强行复用会改变其行为。
 */
import express from 'express';

/** 分页解析配置 */
export interface PaginationOptions {
  /** 未传 page_size（或非法值）时的默认每页条数 */
  defaultSize: number;
  /** 每页条数上限，默认 50 */
  maxSize?: number;
  /** 每页条数对应的查询参数名，默认 page_size（photos 列表使用 limit） */
  sizeParam?: string;
}

/** 分页解析结果 */
export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * 解析分页参数。
 * @param req - Express 请求对象（读取 req.query）
 * @param options - 默认值 / 上限 / 参数名配置
 * @returns page（从 1 起）、pageSize（已钳制）、offset
 */
export function parsePagination(req: express.Request, options: PaginationOptions): Pagination {
  const { defaultSize, maxSize = 50, sizeParam = 'page_size' } = options;
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(String(req.query[sizeParam])) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
