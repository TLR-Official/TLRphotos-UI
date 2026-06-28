import { useParams, useNavigate } from 'react-router-dom';
import { getPhotoDetail } from './mockData';
import type { PhotoDetail } from './types';

export function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const photo = getPhotoDetail(id || '');

  if (!photo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">照片不存在</h1>
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-200 py-2">
        <nav className="mx-auto max-w-7xl px-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <img src="/favicon.svg" alt="TLRphotos Logo" className="h-24 w-24 object-contain" />
            <span className="text-lg font-medium text-gray-800">航空摄影工作室</span>
          </button>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 hover:text-gray-800 transition-colors"
            >
              作品集
            </button>
            <span className="text-gray-600">关于我们</span>
          </div>
        </nav>
      </header>

      <main className="py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回作品集
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-lg overflow-hidden">
              <img
                src={photo.original_url}
                alt={photo.title}
                className="w-full h-auto max-h-[80vh] object-contain"
              />
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h1 className="text-2xl font-bold text-gray-800 mb-2">{photo.title}</h1>
                <p className="text-gray-500 text-sm">{formatDate(photo.created_at)}</p>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">照片信息</h2>
                <div className="space-y-4">
                  <DetailRow label="拍摄工具" value={photo.vehicle} />
                  <DetailRow label="相机型号" value={photo.camera_model} />
                  <DetailRow label="拍摄地点" value={photo.location} />
                  <DetailRow label="飞行高度" value={`${photo.altitude} 米`} />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">拍摄参数</h2>
                <div className="grid grid-cols-2 gap-4">
                  <DetailRow label="焦距" value={photo.focal_length} />
                  <DetailRow label="ISO" value={photo.iso.toString()} />
                  <DetailRow label="快门" value={photo.shutter_speed} />
                  <DetailRow label="光圈" value={photo.aperture} />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">数据统计</h2>
                <div className="flex gap-6">
                  <div className="text-center">
                    <div className="text-xl font-bold text-gray-800">{photo.likes}</div>
                    <div className="text-sm text-gray-500">喜欢</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-gray-800">{photo.views.toLocaleString()}</div>
                    <div className="text-sm text-gray-500">浏览</div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">描述</h2>
                <p className="text-gray-600 leading-relaxed">{photo.description}</p>
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">标签</h2>
                <div className="flex flex-wrap gap-2">
                  {photo.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm font-medium"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-500 mt-12">
        <p>© 2026 TLRphotos 航空摄影工作室 | 本地开发 · 极简架构</p>
      </footer>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-gray-800 font-medium text-sm">{value}</span>
    </div>
  );
}
