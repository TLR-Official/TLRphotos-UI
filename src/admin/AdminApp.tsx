/**
 * 管理后台入口
 * 负责管理员鉴权与页面路由：根据本地 token 校验登录状态，
 * 未登录显示 LoginPage，已登录则按 URL 路径切换页面。
 * 支持 /admin/photos/:id 路由进入照片审核详情页。
 */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { Layout } from './Layout';
import { DashboardPage } from './DashboardPage';
import { PhotosPage } from './PhotosPage';
import { PhotoDetailPage } from './PhotoDetailPage';
import { AdminsPage } from './AdminsPage';
import { UsersPage } from './UsersPage';
import { LogsPage } from './LogsPage';
import { getCurrentAdmin, getAdminToken } from './api';
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
 * 从 URL 路径获取当前页面标识（用于侧边栏高亮）
 * @param pathname 当前 URL 路径
 * @returns 页面标识
 */
function getPageIdFromPath(pathname: string): string {
  if (pathname.startsWith('/admin/photos')) return 'photos';
  if (pathname.startsWith('/admin/admins')) return 'admins';
  if (pathname.startsWith('/admin/users')) return 'users';
  if (pathname.startsWith('/admin/logs')) return 'logs';
  if (pathname.startsWith('/admin/dashboard')) return 'dashboard';
  return 'dashboard';
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

  /** 退出登录：重置登录态、管理员信息并跳转登录页 */
  const handleLogout = () => {
    setIsLoggedIn(false);
    setAdmin(null);
    navigate('/admin/login');
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

  // 基于 URL 路径计算当前页面标识和照片 ID
  const pageId = getPageIdFromPath(location.pathname);
  const photoId = parsePhotoIdFromPath(location.pathname);

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
      case 'admins':
        navigate('/admin/admins');
        break;
      case 'users':
        navigate('/admin/users');
        break;
      case 'logs':
        navigate('/admin/logs');
        break;
      default:
        navigate('/admin/dashboard');
    }
  };

  /** 根据路径渲染对应页面 */
  const renderPage = () => {
    // 照片详情页（有 photoId 时）
    if (pageId === 'photos' && photoId) {
      return <PhotoDetailPage id={photoId} />;
    }

    switch (pageId) {
      case 'dashboard':
        return <DashboardPage />;
      case 'photos':
        return <PhotosPage />;
      case 'admins':
        return <AdminsPage />;
      case 'users':
        return <UsersPage />;
      case 'logs':
        return <LogsPage />;
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
