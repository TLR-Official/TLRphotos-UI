/**
 * @file authImageCache - 鉴权图片的内存级缓存（V4.10.0）
 * @description
 *  管理端图片必须携带 Authorization 头，无法走 IndexedDB 公共缓存
 *  （缓存后可能绕过鉴权）。本模块提供进程内 LRU：
 *    - 同一 URL + token 只下载一次，CachedImage 与像素分析共用同一个 ObjectURL；
 *    - 并发的相同请求共享同一个 in-flight Promise，消除重复下载；
 *    - 上限 24 项，仅在被淘汰时 revoke，调用方不得自行释放。
 */

/** 缓存条目上限（约 24 × 200KB ≈ 5MB） */
const MAX_ENTRIES = 24;

interface CacheEntry {
  /** 可直接用于 <img src> 的地址（blob: 或降级后的原始 URL） */
  url: string;
  /** 最近访问时间，用于 LRU 淘汰 */
  lastUsed: number;
}

const entries = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/** 缓存键：URL + token 末 12 位（避免完整 token 常驻内存） */
function cacheKey(url: string, token?: string): string {
  return token ? `${url}\u0000${token.slice(-12)}` : url;
}

/** 超出上限时淘汰最久未使用的条目并释放 ObjectURL */
function evictIfNeeded(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const sorted = Array.from(entries.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  const overflow = entries.size - MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    const [key, entry] = sorted[i];
    if (entry.url.startsWith('blob:')) {
      URL.revokeObjectURL(entry.url);
    }
    entries.delete(key);
  }
}

/**
 * 获取鉴权图片的可显示地址。
 * @param url 图片代理地址
 * @param token 管理员 JWT（可选）
 * @returns ObjectURL；网络失败时降级返回原始 URL
 */
export async function getAuthImage(url: string, token?: string): Promise<string> {
  const key = cacheKey(url, token);

  const hit = entries.get(key);
  if (hit) {
    hit.lastUsed = Date.now();
    return hit.url;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        // 失败不缓存，下次仍可重试
        return url;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      entries.set(key, { url: objectUrl, lastUsed: Date.now() });
      evictIfNeeded();
      return objectUrl;
    } catch {
      return url;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** 清空缓存（退出管理后台等场景可调用） */
export function clearAuthImageCache(): void {
  for (const entry of entries.values()) {
    if (entry.url.startsWith('blob:')) {
      URL.revokeObjectURL(entry.url);
    }
  }
  entries.clear();
  inflight.clear();
}
