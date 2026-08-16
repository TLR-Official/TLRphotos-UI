/**
 * @file CachedImage 组件
 * @description
 *  替换原生 <img> 标签，自动通过 IndexedDB 本地缓存图片资源。
 *  核心功能：
 *   1. 优先从缓存加载（ObjectURL），缓存未命中时从网络获取并缓存。
 *   2. 自动管理 ObjectURL 生命周期，组件卸载或 src 变更时 revoke 释放内存。
 *   3. 失败时降级为直接加载原始 URL。
 *   4. 向下兼容：接受所有原生 img 属性。
 *   5. 支持基于角色的访问控制：
 *      - authToken：携带管理员/用户 JWT 请求需要鉴权的图片（如未审核照片）。
 *      - status：当图片未审核（pending/rejected）且未携带 authToken 时，显示"审核中"占位符。
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
  /** 认证 Token（管理员或用户 JWT），用于请求需要鉴权的图片 */
  authToken?: string;
  /** 图片审核状态（approved/pending/rejected），未审核时显示占位提示 */
  status?: string;
}

/**
 * 缓存图片组件
 * @param props - 见 CachedImageProps
 * @returns 加载完成返回 <img>；加载中返回占位 div；未审核返回审核中提示
 */
export function CachedImage({
  src,
  cacheEnabled = true,
  className = '',
  placeholderClassName = '',
  alt = '',
  authToken,
  status,
  ...imgProps
}: CachedImageProps) {
  // 是否需要走 fetch 路径：启用缓存或携带 authToken 时都必须走 fetch
  // 关键：authToken 必须通过 fetch 的 Authorization 头传递，原生 <img> 标签无法携带自定义头
  const shouldFetch = cacheEnabled || !!authToken;
  const [displaySrc, setDisplaySrc] = useState<string>(shouldFetch ? '' : src);
  // 持有当前 ObjectURL，便于后续释放
  const objectUrlRef = useRef<string | null>(null);

  /**
   * 监听 src / cacheEnabled / authToken 变化：从缓存或网络加载图片
   * 依赖：[src, shouldFetch, authToken] - 任一变化需重新加载
   * 清理：通过 cancelled 标志位避免竞态（异步结果到达时组件可能已卸载或 src 已变更）
   */
  useEffect(() => {
    if (!shouldFetch || !src) {
      setDisplaySrc(src);
      return;
    }

    // 标志位：用于在异步回调中判断是否已被取消
    let cancelled = false;

    (async () => {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
      const cachedUrl = await getCachedImage(src, headers);

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
  }, [src, shouldFetch, authToken]);

  // 组件卸载时释放 ObjectURL，避免内存泄漏
  // 依赖为空数组，仅在卸载时执行一次
  useEffect(() => {
    return () => {
      if (objectUrlRef.current && objectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  // 未审核状态且无认证 Token：显示"审核中"占位提示
  if (status && status !== 'approved' && !authToken) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-100 ${placeholderClassName} ${className}`}
        aria-label={alt}
      >
        <svg
          className="w-10 h-10 text-gray-400 mb-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="text-sm text-gray-500 text-center px-2">
          图片正在审核中
          <br />
          暂时无法查看
        </span>
      </div>
    );
  }

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
