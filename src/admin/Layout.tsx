/**
 * 管理后台布局
 * 左侧固定侧边栏（Logo + 按角色过滤的菜单 + 退出登录），右侧为主内容区。
 * 菜单访问权限按 admin.role 控制：super 全部可见，zone_master 部分可见，其他仅基础页。
 */
import { LayoutDashboard, Users, Image, LogOut, FileText, Settings } from 'lucide-react';
import type { AdminUser } from './types';
import { setAdminToken } from './api';

/** Layout 组件 props */
interface LayoutProps {
  /** 当前登录管理员 */
  admin: AdminUser;
  /** 主内容区子节点 */
  children: React.ReactNode;
  /** 当前激活页面标识 */
  currentPage: string;
  /** 切换页面回调 */
  onPageChange: (page: string) => void;
  /** 退出登录回调 */
  onLogout: () => void;
}

/** 侧边栏菜单项配置 */
const menuItems = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'photos', label: '照片审核', icon: Image },
  { id: 'admins', label: '管理员管理', icon: Users },
  { id: 'users', label: '用户管理', icon: FileText },
  { id: 'logs', label: '操作日志', icon: Settings },
];

/**
 * 管理后台布局组件
 * @param admin 当前管理员
 * @param children 主内容
 * @param currentPage 当前页标识
 * @param onPageChange 切换页回调
 * @param onLogout 退出回调
 * @returns 后台布局 JSX
 */
export function Layout({ admin, children, currentPage, onPageChange, onLogout }: LayoutProps) {
  /** 退出登录：清除本地 token 后通知父组件 */
  const handleLogout = () => {
    setAdminToken(null);
    onLogout();
  };

  /**
   * 判断当前管理员是否可访问指定页面
   * super 全部可见；zone_master 可访问仪表盘/照片/管理员/日志；其他仅仪表盘与照片。
   * @param page 页面标识
   * @returns 是否可访问
   */
  const canAccess = (page: string) => {
    if (admin.role === 'super') return true;
    if (admin.role === 'zone_master') {
      return ['dashboard', 'photos', 'admins', 'logs'].includes(page);
    }
    return ['dashboard', 'photos'].includes(page);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800">TLRphotos</h1>
          <p className="text-sm text-gray-500 mt-1">管理后台</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {menuItems.filter(item => canAccess(item.id)).map(item => (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                currentPage === item.id
                  ? 'bg-purple-100 text-purple-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      <div className="flex-1">
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}