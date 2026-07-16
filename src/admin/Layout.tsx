import { useState } from 'react';
import { LayoutDashboard, Users, Image, LogOut, FileText, Settings, ChevronLeft, Shield, Menu } from 'lucide-react';
import type { AdminUser } from './types';
import { setAdminToken } from './api';

interface LayoutProps {
  admin: AdminUser;
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
  onLogout: () => void;
}

const menuItems = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'photos', label: '照片审核', icon: Image },
  { id: 'admins', label: '管理员管理', icon: Users },
  { id: 'users', label: '用户管理', icon: FileText },
  { id: 'logs', label: '操作日志', icon: Settings },
];

export function Layout({ admin, children, currentPage, onPageChange, onLogout }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleLogout = () => {
    setAdminToken(null);
    onLogout();
  };

  const roleLabel = {
    super: '最高账户',
    zone_master: '分区总审核',
    zone_auditor: '分区审核',
  };

  const roleColor = {
    super: 'bg-purple-500',
    zone_master: 'bg-blue-500',
    zone_auditor: 'bg-green-500',
  };

  const canAccess = (page: string) => {
    if (admin.role === 'super') return true;
    if (admin.role === 'zone_master') {
      return ['dashboard', 'photos', 'admins', 'logs'].includes(page);
    }
    return ['dashboard', 'photos'].includes(page);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex">
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-60'} bg-slate-800 border-r border-slate-700 flex flex-col transition-all duration-300 flex-shrink-0`}>
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h1 className="text-white font-bold text-lg">TLR Admin</h1>
                <p className="text-slate-400 text-xs">管理后台</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {menuItems.filter(item => canAccess(item.id)).map(item => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all ${
              sidebarCollapsed ? 'justify-center' : ''
            }`}
            title={sidebarCollapsed ? '退出登录' : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-sm font-medium">退出登录</span>}
          </button>
        </div>
      </aside>

      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute left-16 top-4 p-1 text-slate-400 hover:text-white bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50 transition-all hover:left-60"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 px-6 py-3 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full ${roleColor[admin.role]} flex items-center justify-center text-white text-xs font-bold`}>
              {admin.name?.charAt(0).toUpperCase() || admin.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white font-medium text-sm">{admin.name || admin.username}</p>
              <p className="text-slate-400 text-xs">{roleLabel[admin.role]} | {admin.zone}</p>
            </div>
          </div>
          <div className="text-slate-400 text-sm">
            {new Date().toLocaleString('zh-CN')}
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}