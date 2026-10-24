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

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Car, Plane, RefreshCw, Train } from 'lucide-react';
import { PhotoCarousel } from './features/gallery/PhotoCarousel';
import { PhotoDetailPage } from './features/gallery/PhotoDetailPage';
import { GalleryPage } from './features/gallery/GalleryPage';
import { RecommendPage } from './features/gallery/RecommendPage';
import { ColumnList } from './features/column/ColumnList';
import { ArticleDetailPage } from './features/column/ArticleDetailPage';
import { AuthPage } from './features/auth/AuthPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { MyWorksPage } from './features/profile/MyWorksPage';
import { MyAppealsPage } from './features/profile/MyAppealsPage';
import { PublicProfilePage } from './features/user/PublicProfilePage';
import { UploadPage } from './features/upload/UploadPage';
import { AdminApp } from './admin/AdminApp';
import { ForumHomePage } from './features/forum/ForumHomePage';
import { BoardPage } from './features/forum/BoardPage';
import { ThreadDetailPage } from './features/forum/ThreadDetailPage';
import { NewThreadPage } from './features/forum/NewThreadPage';
import { AboutPage } from './features/about/AboutPage';
import { NewsListPage } from './features/news/NewsListPage';
import { NewsDetailPage } from './features/news/NewsDetailPage';
import { NotificationPage } from './features/notifications/NotificationPage';
import { Header } from './shared/Header';
import { Footer } from './shared/Footer';
import { TopBanner } from './shared/TopBanner';
import { MobileTabBar } from './shared/MobileTabBar';
import { OnboardingCard } from './shared/OnboardingCard';
import { useIsMobile } from './shared/useIsMobile';
import { MouseFollowBackground } from './shared/MouseFollowBackground';
import { ThemeProvider } from './shared/ThemeContext';
import { CachedImage } from './components/CachedImage';
import { PhotosProvider, usePhotos } from './shared/PhotosContext';
import { UserProvider } from './shared/UserContext';
import { useNavigate } from 'react-router-dom';
import type { PhotoListItem } from './features/gallery/types';

/** 移动端上传页（独立分包，仅 /m/upload 命中时加载） */
const MobileUploadPage = lazy(() =>
  import('./features/upload/mobile/MobileUploadPage').then((m) => ({ default: m.MobileUploadPage })),
);

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
 * 上传页分流组件：移动端重定向至 /m/upload，桌面端渲染原 UploadPage
 */
function UploadRedirect() {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <Navigate to="/m/upload" replace />;
  }
  return <UploadPage />;
}

/**
 * 路由内容容器：根据路径判断是否为管理后台，决定是否渲染 Header / Footer / MobileTabBar
 */
