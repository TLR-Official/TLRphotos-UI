/**
 * 管理后台布局
 * 左侧固定侧边栏（Logo + 按角色过滤的菜单 + 退出登录），右侧为主内容区。
 * 菜单访问权限按 admin.role 控制：
 *   - super：全部菜单；
 *   - zone_master：仪表盘/照片审核/申诉裁决/我的已处理/管理员管理/日志；
 *   - zone_auditor：仪表盘/照片审核/我的已处理（V4 扩展个人审核记录）；
 *   - forum_moderator：仅论坛治理（V4.3.0 落地：板块管理 + 帖子管理）；
 *   - news_editor：仅新闻管理（V4 本轮占位页，下轮实现）。
 */
import { useState } from 'react';
import { LayoutDashboard, Users, Image, LogOut, FileText, Settings, MessageSquare, Newspaper, Scale, ClipboardList, Gavel, Megaphone, Menu, X, Ticket } from 'lucide-react';
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
  /** URL 导航回调 */
  onNavigate: (pageId: string) => void;
  /** 退出登录回调 */
  onLogout: () => void;
}

/** 侧边栏菜单项配置 */
const menuItems = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'photos', label: '照片审核', icon: Image },
  { id: 'appeals', label: '申诉裁决', icon: Scale },
  { id: 'my-audits', label: '我的已处理', icon: ClipboardList },
  { id: 'admins', label: '管理员管理', icon: Users },
  { id: 'users', label: '用户管理', icon: FileText },
  { id: 'bans', label: '用户封禁管理', icon: Gavel },
  // V4.7.0：邀请码管理（仅 super 可见，称号发放入口）
  { id: 'invites', label: '邀请码管理', icon: Ticket },
  { id: 'logs', label: '操作日志', icon: Settings },
  { id: 'forum', label: '论坛治理', icon: MessageSquare },
  { id: 'news', label: '新闻管理', icon: Newspaper },
  { id: 'announcements', label: '公告管理', icon: Megaphone },
];

/**
 * 管理后台布局组件
 * @param admin 当前管理员
 * @param children 主内容
 * @param currentPage 当前页标识
 * @param onNavigate URL 导航回调
 * @param onLogout 退出回调
 * @returns 后台布局 JSX
 */
export function Layout({ admin, children, currentPage, onNavigate, onLogout }: LayoutProps) {
  // 移动端全屏菜单抽屉开关（桌面端不渲染，零影响）
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /** 退出登录：清除本地 token 后通知父组件 */
  const handleLogout = () => {
    setAdminToken(null);
    onLogout();
  };

  /**
   * 判断当前管理员是否可访问指定页面（V4.0.0 角色门）
   * super 全部可见；zone_master 增加申诉裁决、我的已处理与用户封禁管理（V4.1.0）；
   * zone_auditor 维持现状并扩展个人「我的已处理」；
   * forum_moderator 仅论坛治理；news_editor 仅新闻管理与公告管理（V4.1.0）。
   * @param page 页面标识
   * @returns 是否可访问
   */
  const canAccess = (page: string) => {
    if (admin.role === 'super') return true;
    if (admin.role === 'zone_master') {
      return ['dashboard', 'photos', 'appeals', 'my-audits', 'admins', 'logs', 'bans'].includes(page);
    }
    if (admin.role === 'zone_auditor') {
      return ['dashboard', 'photos', 'my-audits'].includes(page);
    }
    if (admin.role === 'forum_moderator') {
      return ['forum'].includes(page);
    }
    if (admin.role === 'news_editor') {
      return ['news', 'announcements'].includes(page);
    }
    return ['dashboard', 'photos'].includes(page);
  };

  // 按角色过滤后的可见菜单（侧边栏与移动端抽屉共用）
  const visibleMenus = menuItems.filter((item) => canAccess(item.id));

  /**
   * 渲染菜单按钮列表
   * @param closeAfterNav 点击菜单项后是否关闭抽屉（移动端抽屉传入 true）
   */
  const renderMenuButtons = (closeAfterNav: boolean) =>
    visibleMenus.map((item) => (
      <button
        key={item.id}
        onClick={() => {
          onNavigate(item.id);
          if (closeAfterNav) setMobileMenuOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
          currentPage === item.id
            ? 'bg-blue-50 text-blue-800 font-medium'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
        }`}
      >
        <item.icon className="w-5 h-5" />
        <span>{item.label}</span>
      </button>
    ));

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 桌面端侧边栏（移动端隐藏） */}
      <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800">TLRphotos</h1>
          <p className="text-sm text-gray-500 mt-1">管理后台</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">{renderMenuButtons(false)}</nav>

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

      <div className="flex-1 min-w-0">
        {/* 移动端顶栏（仅 ≤768px）：Logo + 汉堡按钮（44px 热区） */}
        <header className="md:hidden sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 h-12">
          <div>
            <h1 className="text-base font-bold text-gray-800">TLRphotos</h1>
          </div>
          <button
            type="button"
            aria-label="打开菜单"
            onClick={() => setMobileMenuOpen(true)}
            className="flex h-11 w-11 items-center justify-center text-gray-700"
          >
            <Menu className="w-6 h-6" />
          </button>
        </header>

        <main className="p-4 md:p-6">
          {children}
        </main>
      </div>

      {/* 移动端全屏菜单抽屉（仅 ≤768px）：遮罩 + 菜单列表，点项或遮罩关闭 */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-gray-800">TLRphotos</h1>
                <p className="text-xs text-gray-500 mt-0.5">管理后台</p>
              </div>
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-11 w-11 items-center justify-center text-gray-500"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-4 space-y-1">{renderMenuButtons(true)}</nav>

            <div className="p-4 border-t border-gray-200">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span>退出登录</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
