/**
 * @file CachedImage 组件
 * @description
 *  替换原生 <img> 标签，自动通过 IndexedDB 本地缓存图片资源。
 *  核心功能：
 *   1. 优先从缓存加载（ObjectURL），缓存未命中时从网络获取并缓存。
 *   2. 自动管理 ObjectURL 生命周期，组件卸载或 src 变更时 revoke 释放内存。
 *   3. 失败时降级为直接加载原始 URL。
 *   4. 向下兼容：接受所有原生 img 属性。
 */

import { useState, useEffect, useRef } from 'react';
import { getCachedImage } from '../utils/imageCache';

/**
 * CachedImage 组件 Props
 * @extends React.ImgHTMLAttributes<HTMLImageElement> - 透传所有原生 img 属性
 */
interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** 图片地址 */
  src: string;
  /** 是否启用缓存（默认 true） */
  cacheEnabled?: boolean;
  /** 加载中占位样式 */
  placeholderClassName?: string;
}

/**
 * 缓存图片组件
 * @param props - 见 CachedImageProps
 * @returns 加载完成返回 <img>；加载中返回占位 div
 */
export function CachedImage({
  src,
  cacheEnabled = true,
  className = '',
  placeholderClassName = '',
  alt = '',
  ...imgProps
}: CachedImageProps) {
  // 实际渲染使用的图片地址：可能为 ObjectURL 或原始 URL
  // cacheEnabled 为 true 时初始为空字符串，触发占位状态
  const [displaySrc, setDisplaySrc] = useState<string>(cacheEnabled ? '' : src);
  // 持有当前 ObjectURL，便于后续释放
  const objectUrlRef = useRef<string | null>(null);

  /**
   * 监听 src / cacheEnabled 变化：从缓存或网络加载图片
   * 依赖：[src, cacheEnabled] - 任一变化需重新加载
   * 清理：通过 cancelled 标志位避免竞态（异步结果到达时组件可能已卸载或 src 已变更）
   */
  useEffect(() => {
    if (!cacheEnabled || !src) {
      setDisplaySrc(src);
      return;
    }

    // 标志位：用于在异步回调中判断是否已被取消
    let cancelled = false;

    (async () => {
      const cachedUrl = await getCachedImage(src);

      if (cancelled) {
        // 组件已卸载或 src 已变更，立即释放本次返回的 ObjectURL 避免内存泄漏
        if (cachedUrl.startsWith('blob:')) {
          URL.revokeObjectURL(cachedUrl);
        }
        return;
      }

      // 释放上一个 ObjectURL，避免内存泄漏
      if (objectUrlRef.current && objectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      objectUrlRef.current = cachedUrl;
      setDisplaySrc(cachedUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [src, cacheEnabled]);

  // 组件卸载时释放 ObjectURL，避免内存泄漏
  // 依赖为空数组，仅在卸载时执行一次
  useEffect(() => {
    return () => {
      if (objectUrlRef.current && objectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  // 加载中：渲染灰色脉冲占位
  if (!displaySrc) {
    return (
      <div
        className={`animate-pulse bg-gray-200 ${placeholderClassName} ${className}`}
        aria-label={alt}
      />
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      {...imgProps}
    />
  );
}

export default CachedImage;
