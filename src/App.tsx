/**
 * @file 应用根组件
 * @description
 *  应用入口组件，负责全局 Provider 嵌套、路由配置与首页布局。
 *  核心功能：
 *   1. 嵌套 ThemeProvider / UserProvider / PhotosProvider，向全组件树注入全局上下文。
 *   2. 通过 React Router 配置各页面路由。
 *   3. 在 /admin 路径下隐藏 Header / Footer，避免与管理后台布局冲突。
 *   4. 首页组合 PhotoCarousel、ColumnList 与精选作品网格。
 */

import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { PhotoCarousel } from './features/gallery/PhotoCarousel';
import { PhotoDetailPage } from './features/gallery/PhotoDetailPage';
import { GalleryPage } from './features/gallery/GalleryPage';
import { ColumnList } from './features/column/ColumnList';
import { ArticleDetailPage } from './features/column/ArticleDetailPage';
import { AuthPage } from './features/auth/AuthPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { UserProfilePage } from './features/profile/UserProfilePage';
import { UploadPage } from './features/upload/UploadPage';
import { AdminApp } from './admin/AdminApp';
import { Header } from './shared/Header';
import { Footer } from './shared/Footer';
import { MouseFollowBackground } from './shared/MouseFollowBackground';
import { ThemeProvider } from './shared/ThemeContext';
import { CachedImage } from './components/CachedImage';
import { PhotosProvider, usePhotos } from './shared/PhotosContext';
import { UserProvider } from './shared/UserContext';
import { useNavigate } from 'react-router-dom';
import type { PhotoListItem } from './features/gallery/types';

/**
 * 应用根组件：嵌套全局 Provider
 * Provider 层级：ThemeProvider → UserProvider → PhotosProvider → AppContent
 */
function App() {
  return (
    <ThemeProvider>
      <UserProvider>
        <PhotosProvider>
          <AppContent />
        </PhotosProvider>
      </UserProvider>
    </ThemeProvider>
  );
}

/**
 * 应用内容容器：包含背景效果与路由
 */
function AppContent() {
  return (
    <div className="relative min-h-screen theme-bg-transition page-light">
      <MouseFollowBackground />

      <Router>
        <AppRouterContent />
      </Router>
    </div>
  );
}

/**
 * 路由内容容器：根据路径判断是否为管理后台，决定是否渲染 Header / Footer
 */
function AppRouterContent() {
  const location = useLocation();
  // 管理后台路径不渲染公共 Header / Footer，避免与管理后台布局冲突
  const isAdminPage = location.pathname.startsWith('/admin');

  return (
    <div className="relative z-10 flex flex-col min-h-screen">
      {!isAdminPage && <Header />}

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePageContent />} />
          <Route path="/photos/:id" element={<PhotoDetailPage />} />
          <Route path="/articles/:id" element={<ArticleDetailPage />} />
          <Route path="/auth" element={<div className="px-4 py-8"><AuthPage /></div>} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users/:userId" element={<UserProfilePage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </main>

      {!isAdminPage && <Footer />}
    </div>
  );
}

/**
 * 首页内容组件
 * @description 组合轮播图、专栏列表与精选作品网格；精选作品取照片列表第 6~9 张
 */
function HomePageContent() {
  const navigate = useNavigate();
  const { photos } = usePhotos();
  // 取第 6~9 张作为首页精选作品（前 5 张用于轮播）
  const bottomPhotos = photos.slice(5, 9);

  /**
   * 点击精选照片跳转详情页
   * @param photoId - 照片 ID
   */
  const handlePhotoClick = (photoId: string) => {
    navigate(`/photos/${photoId}`);
  };

  return (
    <main className="px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <PhotoCarousel />
          </div>

          <div className="lg:col-span-4">
            <div className="h-full min-h-[500px]">
              <ColumnList />
            </div>
          </div>
        </div>

        <section className="mt-16">
          <h2 className="text-xl font-semibold mb-8 text-gray-900">精选作品</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {bottomPhotos.map((photo: PhotoListItem) => (
              <div
                key={photo.id}
                onClick={() => handlePhotoClick(photo.id)}
                className="group cursor-pointer rounded-xl overflow-hidden shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-white"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium mb-2 truncate text-gray-900">
                    {photo.title}
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {photo.tags.slice(0, 2).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
