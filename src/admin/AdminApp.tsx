/**
 * 管理后台入口
 * 负责管理员鉴权与页面路由：根据本地 token 校验登录状态，
 * 未登录显示 LoginPage，已登录则按 URL 路径切换页面。
 * 支持 /admin/photos/:id 路由进入照片审核详情页。
 * V4.0.0：新增 /admin/appeals（申诉裁决）、/admin/my-audits（我的已处理）、
 * /admin/forum（论坛治理占位页）与 /admin/news（新闻管理：列表 / 新建 / 编辑）。
 * V4.1.0：新增 /admin/bans（用户封禁管理）与 /admin/announcements（公告管理）。
 */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ForceChangePassword } from './ForceChangePassword';
import { Layout } from './Layout';
import { DashboardPage } from './DashboardPage';
import { PhotosPage } from './PhotosPage';
import { PhotoDetailPage } from './PhotoDetailPage';
import { AdminsPage } from './AdminsPage';
import { UsersPage } from './UsersPage';
import { LogsPage } from './LogsPage';
import { MyAuditsPage } from './MyAuditsPage';
import { AppealsPage } from './AppealsPage';
import { NewsPage } from './NewsPage';
import { NewsEditorPage } from './NewsEditorPage';
import { BansPage } from './BansPage';
import { AnnouncementsPage } from './AnnouncementsPage';
import { getCurrentAdmin, getAdminToken, setAdminToken } from './api';
import type { AdminUser } from './types';

/**
 * 从 URL 路径解析照片 ID
 * @param pathname 当前 URL 路径
 * @returns 照片 ID 或 undefined
 */
function parsePhotoIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/admin\/photos\/(.+)$/);
  return match ? match[1] : undefined;
}

/**
 * 从 URL 路径解析新闻编辑器模式：
 * /admin/news/new → 新建（返回 'new'）；/admin/news/:id/edit → 编辑（返回新闻 id）；其余返回 undefined
 * @param pathname 当前 URL 路径
 * @returns 'new' | 新闻 id | undefined
 */
function parseNewsEditorFromPath(pathname: string): string | undefined {
  if (pathname.startsWith('/admin/news/new')) return 'new';
  const match = pathname.match(/^\/admin\/news\/([^/]+)\/edit$/);
  return match ? match[1] : undefined;
}

/**
 * 从 URL 路径获取当前页面标识（用于侧边栏高亮）
 * @param pathname 当前 URL 路径
 * @returns 页面标识
 */
function getPageIdFromPath(pathname: string): string {
  if (pathname.startsWith('/admin/photos')) return 'photos';
  if (pathname.startsWith('/admin/admins')) return 'admins';
  if (pathname.startsWith('/admin/users')) return 'users';
  if (pathname.startsWith('/admin/logs')) return 'logs';
  if (pathname.startsWith('/admin/appeals')) return 'appeals';
  if (pathname.startsWith('/admin/my-audits')) return 'my-audits';
  if (pathname.startsWith('/admin/forum')) return 'forum';
  if (pathname.startsWith('/admin/news')) return 'news';
  if (pathname.startsWith('/admin/bans')) return 'bans';
  if (pathname.startsWith('/admin/announcements')) return 'announcements';
  if (pathname.startsWith('/admin/dashboard')) return 'dashboard';
  return 'dashboard';
}

/**
 * 占位页（V4 本轮未实现的模块）：论坛治理
 * @param title 页面标题
 * @param description 说明文案
 * @returns 占位卡片 JSX
 */
function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-gray-800 font-medium">该模块将在下轮迭代开放</p>
        <p className="text-sm text-gray-500 mt-2">{description}</p>
      </div>
    </div>
  );
}

/**
 * 管理后台入口组件
 * @returns 登录页 / 加载态 / 后台主框架 JSX
 */
