/**
 * CachedImage 组件
 *
 * 替换原生 <img> 标签，自动通过 IndexedDB 本地缓存图片资源。
 * - 优先从缓存加载（ObjectURL），缓存未命中时从网络获取并缓存
 * - 自动管理 ObjectURL 生命周期，组件卸载时 revoke
 * - 失败时降级为直接加载原始 URL
 * - 向下兼容：接受所有原生 img 属性
 */

import { useState, useEffect, useRef } from 'react';
import { getCachedImage } from '../utils/imageCache';

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  /** 是否启用缓存（默认 true） */
  cacheEnabled?: boolean;
  /** 加载中占位样式 */
  placeholderClassName?: string;
}

export function CachedImage({
  src,
  cacheEnabled = true,
  className = '',
  placeholderClassName = '',
  alt = '',
  ...imgProps
}: CachedImageProps) {
  const [displaySrc, setDisplaySrc] = useState<string>(cacheEnabled ? '' : src);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cacheEnabled || !src) {
      setDisplaySrc(src);
      return;
    }

    let cancelled = false;

    (async () => {
      const cachedUrl = await getCachedImage(src);

      if (cancelled) {
        // 组件已卸载或 src 已变更，释放 ObjectURL
        if (cachedUrl.startsWith('blob:')) {
          URL.revokeObjectURL(cachedUrl);
        }
        return;
      }

      // 释放上一个 ObjectURL
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

  // 组件卸载时释放 ObjectURL
  useEffect(() => {
    return () => {
      if (objectUrlRef.current && objectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

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