function AppRouterContent() {
  const location = useLocation();
  // 管理后台路径不渲染公共 Header / Footer / MobileTabBar，避免与管理后台布局冲突
  const isAdminPage = location.pathname.startsWith('/admin');

  return (
    <div className="relative z-10 flex flex-col min-h-screen">
      {/* 站点公告横幅：置于 Header 之上，管理后台不渲染（V4.1.0） */}
      {!isAdminPage && <TopBanner />}
      {!isAdminPage && <Header />}

      {/* 移动端主内容区底部预留 TabBar 空间（56px + 底部安全区），桌面端不受影响 */}
      <main className="flex-1 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <Routes>
          <Route path="/" element={<HomePageContent />} />
          <Route path="/photos/:id" element={<PhotoDetailPage />} />
          <Route path="/articles/:id" element={<ArticleDetailPage />} />
          <Route path="/auth" element={<div className="px-4 py-8"><AuthPage /></div>} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/my-works" element={<MyWorksPage />} />
          <Route path="/my-appeals" element={<MyAppealsPage />} />
          <Route path="/users/:userId" element={<PublicProfilePage />} />
          <Route path="/upload" element={<UploadRedirect />} />
          <Route
            path="/m/upload"
            element={
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-24 text-sm text-gray-500">
                    页面加载中
                  </div>
                }
              >
                <MobileUploadPage />
              </Suspense>
            }
          />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/recommend" element={<RecommendPage />} />
          <Route path="/forum" element={<ForumHomePage />} />
          <Route path="/forum/b/:boardId" element={<BoardPage />} />
          <Route path="/forum/t/:threadId" element={<ThreadDetailPage />} />
          <Route path="/forum/new" element={<NewThreadPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/news" element={<NewsListPage />} />
          <Route path="/news/:id" element={<NewsDetailPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </main>

      {!isAdminPage && <Footer />}
      {/* 移动端底部主导航：仅用户端路由渲染，管理端不出现 */}
      {!isAdminPage && <MobileTabBar />}
    </div>
  );
}

/** 下拉刷新触发阈值（px） */
const PULL_THRESHOLD = 70;

/**
 * 移动端首页下拉刷新容器
 * @description
 *  仅 ≤768px 生效：在页面顶部（window.scrollY <= 0）下拉超过 70px 松开后触发 onRefresh，
 *  拖动过程中展示「下拉刷新 / 松开刷新 / 正在刷新」提示；touchmove 以 { passive: false }
 *  监听，仅在实际下拉（delta > 0 且页面未滚动）时 preventDefault，抑制浏览器原生下拉刷新，
 *  不影响正常上滑滚动。桌面端直接渲染子内容，零行为变化。
 *  注意：PhotosContext.refreshPhotos 为 fire-and-forget（不返回 Promise），
 *  指示器固定延时 1s 后复位，数据返回后由 Context 驱动 UI 自然更新。
 */
function PullToRefresh({ onRefresh, children }: { onRefresh: () => void; children: ReactNode }) {
  const isMobile = useIsMobile();
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const distanceRef = useRef(0);

  useEffect(() => {
    if (!isMobile) return;

    const updateDistance = (d: number) => {
      distanceRef.current = d;
      setPullDistance(d);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (window.scrollY <= 0) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshing) return;
      // 页面已被滚离顶部：本次手势按普通滚动处理，不再介入
      if (window.scrollY > 0) {
        pullingRef.current = false;
        updateDistance(0);
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        updateDistance(0);
        return;
      }
      // 仅在确实下拉时阻止默认行为（抑制原生下拉刷新/橡皮筋），上滑不受影响
      e.preventDefault();
      // 0.5 阻尼系数 + 120px 上限，避免过度拉伸
      updateDistance(Math.min(delta * 0.5, 120));
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      if (distanceRef.current >= PULL_THRESHOLD) {
        setRefreshing(true);
        updateDistance(56);
        onRefresh();
        window.setTimeout(() => {
          setRefreshing(false);
          updateDistance(0);
        }, 1000);
      } else {
        updateDistance(0);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, refreshing, onRefresh]);

  if (!isMobile) return <>{children}</>;

  const thresholdReached = pullDistance >= PULL_THRESHOLD;

  return (
    <>
      {/* 下拉提示条：高度随手势变化，纯视觉指示 */}
      <div
        aria-hidden="true"
        className="flex items-end justify-center overflow-hidden bg-white transition-[height] duration-100"
        style={{ height: pullDistance }}
      >
        <div className="flex h-14 items-center gap-2 text-sm text-gray-500">
          {refreshing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-blue-700" />
              正在刷新
            </>
          ) : (
            <span className={thresholdReached ? 'font-medium text-blue-700' : ''}>
              {thresholdReached ? '松开刷新' : '下拉刷新'}
            </span>
          )}
        </div>
      </div>
      {children}
    </>
  );
}

/** 移动端首页三大分区入口（GalleryPage 当前不读取 query 参数，统一跳转 /gallery） */
const CATEGORY_ENTRIES = [
  { name: '航空', Icon: Plane },
  { name: '铁路', Icon: Train },
  { name: '公路', Icon: Car },
] as const;

/**
 * 首页内容组件
 * @description 组合轮播图、专栏列表与精选作品网格；精选作品取照片列表第 6~9 张；
 *  移动端额外提供下拉刷新与三大分区快捷入口。
 */
function HomePageContent() {
  const navigate = useNavigate();
  const { photos, refreshPhotos } = usePhotos();
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
    <PullToRefresh onRefresh={refreshPhotos}>
    {/* 移动端未登录首次访问的新手引导浮层（仅显示 1 次，桌面端不渲染） */}
    <OnboardingCard />
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

        {/* 移动端三大分区入口（仅 ≤768px 显示，桌面端零变化）；高 72px 等宽三枚 */}
        <nav aria-label="分区入口" className="mt-6 grid grid-cols-3 gap-2 md:hidden">
          {CATEGORY_ENTRIES.map(({ name, Icon }) => (
            <button
              key={name}
              onClick={() => navigate('/gallery')}
              className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white shadow-sm transition-colors active:bg-blue-50"
            >
              <Icon className="h-5 w-5 text-blue-700" />
              <span className="text-sm font-medium text-gray-900">{name}</span>
            </button>
          ))}
        </nav>

        <section className="mt-16">
          <h2 className="text-xl font-semibold mb-8 text-black">精选作品</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-8">
            {bottomPhotos.map((photo: PhotoListItem) => (
              <div
                key={photo.id}
                onClick={() => handlePhotoClick(photo.id)}
                className="group cursor-pointer rounded-xl overflow-hidden shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl bg-white"
              >
                {/* 固定 4:3 容器 + object-contain：按原比例完整展示作品，不裁切构图 */}
                <div className="aspect-[4/3] overflow-hidden bg-gray-50">
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
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
    </PullToRefresh>
  );
}

export default App;
