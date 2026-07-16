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

export function AdminApp() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAdminToken();
    if (token) {
      checkAuth();
    } else {
      setLoading(false);
    }
  }, []);

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

  const handleLogin = () => {
    checkAuth();
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setAdmin(null);
    setCurrentPage('dashboard');
  };

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
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">加载中...</div>;
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (!admin) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">未获取到管理员信息</div>;
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