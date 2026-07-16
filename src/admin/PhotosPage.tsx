import { useState, useEffect } from 'react';
import { Check, X, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { getPendingPhotos, approvePhoto, rejectPhoto } from './api';
import type { AdminPhoto } from './types';

export function PhotosPage() {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<AdminPhoto | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchPhotos();
  }, [page]);

  const fetchPhotos = async () => {
    setLoading(true);
    const result = await getPendingPhotos(page, pageSize);
    if (result.success && result.data) {
      setPhotos(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    const result = await approvePhoto(id);
    if (result.success) {
      setPhotos(photos.filter(p => p.id !== id));
      setTotal(t => t - 1);
    }
    setActionLoading(null);
  };

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

  const handlePreview = (photo: AdminPhoto) => {
    setSelectedPhoto(photo);
  };

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setPage(newPage);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">照片审核</h2>

      {loading ? (
        <div className="text-white text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
            {photos.map(photo => (
              <div key={photo.id} className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
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
                  <h3 className="text-white font-medium truncate">{photo.title}</h3>
                  <p className="text-slate-400 text-sm mt-1">{photo.uploader_name || '匿名用户'}</p>
                  <p className="text-slate-500 text-xs mt-1">{new Date(photo.created_at).toLocaleString()}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleApprove(photo.id)}
                      disabled={actionLoading === photo.id}
                      className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {actionLoading === photo.id ? '处理中...' : <><Check className="w-4 h-4 inline mr-1" />通过</>}
                    </button>
                    <button
                      onClick={() => { setSelectedPhoto(photo); setShowRejectModal(true); }}
                      disabled={actionLoading === photo.id}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <><X className="w-4 h-4 inline mr-1" />拒绝</>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {photos.length === 0 ? (
            <div className="text-center py-10 text-slate-400">暂无待审核照片</div>
          ) : (
            <div className="flex items-center justify-between mt-6">
              <p className="text-slate-400">共 {total} 条记录</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="p-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-slate-300 px-2">{page} / {Math.ceil(total / pageSize)}</span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= Math.ceil(total / pageSize)}
                  className="p-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors"
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
          <div className="bg-slate-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-white font-medium">{selectedPhoto.title}</h3>
              <button onClick={() => { setSelectedPhoto(null); setShowRejectModal(false); }} className="text-slate-400 hover:text-white">关闭</button>
            </div>
            <div className="p-4">
              <img src={selectedPhoto.original_url} alt={selectedPhoto.title} className="w-full" />
              <div className="mt-4 text-slate-300">
                <p>上传者: {selectedPhoto.uploader_name || '匿名用户'}</p>
                <p>上传时间: {new Date(selectedPhoto.created_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && selectedPhoto && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-white font-medium">拒绝照片</h3>
            </div>
            <div className="p-4">
              <p className="text-slate-300 mb-4">请输入拒绝原因：</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full h-32 p-3 bg-slate-900 border border-slate-600 rounded-lg text-white resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="请输入拒绝原因..."
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleReject(selectedPhoto.id)}
                  disabled={!rejectReason}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white rounded-lg transition-colors"
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