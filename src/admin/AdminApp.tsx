/**
 * 管理后台入口
 * 负责管理员鉴权与页面路由：根据本地 token 校验登录状态，未登录显示 LoginPage，
 * 已登录则按 currentPage 在仪表盘/照片审核/管理员/用户/日志等页面间切换。
 */
import { useState, useEffect } from 'react';
import { LoginPage } from './LoginPage';
import { Layout } from './Layout';
import { DashboardPage } from './DashboardPage';
import { PhotosPage } from './PhotosPage';
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
  // currentPage：当前激活的后台页面标识
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [loading, setLoading] = useState(true);

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

  /** 根据 currentPage 渲染对应后台页面 */
  const renderPage = () => {
    switch (currentPage) {
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
    <Layout
      admin={admin}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      onLogout={handleLogout}
    >
      {renderPage()}
    </Layout>
  );
}