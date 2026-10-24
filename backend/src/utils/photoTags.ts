/**
 * @file photoTags.ts
 * @description 照片标签字段的统一解析工具。
 *
 * 背景：`photos.tags` 存在两种历史存储形态——新数据为 JSON 数组字符串
 * （如 `["飞机","机场"]`），旧数据为空格分隔字符串（如 `飞机 机场`）。
 * 读取侧必须同时兼容两者，且该逻辑原先在 photos 与 users 两个路由中各写一份，
 * 此处收敛为唯一实现，保证后续任何读取路径口径一致。
 */

/**
 * 解析 photos.tags 字段为字符串数组。
 * @param raw - 数据库原始值（期望为 string；null/非字符串一律返回空数组）
 * @returns 标签数组；JSON 数组仅保留字符串元素，解析失败则回退空格分隔
 */
export function parsePhotoTags(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return raw.split(' ').filter(Boolean);
  }
}
