/**
 * @file commentCache.ts（V3.0.0）
 * @description 归档评论线程的 IndexedDB 本地缓存。
 *              - 版本化库结构（DB_VERSION，结构变更升级版本号）；
 *              - 每条缓存写入 cachedAt，TTL（ARCHIVE_CACHE_TTL_MS，默认 7 天）；
 *              - 过期/缺失返回 null 由调用方向云端重取（失效重取）；
 *              - 签名 URL 失效（403）时调用方应 evict 后重新取 URL 与负载。
 */
import type { ArchivedThreadPayloadDTO } from '../../api/comments';

const DB_NAME = 'tlr-comments-cache';
const DB_VERSION = 1;
const STORE = 'archived-threads';

/** 归档缓存 TTL：7 天（云负载为不可变历史快照；TTL 主要控制本地占用） */
export const ARCHIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedEntry {
  rootId: string;
  payload: ArchivedThreadPayloadDTO;
  cachedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开/复用缓存库 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'rootId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** 单次对象存储请求 Promise 化 */
function tx<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 读取缓存；不存在/过期返回 null（调用方应回源）。
 */
export async function getCachedArchivedThread(
  rootId: string,
  now: number = Date.now()
): Promise<ArchivedThreadPayloadDTO | null> {
  const database = await openDb();
  const objectStore = database.transaction(STORE, 'readonly').objectStore(STORE);
  const entry = await tx<CachedEntry | undefined>(objectStore.get(rootId));
  if (!entry) return null;
  if (now - new Date(entry.cachedAt).getTime() > ARCHIVE_CACHE_TTL_MS) {
    await evictArchivedThread(rootId);
    return null;
  }
  return entry.payload;
}

/**
 * 写入/刷新缓存。
 */
export async function setCachedArchivedThread(
  rootId: string,
  payload: ArchivedThreadPayloadDTO
): Promise<void> {
  const database = await openDb();
  const entry: CachedEntry = { rootId, payload, cachedAt: new Date().toISOString() };
  const objectStore = database.transaction(STORE, 'readwrite').objectStore(STORE);
  await tx(objectStore.put(entry));
}

/**
 * 淘汰单条缓存（签名 URL 失效/负载损坏时强制回源）。
 */
export async function evictArchivedThread(rootId: string): Promise<void> {
  const database = await openDb();
  const objectStore = database.transaction(STORE, 'readwrite').objectStore(STORE);
  await tx(objectStore.delete(rootId));
}