export function AdminApp() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  // 首次挂载：存在 token 则校验有效性，否则直接结束 loading
  useEffect(() => {
    const token = getAdminToken();
    if (token) {
      checkAuth();
    } else {
      setLoading(false);
    }
  }, []);

  /** 校验当前 token 并拉取管理员信息，更新登录状态 */
  const checkAuth = async () => {
    const result = await getCurrentAdmin();
    if (result.success && result.admin) {
      setAdmin(result.admin);
      setIsLoggedIn(true);
    } else {
      setIsLoggedIn(false);
    }
    setLoading(false);
  };

  /** 登录成功回调：重新校验并拉取管理员信息 */
  const handleLogin = () => {
    checkAuth();
  };

  /**
   * 退出登录：清除本地凭据、重置登录态与管理员信息。
   * 供 Layout 退出按钮与强制改密页「放弃登录」复用。
   */
  const handleLogout = () => {
    setAdminToken(null);
    setIsLoggedIn(false);
    setAdmin(null);
  };

  if (loading) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-gray-800">加载中...</div>;
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (!admin) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-gray-800">未获取到管理员信息</div>;
  }

  // 强制改密门：未完成改密不渲染任何后台业务页面
  if (admin.must_change_password === 1) {
    return <ForceChangePassword onDone={handleLogin} onLogout={handleLogout} />;
  }

  // 基于 URL 路径计算当前页面标识和照片 ID
  const pageId = getPageIdFromPath(location.pathname);
  const photoId = parsePhotoIdFromPath(location.pathname);
  // 新闻编辑器路由参数：'new'（新建）或新闻 id（编辑），非编辑器路径为 undefined
  const newsEditorId = parseNewsEditorFromPath(location.pathname);

  /**
   * 处理侧边栏导航：基于 URL 跳转
   * @param pageId 目标页面标识
   */
  const handleNavigate = (targetPageId: string) => {
    switch (targetPageId) {
      case 'dashboard':
        navigate('/admin/dashboard');
        break;
      case 'photos':
        navigate('/admin/photos');
        break;
      case 'appeals':
        navigate('/admin/appeals');
        break;
      case 'my-audits':
        navigate('/admin/my-audits');
        break;
      case 'admins':
        navigate('/admin/admins');
        break;
      case 'users':
        navigate('/admin/users');
        break;
      case 'logs':
        navigate('/admin/logs');
        break;
      case 'forum':
        navigate('/admin/forum');
        break;
      case 'news':
        navigate('/admin/news');
        break;
      case 'bans':
        navigate('/admin/bans');
        break;
      case 'announcements':
        navigate('/admin/announcements');
        break;
      default:
        navigate('/admin/dashboard');
    }
  };

  /** 根据路径渲染对应页面 */
  const renderPage = () => {
    // 照片详情页（有 photoId 时）：传入 currentAdmin 供分配下拉做角色判断
    if (pageId === 'photos' && photoId) {
      return <PhotoDetailPage id={photoId} currentAdmin={admin} />;
    }

    // 新闻编辑器（新建 /admin/news/new 或编辑 /admin/news/:id/edit）
    if (pageId === 'news' && newsEditorId !== undefined) {
      return <NewsEditorPage newsId={newsEditorId === 'new' ? undefined : newsEditorId} />;
    }

    switch (pageId) {
      case 'dashboard':
        return <DashboardPage />;
      case 'photos':
        return <PhotosPage />;
      case 'appeals':
        return <AppealsPage />;
      case 'my-audits':
        return <MyAuditsPage />;
      case 'admins':
        return <AdminsPage currentAdmin={admin} />;
      case 'users':
        return <UsersPage />;
      case 'logs':
        return <LogsPage />;
      case 'forum':
        return <PlaceholderPage title="论坛治理" description="论坛板块治理与帖子管理功能将在下轮迭代实现。" />;
      case 'news':
        return <NewsPage />;
      case 'bans':
        return <BansPage currentAdmin={admin} />;
      case 'announcements':
        return <AnnouncementsPage currentAdmin={admin} />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <Layout
      admin={admin}
      currentPage={pageId}
      onNavigate={handleNavigate}
      onLogout={handleLogout}
    >
      {renderPage()}
    </Layout>
  );
}
