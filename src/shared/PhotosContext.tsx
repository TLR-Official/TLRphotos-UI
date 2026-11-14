/**
 * @file 照片上下文
 * @description
 *  全局照片列表状态管理。
 *  核心功能：
 *   1. 维护 photos / isLoading 状态。
 *   2. 应用启动时按分区拉取照片并合并（保证首页板块墙覆盖各大板块）。
 *   3. 异步预缓存前 10 张缩略图，加速首屏渲染。
 *   4. 提供 refreshPhotos 方法供调用方主动刷新。
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { getPhotos } from '../api/photos';
import type { PhotoListItem } from '../features/gallery/types';
import { preloadImages } from '../utils/imageCache';

/**
 * 照片上下文类型
 */
interface PhotosContextType {
  photos: PhotoListItem[];   // 照片列表
  isLoading: boolean;        // 加载中标志
  refreshPhotos: () => void; // 刷新照片列表
}

const PhotosContext = createContext<PhotosContextType | undefined>(undefined);

/**
 * 照片状态 Provider
 * @param children - 子组件树
 */
/** 首页板块墙分区（与 src/shared/tagCatalog.ts 的 PhotoCategory 一致） */
const BOARD_CATEGORIES = ['aviation', 'railway', 'automobile'] as const;
/** 每个分区的拉取上限（后端 GET /photos 单页上限 100） */
const BOARD_LIMIT = 100;

export function PhotosProvider({ children }: { children: ReactNode }) {
  // 照片列表
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  // 加载中标志
  const [isLoading, setIsLoading] = useState(true);

  /**
   * 拉取照片列表并预缓存缩略图
   * @description
   *  按分区各取一页后合并去重，避免「全站最新 50 张」集中在单一分区时，
   *  首页板块墙缺失其他分区的标签组；合并后按上传时间倒序、id 兜底还原全站顺序。
   *  拉取成功后异步预缓存前 10 张缩略图，预加载失败不影响主流程。
   */
  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await Promise.all(
        BOARD_CATEGORIES.map((category) => getPhotos(category, BOARD_LIMIT)),
      );
      const merged = new Map<string, PhotoListItem>();
      for (const result of results) {
        if (result.success && result.data) {
          for (const photo of result.data) merged.set(photo.id, photo);
        }
      }
      // 全部请求失败时保留现有列表，避免首页闪空
      if (merged.size > 0) {
        const timeOf = (value?: string) => {
          const ts = value ? Date.parse(value) : NaN;
          return Number.isFinite(ts) ? ts : 0;
        };
        const list = Array.from(merged.values()).sort((a, b) => {
          const byTime = timeOf(b.created_at) - timeOf(a.created_at);
          return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
        });
        setPhotos(list);
        // 异步预缓存前 10 张缩略图（不阻塞渲染）
        const thumbnailsToPreload = list
          .slice(0, 10)
          .map((p) => p.thumbnail_path)
          .filter(Boolean);
        preloadImages(thumbnailsToPreload).catch(() => {});
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 应用启动时加载照片
   * 依赖：[loadPhotos] - loadPhotos 为 useCallback 稳定引用，仅触发一次
   */
  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  return (
    <PhotosContext.Provider value={{ photos, isLoading, refreshPhotos: loadPhotos }}>
      {children}
    </PhotosContext.Provider>
  );
}

/**
 * 照片上下文 Hook
 * @returns PhotosContextType
 * @throws 必须在 PhotosProvider 内使用，否则抛错
 */
export function usePhotos() {
  const context = useContext(PhotosContext);
  if (!context) {
    throw new Error('usePhotos must be used within PhotosProvider');
  }
  return context;
}
