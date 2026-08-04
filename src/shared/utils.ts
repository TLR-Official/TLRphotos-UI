/**
 * @file 通用工具函数
 * @description
 *  日期格式化相关的通用工具函数集合。
 *  包含完整日期、短日期与相对时间（"刚刚"、"x 分钟前" 等）格式化。
 */

/**
 * 格式化为完整日期字符串
 * @param dateString - 日期字符串（ISO 或 Date 可解析格式）
 * @returns 形如 "2025年1月1日 12:00:00" 的字符串
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 格式化为短日期字符串
 * @param dateString - 日期字符串
 * @returns 形如 "1月1日" 的字符串
 */
export function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * 格式化为相对时间
 * @param dateString - 日期字符串
 * @returns 相对时间字符串（"刚刚" / "x分钟前" / "x小时前" / "x天前"）；
 *          超过 30 天则回退到完整日期格式
 */
export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 30) return `${diffDays}天前`;
  // 超过 30 天回退为完整日期
  return formatDate(dateString);
}
