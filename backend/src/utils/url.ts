/**
 * @file URL 工具函数
 * @description 提供图片访问 URL 改写与 SQL LIKE 模式转义等通用工具方法。
 */

/**
 * 将 OSS Key 或完整 URL 改写为后端图片代理接口 URL
 * - 完整 URL 且属于本系统 OSS 域名：剥离域名与查询串，转为代理路径
 * - 完整 URL 但不属于本系统：原样返回（外部资源）
 * - 纯 Key：直接拼接为代理路径
 * @param key OSS Key 或完整 URL
 * @param photoId 可选的照片 ID，用于代理路由快速鉴权
 * @returns 经 encodeURIComponent 编码的代理接口路径，或原始外部 URL
 */
export function getProxyUrl(key: string, photoId?: string): string {
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
    if (key.startsWith(ossDomain)) {
      // 命中本系统 OSS 域名：去域名 + 去查询串，得到纯 Key 后交给代理接口
      const filePath = key.replace(ossDomain, '').split('?')[0];
      const base = `/api/photos/image/${encodeURIComponent(filePath)}`;
      return photoId ? `${base}?photoId=${photoId}` : base;
    }
    return key;
  }
  const base = `/api/photos/image/${encodeURIComponent(key)}`;
  return photoId ? `${base}?photoId=${photoId}` : base;
}

/**
 * 转义 SQL LIKE 模式中的特殊字符（% 与 _），防止用户输入干扰模式匹配
 * @param pattern 原始字符串
 * @returns 已转义字符串（使用反斜杠作为转义符）
 */
export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_]/g, '\\$&');
}
