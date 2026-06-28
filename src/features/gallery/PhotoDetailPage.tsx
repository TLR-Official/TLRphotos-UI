import { useParams, useNavigate } from 'react-router-dom';
import { getPhotoDetail } from './mockData';
import { Header } from '../../shared/Header';
import { Footer } from '../../shared/Footer';
import { MouseFollowBackground } from '../../shared/MouseFollowBackground';

export function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const photo = getPhotoDetail(id || '');

  if (!photo) {
    return (
      <div className="relative min-h-screen page-dark">
        <MouseFollowBackground />
        <div className="relative z-10 flex min-h-screen items-center justify-center">
          <div className="glass rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-4">照片不存在</h1>
            <button
              onClick={() => navigate('/')}
              className="glass-sm px-6 py-2 text-white rounded-lg hover:bg-white/10 transition-colors"
            >
              返回首页
            </button>
          </div>
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
    <div className="relative min-h-screen page-dark">
      <MouseFollowBackground />

      <div className="relative z-10">
        <Header />

        <main className="py-8 px-4">
          <div className="max-w-6xl mx-auto">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回作品集
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 左侧：大图 */}
              <div className="lg:col-span-2 flex justify-center">
                <div className="glass-lg rounded-xl overflow-hidden max-w-full">
                  <img
                    src={photo.original_url}
                    alt={photo.title}
                    className="w-full h-auto max-w-full"
                  />
                </div>
              </div>

              {/* 右侧：信息卡片 */}
              <div className="space-y-5">
                <div className="glass glass-hover rounded-xl p-6">
                  <h1 className="text-2xl font-bold text-white mb-2">{photo.title}</h1>
                  <p className="text-slate-400 text-sm">{formatDate(photo.created_at)}</p>
                </div>

                <div className="glass glass-hover rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">照片信息</h2>
                  <div className="space-y-4">
                    <DetailRow label="拍摄工具" value={photo.vehicle} />
                    <DetailRow label="相机型号" value={photo.camera_model} />
                    <DetailRow label="拍摄地点" value={photo.location} />
                    <DetailRow label="飞行高度" value={`${photo.altitude} 米`} />
                  </div>
                </div>

                <div className="glass glass-hover rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">拍摄参数</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <DetailRow label="焦距" value={photo.focal_length} />
                    <DetailRow label="ISO" value={photo.iso.toString()} />
                    <DetailRow label="快门" value={photo.shutter_speed} />
                    <DetailRow label="光圈" value={photo.aperture} />
                  </div>
                </div>

                <div className="glass glass-hover rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">数据统计</h2>
                  <div className="flex gap-6">
                    <div className="text-center">
                      <div className="text-xl font-bold text-white">{photo.likes}</div>
                      <div className="text-sm text-slate-400">喜欢</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-white">{photo.views.toLocaleString()}</div>
                      <div className="text-sm text-slate-400">浏览</div>
                    </div>
                  </div>
                </div>

                <div className="glass glass-hover rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">描述</h2>
                  <p className="text-slate-300 leading-relaxed">{photo.description}</p>
                </div>

                <div className="glass glass-hover rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">标签</h2>
                  <div className="flex flex-wrap gap-2">
                    {photo.tags.map((tag) => (
                      <span
                        key={tag}
                        className="glass-sm px-3 py-1 text-indigo-300 rounded-full text-sm font-medium"
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

        <Footer />
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="text-white font-medium text-sm">{value}</span>
    </div>
  );
}
