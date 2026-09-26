/**
 * @file MyWorksPage.tsx
 * @description 我的作品独立页面。
 *              展示当前登录用户上传的全部照片（已通过/待审核/未通过），
 *              顶部状态筛选，未通过照片显示驳回理由。
 *              数据来源：GET /api/auth/me/photos（getMyPhotos）。
 *              V1.10.3 新增，入口为 Header 头像下拉与个人中心快捷按钮。
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../shared/UserContext';
import { getMyPhotos } from '../../api/auth';
import type { MyPhoto } from '../../api/auth';
import { CachedImage } from '../../components/CachedImage';

type PhotoFilter = 'all' | 'pending' | 'approved' | 'rejected';

export function MyWorksPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, token } = useUser();

  const [myPhotos, setMyPhotos] = useState<MyPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>('all');

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    const statusParam = photoFilter === 'all' ? undefined : photoFilter;
    getMyPhotos(statusParam, 1, 50)
      .then((res) => {
        if (res.success && res.data) {
          setMyPhotos(res.data.photos);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id, photoFilter]);

  // 未登录引导
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">我的作品</h1>
          <p className="text-gray-500 mb-6">登录后即可查看您上传的所有照片</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-3 rounded-lg font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">我的作品</h1>
          <p className="text-sm text-gray-500 mt-1">
            共 {myPhotos.length} 张，包含已通过、待审核与未通过的全部照片
          </p>
        </div>

        {/* 状态筛选 */}
        <div className="flex gap-2 flex-wrap mb-6">
          {([
            { key: 'all', label: '全部' },
            { key: 'pending', label: '待审核' },
            { key: 'approved', label: '已通过' },
            { key: 'rejected', label: '未通过' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPhotoFilter(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                photoFilter === key
                  ? 'bg-teal-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 加载状态 */}
        {loading && (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        )}

        {/* 空态 */}
        {!loading && myPhotos.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {photoFilter === 'all' ? '暂无照片，快去上传一些吧！' : '此状态下没有照片'}
          </div>
        )}

        {/* 照片网格 */}
        {!loading && myPhotos.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myPhotos.map((photo) => (
              <div
                key={photo.id}
                onClick={() => navigate(`/photos/${photo.id}`)}
                className={`rounded-xl overflow-hidden border transition-all cursor-pointer hover:shadow-md ${
                  photo.status === 'pending'
                    ? 'border-yellow-300 bg-yellow-50'
                    : photo.status === 'rejected'
                    ? 'border-red-300 bg-red-50'
                    : 'border-green-200 bg-white'
                }`}
              >
                {/* 缩略图 */}
                <div className="relative aspect-video bg-gray-100">
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    status={photo.status}
                    authToken={token || undefined}
                    cacheEnabled={photo.status === 'approved'}
                    className="w-full h-full object-cover"
                  />
                  {/* 状态徽章 */}
                  <span
                    className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium text-white ${
                      photo.status === 'pending'
                        ? 'bg-yellow-500'
                        : photo.status === 'rejected'
                        ? 'bg-red-500'
                        : 'bg-green-500'
                    }`}
                  >
                    {photo.status === 'pending'
                      ? '待审核'
                      : photo.status === 'rejected'
                      ? '未通过'
                      : '已通过'}
                  </span>
                </div>

                {/* 照片信息 */}
                <div className="p-3">
                  <h4 className="font-medium text-sm text-gray-800 truncate">
                    {photo.title}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(photo.created_at).toLocaleDateString('zh-CN')}
                  </p>

                  {/* 驳回理由 */}
                  {photo.status === 'rejected' && photo.rejection_reason && (
                    <div className="mt-2 p-2 rounded-lg bg-red-100 border border-red-200">
                      <p className="text-xs font-medium text-red-700 mb-0.5">驳回理由：</p>
                      <p className="text-xs text-red-600">{photo.rejection_reason}</p>
                    </div>
                  )}

                  {/* 标签 */}
                  {photo.tags && photo.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {photo.tags.slice(0, 3).map((tag, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
