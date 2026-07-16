import { useState, useEffect } from 'react';
import { Image, CheckCircle, XCircle, Clock, ArrowRight, Search, Filter } from 'lucide-react';
import { getPendingPhotos, approvePhoto, rejectPhoto } from './api';
import type { AdminPhoto } from './types';

export function PhotosPage() {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<AdminPhoto | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('pending');

  useEffect(() => {
    const fetchPhotos = async () => {
      const result = await getPendingPhotos();
      if (result.success && result.data) {
        setPhotos(result.data);
      }
      setLoading(false);
    };
    fetchPhotos();
  }, []);

  const handleApprove = async (photoId: string) => {
    const result = await approvePhoto(photoId);
    if (result.success) {
      setPhotos(photos.filter(p => p.id !== photoId));
      if (selectedPhoto?.id === photoId) {
        setSelectedPhoto(null);
      }
    }
  };

  const handleReject = async (photoId: string) => {
    const result = await rejectPhoto(photoId);
    if (result.success) {
      setPhotos(photos.filter(p => p.id !== photoId));
      if (selectedPhoto?.id === photoId) {
        setSelectedPhoto(null);
      }
    }
  };

  const filteredPhotos = photos.filter(photo => {
    const matchesSearch = photo.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (photo.tags && photo.tags.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = photo.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const statusLabel = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
  };

  const statusColor = {
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    approved: 'bg-green-500/10 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">照片审核</h2>
          <p className="text-slate-400 mt-1">审核用户上传的照片</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="搜索照片标题或标签..."
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="pl-12 pr-8 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none cursor-pointer"
          >
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已拒绝</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {filteredPhotos.length === 0 ? (
            <div className="bg-slate-800/50 rounded-xl p-12 border border-slate-700 text-center">
              <Image className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">暂无{statusLabel[filterStatus as keyof typeof statusLabel]}的照片</p>
            </div>
          ) : (
            filteredPhotos.map(photo => (
              <div
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                className={`bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden cursor-pointer transition-all hover:border-blue-500/50 hover:shadow-lg ${
                  selectedPhoto?.id === photo.id ? 'border-blue-500 shadow-lg shadow-blue-500/20' : ''
                }`}
              >
                <div className="flex">
                  <div className="w-48 h-32 flex-shrink-0">
                    <img
                      src={photo.preview_url || photo.thumbnail_path}
                      alt={photo.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-white font-semibold truncate flex-1 mr-2">{photo.title}</h3>
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${statusColor[photo.status as keyof typeof statusColor]}`}>
                        {statusLabel[photo.status as keyof typeof statusLabel]}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-400 mb-3">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {photo.created_at?.split('T')[0]}
                      </span>
                      <span>{photo.user_id ? `用户 ${photo.user_id.slice(0, 8)}...` : '匿名用户'}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {photo.tags && JSON.parse(photo.tags).slice(0, 3).map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="p-4 flex flex-col justify-center gap-2 border-l border-slate-700">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleApprove(photo.id); }}
                      className="w-10 h-10 bg-green-500/10 hover:bg-green-500/20 rounded-lg flex items-center justify-center text-green-400 hover:text-green-300 transition-all"
                      title="通过"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReject(photo.id); }}
                      className="w-10 h-10 bg-red-500/10 hover:bg-red-500/20 rounded-lg flex items-center justify-center text-red-400 hover:text-red-300 transition-all"
                      title="拒绝"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {selectedPhoto && (
          <div className="lg:col-span-1">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 sticky top-24">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">照片详情</h3>
                <button
                  onClick={() => setSelectedPhoto(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
              <div className="rounded-xl overflow-hidden mb-4">
                <img
                  src={selectedPhoto.watermarked_url || selectedPhoto.preview_url || selectedPhoto.thumbnail_path}
                  alt={selectedPhoto.title}
                  className="w-full"
                />
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">标题</label>
                  <p className="text-white text-sm">{selectedPhoto.title}</p>
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">描述</label>
                  <p className="text-slate-300 text-sm">{selectedPhoto.description || '无'}</p>
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">标签</label>
                  <div className="flex flex-wrap gap-1">
                    {selectedPhoto.tags && JSON.parse(selectedPhoto.tags).map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-500 text-xs block mb-1">尺寸</label>
                    <p className="text-slate-300 text-sm">{selectedPhoto.width} × {selectedPhoto.height}</p>
                  </div>
                  <div>
                    <label className="text-slate-500 text-xs block mb-1">分类</label>
                    <p className="text-slate-300 text-sm">{selectedPhoto.category || '未分类'}</p>
                  </div>
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">上传时间</label>
                  <p className="text-slate-300 text-sm">{selectedPhoto.created_at}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleApprove(selectedPhoto.id)}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-all"
                >
                  通 过
                </button>
                <button
                  onClick={() => handleReject(selectedPhoto.id)}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-all"
                >
                  拒 绝
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}