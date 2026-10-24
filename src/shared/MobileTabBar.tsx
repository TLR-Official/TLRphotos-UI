/**
 * @file 移动端底部主导航栏
 * @description
 *  五项主导航：首页 / 画廊 / 中央上传按钮 / 论坛 / 我的。
 *  仅 ≤768px 渲染（md:hidden）；固定底部并叠加底部安全区内边距。
 *  中央上传按钮按登录态分流：未登录跳转 /auth 并携带回跳地址，已登录直达 /m/upload。
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Images, Plus, MessageSquare, User } from 'lucide-react';
import { useUser } from './UserContext';

/** 常规导航项配置（不含中央上传按钮） */
interface TabItem {
  path: string;
  label: string;
  icon: typeof Home;
}

const LEFT_TABS: TabItem[] = [
  { path: '/', label: '首页', icon: Home },
  { path: '/gallery', label: '画廊', icon: Images },
];

const RIGHT_TABS: TabItem[] = [
  { path: '/forum', label: '论坛', icon: MessageSquare },
  { path: '/profile', label: '我的', icon: User },
];

/**
 * 移动端底部 TabBar 组件
 * @returns 固定底部导航 JSX
 */
export function MobileTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useUser();

  /**
   * 判断导航项是否激活
   * @param path - 导航目标路径
   * @returns 是否激活（首页精确匹配，其余前缀匹配）
   */
  const isActive = (path: string): boolean => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  /** 中央上传按钮点击：未登录先去登录页（携带回跳地址），已登录直达移动上传页 */
  const handleUploadClick = () => {
    if (isAuthenticated) {
      navigate('/m/upload');
    } else {
      navigate('/auth', { state: { from: '/m/upload' } });
    }
  };

  /** 渲染单个常规导航项 */
  const renderTab = ({ path, label, icon: Icon }: TabItem) => {
    const active = isActive(path);
    return (
      <button
        key={path}
        type="button"
        onClick={() => navigate(path)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-[48px] min-w-[64px] flex-col items-center justify-center gap-0.5 ${
          active ? 'text-blue-700' : 'text-gray-500'
        }`}
      >
        <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
        <span className="text-[11px] leading-none">{label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="移动端主导航"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-safe md:hidden"
    >
      <div className="flex h-14 items-center justify-around">
        {LEFT_TABS.map(renderTab)}

        {/* 中央上传按钮：圆形凸起 */}
        <div className="flex min-h-[48px] min-w-[64px] items-center justify-center">
          <button
            type="button"
            onClick={handleUploadClick}
            aria-label="上传图片"
            className="flex h-[52px] w-[52px] -translate-y-3 items-center justify-center rounded-full bg-blue-700 text-white shadow-lg"
          >
            <Plus className="h-6 w-6" strokeWidth={2.5} />
          </button>
        </div>

        {RIGHT_TABS.map(renderTab)}
      </div>
    </nav>
  );
}
