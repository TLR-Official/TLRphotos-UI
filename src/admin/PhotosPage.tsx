/**
 * 照片审核页
 * 分页展示待审核照片，支持预览原图、通过审核、填写拒绝原因并拒绝。
 * 审核动作成功后从列表中移除该照片并更新总数。
 */
import { useState, useEffect } from 'react';
import { Check, X, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { getPendingPhotos, approvePhoto, rejectPhoto } from './api';
import type { AdminPhoto } from './types';

/**
 * 照片审核页组件
 * @returns 加载态 / 审核列表（含分页、预览弹窗、拒绝弹窗）JSX
 */
export function PhotosPage() {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // 选中的照片：用于预览弹窗与拒绝弹窗的上下文
  const [selectedPhoto, setSelectedPhoto] = useState<AdminPhoto | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // 当前正在处理的照片 id，用于禁用对应卡片按钮，避免重复提交
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
   * 通过审核
   * 成功后从列表移除该照片并递减总数，避免重新请求整页数据。
   * @param id 照片 id
   */
  const handleApprove = async (id: string) => {
    setActionLoading(id);
    const result = await approvePhoto(id);
    if (result.success) {
      setPhotos(photos.filter(p => p.id !== id));
      setTotal(t => t - 1);
    }
    setActionLoading(null);
  };

  /**
   * 拒绝审核
   * 成功后从列表移除该照片、递减总数并关闭拒绝弹窗。
   * @param id 照片 id
   */
  const handleReject = async (id: string) => {
    setActionLoading(id);
    const result = await rejectPhoto(id, rejectReason);
    if (result.success) {
      setPhotos(photos.filter(p => p.id !== id));
      setTotal(t => t - 1);
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedPhoto(null);
    }
    setActionLoading(null);
  };

  /**
   * 打开预览弹窗
   * @param photo 选中的照片
   */
  const handlePreview = (photo: AdminPhoto) => {
    setSelectedPhoto(photo);
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
      <h2 className="text-2xl font-bold text-gray-800 mb-6">照片审核</h2>

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
            {photos.map(photo => (
              <div key={photo.id} className="bg-white rounded-lg overflow-hidden border border-gray-200">
                <div className="relative">
                  <img src={photo.thumbnail_path} alt={photo.title} className="w-full h-48 object-cover" />
                  <button
                    onClick={() => handlePreview(photo)}
                    className="absolute top-2 right-2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4">
                  <h3 className="text-gray-800 font-medium truncate">{photo.title}</h3>
                  <p className="text-gray-500 text-sm mt-1">{photo.uploader_name || '匿名用户'}</p>
                  <p className="text-gray-400 text-xs mt-1">{new Date(photo.created_at).toLocaleString()}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleApprove(photo.id)}
                      disabled={actionLoading === photo.id}
                      className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {actionLoading === photo.id ? '处理中...' : <><Check className="w-4 h-4 inline mr-1" />通过</>}
                    </button>
                    <button
                      onClick={() => { setSelectedPhoto(photo); setShowRejectModal(true); }}
                      disabled={actionLoading === photo.id}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <><X className="w-4 h-4 inline mr-1" />拒绝</>
                    </button>
                  </div>
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

      {selectedPhoto && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => { setSelectedPhoto(null); setShowRejectModal(false); }}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-gray-800 font-medium">{selectedPhoto.title}</h3>
              <button onClick={() => { setSelectedPhoto(null); setShowRejectModal(false); }} className="text-gray-500 hover:text-gray-800">关闭</button>
            </div>
            <div className="p-4">
              <img src={selectedPhoto.original_url} alt={selectedPhoto.title} className="w-full" />
              <div className="mt-4 text-gray-600">
                <p>上传者: {selectedPhoto.uploader_name || '匿名用户'}</p>
                <p>上传时间: {new Date(selectedPhoto.created_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && selectedPhoto && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-gray-800 font-medium">拒绝照片</h3>
            </div>
            <div className="p-4">
              <p className="text-gray-600 mb-4">请输入拒绝原因：</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full h-32 p-3 bg-white border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="请输入拒绝原因..."
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleReject(selectedPhoto.id)}
                  disabled={!rejectReason}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg transition-colors"
                >
                  确认拒绝
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}