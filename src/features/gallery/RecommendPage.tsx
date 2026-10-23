/**
 * @file 热门推荐页
 * @description
 *  展示管理端已确认的热门作品（GET /photos/hot），按综合热度（浏览量 + 点赞数×3）降序排列。
 *  以排名卡片网格呈现，点击卡片跳转照片详情；无热门作品时展示空状态并引导前往作品集。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHotPhotos } from '../../api/photos';
import type { PhotoListItem } from './types';
import { CachedImage } from '../../components/CachedImage';

export function RecommendPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /** 拉取已确认热门作品（最多 24 张） */
  useEffect(() => {
    getHotPhotos(24)
      .then((res) => {
        setPhotos(res.success && res.data ? res.data : []);
      })
      .catch(() => setPhotos([]))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">热门推荐</h1>
        <p className="mt-2 text-sm text-gray-500">
          编辑确认的热门作品，按浏览量与人气综合排序；点击任意作品查看详情。
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
        </div>
      ) : photos.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-16 text-center">
          <p className="text-gray-600">暂无已确认的热门作品</p>
          <button
            onClick={() => navigate('/gallery')}
            className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
          >
            前往作品集
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              onClick={() => navigate(`/photos/${photo.id}`)}
              className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white text-left transition-shadow hover:shadow-lg"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
                <CachedImage
                  src={photo.thumbnail_path}
                  alt={photo.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
                  No.{index + 1}
                </span>
              </div>
              <div className="px-4 py-3">
                <h2 className="truncate text-base font-medium text-gray-900">{photo.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {photo.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">
                      {tag}
                    </span>
                  ))}
                  <span className="ml-auto">
                    {photo.views ?? 0} 浏览 · {photo.likes ?? 0} 点赞
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
