import { useState, useMemo, useEffect } from 'react';
import type { PhotoListItem } from './types';
import { mockPhotos } from './mockData';

interface PhotoCardProps {
  photo: PhotoListItem;
}

// 单张照片卡片组件
function PhotoCard({ photo }: PhotoCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="group relative overflow-hidden rounded-lg bg-gray-100 shadow-md transition-transform duration-300 hover:scale-[1.02] hover:shadow-xl">
      {/* 加载占位符 */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 animate-pulse bg-gray-200" />
      )}
      
      {/* 错误占位符 */}
      {hasError && (
        <div className="flex h-full min-h-[200px] items-center justify-center bg-gray-100 text-gray-400">
          图片加载失败
        </div>
      )}
      
      {/* 图片 */}
      <img
        src={photo.thumbnail_path}
        alt={photo.title}
        className={`h-auto w-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      />
      
      {/* 悬停信息层 */}
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="p-4">
          <h3 className="mb-1 text-lg font-medium text-white">
            {photo.title}
          </h3>
          <div className="flex flex-wrap gap-1">
            {photo.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/90"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 瀑布流布局组件
export function WaterfallGallery() {
  const columnCount = 4;
  const gap = 16;
  const maxWidth = 1600;
  const padding = 32;

  const estimatedColumnWidth = useMemo(() => {
    if (typeof window === 'undefined') return 380;
    const availableWidth = Math.min(window.innerWidth, maxWidth) - padding - gap * (columnCount - 1);
    return availableWidth / columnCount;
  }, [columnCount]);

  const columns = useMemo(() => {
    const newColumns: PhotoListItem[][] = Array.from({ length: columnCount }, () => []);
    const columnHeights = Array.from({ length: columnCount }, () => 0);

    const getPhotoDisplayHeight = (photo: PhotoListItem): number => {
      if (!photo.width || !photo.height) {
        return estimatedColumnWidth * 0.75;
      }
      const aspectRatio = photo.height / photo.width;
      return estimatedColumnWidth * aspectRatio;
    };

    mockPhotos.forEach((photo) => {
      const shortestColumnIndex = columnHeights.indexOf(Math.min(...columnHeights));
      const photoHeight = getPhotoDisplayHeight(photo);
      
      newColumns[shortestColumnIndex].push(photo);
      columnHeights[shortestColumnIndex] += photoHeight + gap;
    });

    return newColumns;
  }, [columnCount, estimatedColumnWidth]);

  return (
    <div className="w-full px-4 py-8">
      {/* 标题 */}
      <h1 className="mb-8 text-center text-3xl font-bold text-gray-800">
        航空摄影作品
      </h1>
      
      {/* 瀑布流网格 */}
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {columns.map((column, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-4">
            {column.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default WaterfallGallery;