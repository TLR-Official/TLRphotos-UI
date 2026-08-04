/**
 * @file 照片上下文
 * @description
 *  全局照片列表状态管理。
 *  核心功能：
 *   1. 维护 photos / isLoading 状态。
 *   2. 应用启动时自动拉取全部照片列表。
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
export function PhotosProvider({ children }: { children: ReactNode }) {
  // 照片列表
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  // 加载中标志
  const [isLoading, setIsLoading] = useState(true);

  /**
   * 拉取照片列表并预缓存缩略图
   * @description 拉取成功后异步预缓存前 10 张缩略图，预加载失败不影响主流程
   */
  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    const result = await getPhotos();
    if (result.success && result.data) {
      setPhotos(result.data);
      // 异步预缓存前 10 张缩略图（不阻塞渲染）
      const thumbnailsToPreload = result.data
        .slice(0, 10)
        .map((p) => p.thumbnail_path)
        .filter(Boolean);
      preloadImages(thumbnailsToPreload).catch(() => {});
    }
    setIsLoading(false);
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
