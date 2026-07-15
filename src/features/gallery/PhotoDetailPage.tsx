import { useParams, useNavigate } from 'react-router-dom';
import { getPhotoById, deletePhoto } from '../../api/photos';
import { useTheme } from '../../shared/ThemeContext';
import { useUser } from '../../shared/UserContext';
import { useState, useEffect } from 'react';
import type { PhotoDetail } from './types';
import { formatDate } from '../../shared/utils';


export function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user, token } = useUser();
  const [photo, setPhoto] = useState<PhotoDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState('');

  useEffect(() => {
    const abortController = new AbortController();

    getPhotoById(id || '').then((result) => {
      if (result.success && result.data) {
        setPhoto(result.data);
      }
      setIsLoading(false);
    });

    return () => {
      abortController.abort();
    };
  }, [id]);

  const handleDelete = async () => {
    if (!id || !token || isDeleting) return;

    setIsDeleting(true);
    const result = await deletePhoto(id, token);
    
    if (result.success) {
      navigate('/gallery');
    } else {
      setDeleteMessage(result.message || '删除失败');
      setTimeout(() => {
        setDeleteMessage('');
        setDeleteConfirmStep(0);
      }, 3000);
    }
    
    setIsDeleting(false);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmStep < 2) {
      setDeleteConfirmStep(deleteConfirmStep + 1);
    } else {
      handleDelete();
    }
  };

  const isOwner = user && photo && photo.user_id === user.id;

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className={`w-8 h-8 border-4 border-t-transparent rounded-full animate-spin ${
          theme === 'dark' ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-blue-600'
        }`} />
      </div>
    );
  }

  if (!photo) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-4 theme-text-transition ${
            theme === 'dark' ? 'text-white' : 'text-gray-800'
          }`}>照片不存在</h1>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate('/gallery');
          }}
          className={`flex items-center gap-2 mb-6 transition-colors theme-text-transition ${
            theme === 'dark'
              ? 'text-slate-300 hover:text-white'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回作品集
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 flex justify-center items-start">
            <div className={`rounded-xl shadow-lg overflow-hidden theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <img
                src={photo.watermarked_url || photo.preview_url || photo.original_url}
                alt={photo.title}
                className="block max-w-full h-auto"
              />
            </div>
          </div>

          <div className="space-y-6">
            {photo.uploader && (
              <div
                onClick={() => navigate(`/users/${photo.uploader!.id}`)}
                className={`rounded-xl shadow-lg p-4 theme-bg-transition cursor-pointer hover:shadow-xl transition-shadow ${
                  theme === 'dark' ? 'glass' : 'bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full overflow-hidden flex-shrink-0 ${
                    photo.uploader.avatar_url
                      ? ''
                      : 'bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center'
                  }`}>
                    {photo.uploader.avatar_url ? (
                      <img
                        src={photo.uploader.avatar_url.startsWith('/') ? `/api${photo.uploader.avatar_url}` : photo.uploader.avatar_url}
                        alt={photo.uploader.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className={`font-semibold ${
                      theme === 'dark' ? 'text-white' : 'text-gray-900'
                    }`}>上传者</p>
                    <p className={`text-sm ${
                      theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'
                    }`}>{photo.uploader.username}</p>
                  </div>
                </div>
              </div>
            )}

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h1 className={`text-2xl font-bold mb-2 transition-colors ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>{photo.title}</h1>
              <p className={`text-sm theme-text-transition ${
                theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
              }`}>{formatDate(photo.created_at)}</p>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>照片信息</h2>
              <div className="space-y-4">
                <DetailRow label="拍摄工具" value={photo.vehicle} theme={theme} />
                <DetailRow label="相机型号" value={photo.camera_model} theme={theme} />
                <DetailRow label="拍摄地点" value={photo.location} theme={theme} />
                <DetailRow label="飞行高度" value={`${photo.altitude} 米`} theme={theme} />
              </div>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>拍摄参数</h2>
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label="焦距" value={photo.focal_length} theme={theme} />
                <DetailRow label="ISO" value={photo.iso.toString()} theme={theme} />
                <DetailRow label="快门" value={photo.shutter_speed} theme={theme} />
                <DetailRow label="光圈" value={photo.aperture} theme={theme} />
              </div>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>数据统计</h2>
              <div className="flex gap-6">
                <div className="text-center cursor-pointer hover:scale-105 transition-transform">
                  <div className={`text-xl font-bold ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>{photo.likes}</div>
                  <div className={`text-sm ${
                    theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
                  }`}>喜欢</div>
                </div>
                <div className="text-center cursor-pointer hover:scale-105 transition-transform">
                  <div className={`text-xl font-bold ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>{photo.views.toLocaleString()}</div>
                  <div className={`text-sm ${
                    theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
                  }`}>浏览</div>
                </div>
              </div>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>描述</h2>
              <p className={`leading-relaxed ${
                theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
              }`}>{photo.description}</p>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>标签</h2>
              <div className="flex flex-wrap gap-2">
                {photo.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      theme === 'dark'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {isOwner && (
              <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
                theme === 'dark' ? 'glass' : 'bg-white'
              }`}>
                {deleteConfirmStep > 0 ? (
                  <div className="space-y-4">
                    <p className={`text-center font-medium ${
                      theme === 'dark' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      {deleteConfirmStep === 1
                        ? '确定要删除这张照片吗？此操作无法撤销。'
                        : '再次确认：删除后将永久删除所有相关数据！'}
                    </p>
                    <div className="flex gap-4">
                      <button
                        onClick={() => setDeleteConfirmStep(0)}
                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                          theme === 'dark'
                            ? 'bg-white/10 text-slate-300 hover:bg-white/20'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        取消
                      </button>
                      <button
                        onClick={handleDeleteConfirm}
                        disabled={isDeleting}
                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                          isDeleting
                            ? 'opacity-50 cursor-not-allowed'
                            : theme === 'dark'
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : 'bg-red-500 text-white hover:bg-red-600'
                        }`}
                      >
                        {isDeleting ? '删除中...' : '确认删除'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmStep(1)}
                    disabled={isDeleting}
                    className={`w-full py-3 rounded-lg font-medium transition-colors ${
                      isDeleting
                        ? 'opacity-50 cursor-not-allowed'
                        : theme === 'dark'
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : 'bg-red-50 text-red-600 hover:bg-red-100'
                    }`}
                  >
                    删除照片
                  </button>
                )}
                {deleteMessage && (
                  <p className="mt-4 text-center text-sm text-red-500">{deleteMessage}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function DetailRow({ label, value, theme }: { label: string; value: string; theme: 'dark' | 'light' }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${
        theme === 'dark' ? 'text-slate-400' : 'text-gray-500'
      }`}>{label}</span>
      <span className={`font-medium text-sm ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>{value}</span>
    </div>
  );
}