/**
 * 管理后台入口
 * 负责管理员鉴权与页面路由：根据本地 token 校验登录状态，
 * 未登录显示 LoginPage，已登录则按 URL 路径切换页面。
 * 支持 /admin/photos/:id 路由进入照片审核详情页。
 */
import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
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
 * 管理后台入口组件
 * @returns 登录页 / 加载态 / 后台主框架 JSX
 */
export function AdminApp() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  // 用于触发 Layout 刷新当前页高亮
  const [currentPage, setCurrentPage] = useState('dashboard');

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

  /** 退出登录：重置登录态、管理员信息与当前页 */
  const handleLogout = () => {
    setIsLoggedIn(false);
    setAdmin(null);
    setCurrentPage('dashboard');
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

  return (
    <AdminLayout
      admin={admin}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      onLogout={handleLogout}
    />
  );
}

/**
 * 管理后台布局组件
 * 根据当前 URL 路径判断显示哪个页面
 */
function AdminLayout({
  admin,

  onPageChange,
  onLogout,
}: {
  admin: AdminUser;
  currentPage: string;
  onPageChange: (page: string) => void;
  onLogout: () => void;
}) {
  const location = useLocation();
  const params = useParams<{ id?: string }>();

  // 计算当前页面标识（用于侧边栏高亮）
  const getPageId = () => {
    const path = location.pathname;
    if (path.startsWith('/admin/photos')) {
      return 'photos';
    }
    if (path.startsWith('/admin/admins')) {
      return 'admins';
    }
    if (path.startsWith('/admin/users')) {
      return 'users';
    }
    if (path.startsWith('/admin/logs')) {
      return 'logs';
    }
    return 'dashboard';
  };

  const pageId = getPageId();

  /** 根据路径渲染对应页面 */
  const renderPage = () => {
    // 照片详情页
    if (pageId === 'photos' && params.id) {
      return <PhotoDetailPage />;
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
      onPageChange={onPageChange}
      onLogout={onLogout}
    >
      {renderPage()}
    </Layout>
  );
}