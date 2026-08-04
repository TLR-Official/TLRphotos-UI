/**
 * @file 基于 IndexedDB 的 LRU 图片缓存服务
 * @description
 *  用于缓存图片资源，减少网络请求并加速图片渲染。
 *  核心功能：
 *   1. 使用 IndexedDB 存储 Blob 数据，支持大容量缓存（默认 500MB）。
 *   2. LRU（Least Recently Used）淘汰算法：容量超限时清理最久未访问的条目。
 *   3. 全异步操作，不阻塞主线程。
 *   4. 命中率、大小等指标统计，并持久化到 IndexedDB。
 *   5. 增量缓存：仅在未命中时才写入，避免重复存储。
 *   6. IndexedDB 不可用时自动降级为直接返回原始 URL。
 */

const DB_NAME = 'TLRphotosImageCache';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const META_STORE = 'meta';

// 默认最大缓存容量 500MB
const DEFAULT_MAX_SIZE = 500 * 1024 * 1024;
// 单次清理时额外多清理的比例，避免频繁触发清理
const EVICT_EXTRA_RATIO = 0.1;

export interface CacheMeta {
  totalSize: number;
  totalEntries: number;
  hits: number;
  misses: number;
}

export interface CacheEntry {
  url: string;           // 原始 URL 作为 key
  blob: Blob;            // 图片二进制数据
  size: number;          // 数据大小（字节）
  contentType: string;   // MIME 类型
  createdAt: number;     // 创建时间戳
  lastAccessedAt: number;// 最后访问时间戳
  accessCount: number;   // 访问次数
}

export interface CacheStats {
  size: number;          // 当前缓存大小（字节）
  entries: number;       // 缓存条目数
  maxSize: number;       // 最大容量
  hits: number;          // 命中次数
  misses: number;        // 未命中次数
  hitRate: number;       // 命中率
}

let dbInstance: IDBDatabase | null = null;
let maxCacheSize = DEFAULT_MAX_SIZE;

// 指标统计（内存中维护，避免频繁读 IndexedDB）
let statsHits = 0;
let statsMisses = 0;

/**
 * 打开 / 获取 IndexedDB 连接（单例）
 * @returns IDBDatabase 实例
 */
function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 图片存储：以 URL 为 key
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        store.createIndex('size', 'size', { unique: false });
      }

      // 元数据存储
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
  });
}

/**
 * 从 meta store 读取值
 * @template T - 值的类型
 * @param key - 元数据键名
 * @returns 值（不存在时为 null）
 */
async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 写入 meta store
 * @param key - 元数据键名
 * @param value - 元数据值
 */
async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 初始化：从 IndexedDB 恢复 hits / misses 指标统计
 */
async function initStats(): Promise<void> {
  const [hits, misses] = await Promise.all([
    getMeta<number>('hits'),
    getMeta<number>('misses'),
  ]);
  statsHits = hits ?? 0;
  statsMisses = misses ?? 0;
}

// 延迟初始化 Promise（单例，避免重复初始化）
let initPromise: Promise<void> | null = null;
/**
 * 确保指标统计已从 IndexedDB 恢复（仅初始化一次）
 */
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initStats().catch(() => {
      // IndexedDB 不可用时静默失败
    });
  }
  return initPromise;
}

/**
 * 持久化指标到 IndexedDB（节流：2s 内多次调用合并为一次写入）
 */
let saveStatsTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveStats(): void {
  if (saveStatsTimer) clearTimeout(saveStatsTimer);
  saveStatsTimer = setTimeout(() => {
    Promise.all([setMeta('hits', statsHits), setMeta('misses', statsMisses)]).catch(() => {});
  }, 2000);
}

/**
 * 获取缓存总大小和条目数
 * @returns { size: 字节总数; entries: 条目数 }
 */
async function getCacheSize(): Promise<{ size: number; entries: number }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as CacheEntry[];
      const size = all.reduce((sum, e) => sum + e.size, 0);
      resolve({ size, entries: all.length });
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * LRU 淘汰：清理最久未访问的条目，直到总大小低于阈值
 * @description 通过 lastAccessedAt 索引升序遍历，按访问时间从旧到新逐条删除，
 *  直至释放的空间达到 needToFree。目标大小额外下调 EVICT_EXTRA_RATIO，避免频繁触发清理。
 */
