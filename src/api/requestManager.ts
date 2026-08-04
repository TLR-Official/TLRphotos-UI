/**
 * @file 请求管理器
 * @description
 *  对并发请求进行去重，避免相同 key 的请求重复发起。
 *  核心功能：
 *   1. deduplicatedRequest：相同 key 的并发请求共享同一个 Promise，仅触发一次实际请求。
 *   2. clearPendingRequest / clearAllPendingRequests：手动清除挂起的请求。
 *  使用场景：登录、注册等需防止重复提交的接口。
 */

// 挂起中的请求映射表：key -> Promise
const pendingRequests = new Map<string, Promise<any>>();

/**
 * 去重请求：相同 key 的并发请求复用同一个 Promise
 * @template T - 请求返回类型
 * @param key - 去重键（如 `login:user@example.com`）
 * @param requestFn - 实际发起请求的工厂函数
 * @returns 共享的 Promise<T>
 */
export async function deduplicatedRequest<T>(
  key: string,
  requestFn: () => Promise<T>
): Promise<T> {
  // 已存在相同 key 的挂起请求，直接复用
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key)!;
  }

  // 发起新请求：完成后（无论成功/失败）从映射表中移除，避免内存泄漏
  const promise = requestFn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

/**
 * 清除指定 key 的挂起请求（不会取消已发起的请求，仅从映射表中移除）
 * @param key - 去重键
 */
export function clearPendingRequest(key: string): void {
  pendingRequests.delete(key);
}

/**
 * 清除所有挂起的请求
 */
export function clearAllPendingRequests(): void {
  pendingRequests.clear();
}