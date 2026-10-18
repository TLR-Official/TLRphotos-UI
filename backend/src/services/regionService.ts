/**
 * @file 离线 IP 归属地解析服务（V4.1.0）
 * @description 基于 ip2region（npm 离线 xdb 数据文件，包内内置 data/ip2region.db，
 *              无任何外部 HTTP 请求）将客户端 IP 解析为省级归属地。
 *              仅用于登录/注册成功时的 users.region 采集（只存省份、不落明文 IP）；
 *              内网/保留地址/解析失败/任何异常一律返回 '未知'，绝不抛出、绝不阻塞登录主流程。
 */
import IP2Region from 'ip2region';

/** 归属地未知时的统一占位值（与 spec 口径一致） */
export const REGION_UNKNOWN = '未知';

/**
 * 惰性单例：ip2region 构造时加载内置 xdb 文件，
 * 路径解析基于包自身目录（node_modules/ip2region/data），backend rebuild 不影响。
 */
let searcher: IP2Region | null = null;
let searcherFailed = false;

function getSearcher(): IP2Region | null {
  if (searcherFailed) return null;
  if (!searcher) {
    try {
      searcher = new IP2Region();
    } catch {
      // 数据文件缺失/损坏等初始化异常：标记失败避免每次请求重复尝试
      searcherFailed = true;
      return null;
    }
  }
  return searcher;
}

/**
 * 内网/保留地址判断（spec 口径）：127.*、10.*、172.16-31.*、192.168.*、::1、
 * IPv4-mapped 回环（::ffff:127.*）与无法解析的输入一律视为内网/无效。
 */
function isPrivateOrReserved(ip: string): boolean {
  if (!ip || ip === 'unknown') return true;
  if (ip === '::1' || ip.startsWith('::ffff:127.')) return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return false;
}

/**
 * 省级名称归一化：去掉「省/市/自治区/特别行政区」等后缀保留核心名。
 * 如：广东省→广东、北京市→北京、内蒙古自治区→内蒙古、香港特别行政区→香港。
 */
function normalizeProvince(province: string): string {
  if (!province) return '';
  return province
    .replace(/(壮族|回族|维吾尔)?自治区$/, '')
    .replace(/特别行政区$/, '')
    .replace(/省$/, '')
    .replace(/市$/, '');
}

/**
 * 解析 IP 为省级归属地（同步、零网络请求、永不抛出）。
 * @param ip 客户端 IP（X-Forwarded-For 首段），undefined/null/内网/解析失败均返回 '未知'
 */
export function resolveRegion(ip: string | undefined | null): string {
  try {
    if (typeof ip !== 'string') return REGION_UNKNOWN;
    const trimmed = ip.trim();
    if (isPrivateOrReserved(trimmed)) return REGION_UNKNOWN;
    const instance = getSearcher();
    if (!instance) return REGION_UNKNOWN;
    const result = instance.search(trimmed);
    if (!result) return REGION_UNKNOWN;
    const province = normalizeProvince(String(result.province || ''));
    return province || REGION_UNKNOWN;
  } catch {
    return REGION_UNKNOWN;
  }
}