async function evictIfNeeded(): Promise<void> {
  const { size } = await getCacheSize();
  if (size <= maxCacheSize) return;

  const db = await openDB();
  // 目标大小：上限减去额外比例，留出缓冲空间
  const targetSize = maxCacheSize * (1 - EVICT_EXTRA_RATIO);
  const needToFree = size - targetSize;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('lastAccessedAt');
    const cursorReq = index.openCursor();

    let freedSize = 0;

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || freedSize >= needToFree) {
        // 已清理足够空间或遍历完毕
        return;
      }

      const entry = cursor.value as CacheEntry;
      freedSize += entry.size;
      cursor.delete();
      cursor.continue();
    };

    cursorReq.onerror = () => reject(cursorReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============ 公共 API ============

/**
 * 从缓存获取图片，如果未命中则从网络获取并缓存
 * @param url 图片 URL
 * @returns ObjectURL（调用方负责 revokeObjectURL）或原始 URL（降级）
 */
export async function getCachedImage(url: string): Promise<string> {
  await ensureInit();

  try {
    const db = await openDB();

    // 1. 尝试从缓存读取
    const cached = await new Promise<CacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });

    if (cached) {
      // 命中：更新访问时间
      cached.lastAccessedAt = Date.now();
      cached.accessCount++;

      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(cached);
      tx.oncomplete = () => {};
      tx.onerror = () => {};

      statsHits++;
      scheduleSaveStats();
      return URL.createObjectURL(cached.blob);
    }

    // 2. 未命中：从网络获取
    statsMisses++;
    scheduleSaveStats();

    const response = await fetch(url);
    if (!response.ok) {
      // 网络失败时返回原始 URL 作为降级
      return url;
    }

    const blob = await response.blob();
    const contentType = blob.type || 'image/jpeg';
    const size = blob.size;

    // 3. 存入缓存（增量缓存：仅当图片不在缓存中时才存储）
    const entry: CacheEntry = {
      url,
      blob,
      size,
      contentType,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => {
      // 4. 异步执行 LRU 淘汰
      evictIfNeeded().catch(() => {});
    };
    tx.onerror = () => {};

    return URL.createObjectURL(blob);
  } catch {
    // IndexedDB 不可用或任何错误，降级为直接使用原始 URL
    return url;
  }
}

/**
 * 预加载图片到缓存（不返回 ObjectURL，仅写入缓存）
 * @param url - 图片 URL
 */
export async function preloadImage(url: string): Promise<void> {
  await ensureInit();

  try {
    const db = await openDB();

    // 检查是否已存在
    const existing = await new Promise<CacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });

    if (existing) {
      return; // 已缓存，跳过
    }

    const response = await fetch(url);
    if (!response.ok) return;

    const blob = await response.blob();
    const entry: CacheEntry = {
      url,
      blob,
      size: blob.size,
      contentType: blob.type || 'image/jpeg',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => evictIfNeeded().catch(() => {});
  } catch {
    // 静默失败
  }
}

/**
 * 批量预加载
 * @param urls - 图片 URL 列表
 * @description 按 CONCURRENCY 大小分块并发执行，避免浏览器连接数耗尽
 */
export async function preloadImages(urls: string[]): Promise<void> {
  // 限制并发数，避免浏览器连接数耗尽
  const CONCURRENCY = 6;
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    chunks.push(urls.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    await Promise.allSettled(chunk.map((url) => preloadImage(url)));
  }
}

/**
 * 清除全部缓存（含图片数据与指标统计）
 */
export async function clearCache(): Promise<void> {
  await ensureInit();

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => {
      statsHits = 0;
      statsMisses = 0;
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 获取缓存统计信息
 * @returns CacheStats（含大小、条目数、命中率等）
 */
export async function getCacheStats(): Promise<CacheStats> {
  await ensureInit();

  try {
    const { size, entries } = await getCacheSize();
    const total = statsHits + statsMisses;
    return {
      size,
      entries,
      maxSize: maxCacheSize,
      hits: statsHits,
      misses: statsMisses,
      hitRate: total > 0 ? statsHits / total : 0,
    };
  } catch {
    return {
      size: 0,
      entries: 0,
      maxSize: maxCacheSize,
      hits: statsHits,
      misses: statsMisses,
      hitRate: 0,
    };
  }
}

/**
 * 设置最大缓存容量
 * @param size - 最大容量（字节）
 * @description 设置后异步触发一次 LRU 清理
 */
export function setMaxCacheSize(size: number): void {
  maxCacheSize = size;
  // 异步触发清理
  evictIfNeeded().catch(() => {});
}

/**
 * 格式化字节数为可读字符串
 * @param bytes - 字节数
 * @returns 形如 "1.23 MB" 的字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
