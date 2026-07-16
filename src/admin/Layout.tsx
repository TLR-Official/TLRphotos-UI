import { useState } from 'react';
import { LayoutDashboard, Users, Image, LogOut, FileText, Settings, Menu, X } from 'lucide-react';
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = () => {
    setAdminToken(null);
    onLogout();
  };

  const roleLabel = {
    super: '最高账户',
    zone_master: '分区总审核',
    zone_auditor: '分区审核',
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
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} bg-slate-800 border-r border-slate-700 flex flex-col transition-all duration-300 overflow-hidden`}>
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-xl font-bold text-white">TLRphotos</h1>
          <p className="text-sm text-slate-400 mt-1">管理后台</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {menuItems.filter(item => canAccess(item.id)).map(item => (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                currentPage === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-white font-medium">{admin.name || admin.username}</p>
              <p className="text-sm text-slate-400">{roleLabel[admin.role]} | {admin.zone}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
              {admin.name?.charAt(0) || admin.username.charAt(0)}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}