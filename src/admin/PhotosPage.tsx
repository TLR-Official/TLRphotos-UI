/**
 * 照片审核列表页
 * 分页展示待审核照片，点击卡片跳转到详情页进行审核操作。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { getPendingPhotos, getAdminToken } from './api';
import type { AdminPhoto } from './types';
import { CachedImage } from '../components/CachedImage';

/**
 * 照片审核列表页组件
 * @returns 加载态 / 审核列表（含分页）JSX
 */
export function PhotosPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // 管理员 Token：用于加载需要鉴权的未审核照片缩略图
  const adminToken = getAdminToken();

  // page 变化时重新拉取待审核照片列表
  useEffect(() => {
    fetchPhotos();
  }, [page]);

  /** 拉取当前页待审核照片列表 */
  const fetchPhotos = async () => {
    setLoading(true);
    const result = await getPendingPhotos(page, pageSize);
    if (result.success && result.data) {
      setPhotos(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
  };

  /**
   * 点击照片卡片跳转到详情页
   * @param id 照片 id
   */
  const handlePhotoClick = (id: string) => {
    navigate(`/admin/photos/${id}`);
  };

  /**
   * 切换分页（带边界校验）
   * @param newPage 目标页码
   */
  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setPage(newPage);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">照片审核</h2>
      <p className="text-sm text-gray-500 mb-6">
        共 {total} 张待审核照片，点击卡片进入详情页查看大图和完整信息后进行审核
      </p>

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
            {photos.map(photo => (
              <div
                key={photo.id}
                onClick={() => handlePhotoClick(photo.id)}
                className="bg-white rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:border-purple-300 hover:shadow-md transition-all"
              >
                <div className="relative">
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    authToken={adminToken || undefined}
                    cacheEnabled={false}
                    className="w-full h-48 object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2">
                      <Eye className="w-5 h-5 text-purple-600" />
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-gray-800 font-medium truncate">{photo.title}</h3>
                  <p className="text-gray-500 text-sm mt-1">{photo.uploader_name || '匿名用户'}</p>
                  <p className="text-gray-400 text-xs mt-1">{new Date(photo.created_at).toLocaleString('zh-CN')}</p>
                </div>
              </div>
            ))}
          </div>

          {photos.length === 0 ? (
            <div className="text-center py-10 text-gray-500">暂无待审核照片</div>
          ) : (
            <div className="flex items-center justify-between mt-6">
              <p className="text-gray-500">共 {total} 条记录</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="p-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-gray-600 px-2">{page} / {Math.ceil(total / pageSize)}</span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= Math.ceil(total / pageSize)}
                  className="p-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
