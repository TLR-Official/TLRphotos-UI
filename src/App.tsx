import { PhotoCarousel } from './features/gallery/PhotoCarousel';
import { mockPhotos } from './features/gallery/mockData';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-200 py-2">
        <nav className="mx-auto max-w-7xl px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="TLRphotos Logo" className="h-24 w-24 object-contain" />
            <span className="text-lg font-medium text-gray-800">航空摄影工作室</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="text-gray-600 hover:text-gray-800 transition-colors">
              作品集
            </a>
            <a href="#" className="text-gray-600 hover:text-gray-800 transition-colors">
              关于我们
            </a>
          </div>
        </nav>
      </header>

      {/* 主内容区 */}
      <main>
        {/* 顶部轮播展示 */}
        <section className="bg-gray-100">
          <PhotoCarousel />
        </section>

        {/* 简单的照片网格列表 */}
        <section className="px-4 py-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">全部作品</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 max-w-[1600px] mx-auto">
            {mockPhotos.map((photo) => (
              <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden shadow-md bg-gray-100">
                <img
                  src={photo.thumbnail_path}
                  alt={photo.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{photo.title}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* 底部信息 */}
      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-500">
        <p>© 2026 TLRphotos 航空摄影工作室 | 本地开发 · 极简架构</p>
      </footer>
    </div>
  );
}

export default App;