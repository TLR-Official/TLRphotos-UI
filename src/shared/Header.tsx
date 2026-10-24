/**
 * 顶部导航栏
 * 提供站点 Logo、作品集入口、关于我们及用户菜单；登录用户显示头像下拉菜单（通知中心/个人资料/上传/作品/退出），
 * 未登录用户显示登录按钮。下拉菜单采用悬停延时关闭以避免误触。
 * V4.0.0：下拉新增「通知中心」入口与未读数角标（随路由变化与下拉展开刷新）。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useUser } from './UserContext';
import { getUnreadCount } from '../api/notifications';

/**
 * 顶部导航栏组件
 * @returns 导航栏 JSX
 */
export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, logout, user } = useUser();
  // showDropdown：用户菜单下拉是否展开
  const [showDropdown, setShowDropdown] = useState(false);
  // unreadCount：未读通知数（仅登录后拉取）
  const [unreadCount, setUnreadCount] = useState(0);
  // closeTimeoutRef：下拉关闭延时句柄，用于鼠标移出时延迟关闭
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 拉取未读通知数量（失败静默，角标保持原值） */
  const refreshUnread = useCallback(() => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    getUnreadCount()
      .then((res) => {
        if (res.success && res.data) {
          setUnreadCount(res.data.count);
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // 路由变化与下拉展开时刷新未读数（无需轮询）
  useEffect(() => {
    refreshUnread();
  }, [location.pathname, showDropdown, refreshUnread]);

  // 退出登录时清零角标
  useEffect(() => {
    if (!isAuthenticated) setUnreadCount(0);
  }, [isAuthenticated]);

  // 组件卸载时清除未完成的定时器
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  /** 鼠标移入：取消待关闭定时器并展开下拉 */
  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setShowDropdown(true);
  };

  /** 鼠标移出：延迟 200ms 关闭下拉，便于鼠标在间隙中移动 */
  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
    }, 200);
  };

  return (
    <header className="sticky top-0 z-50 py-2 theme-header-transition glass-light">
      <nav className="mx-auto max-w-7xl px-4 flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate('/');
          }}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <img src="/favicon.svg" alt="TLRphotos Logo" className="h-12 w-12 md:h-24 md:w-24 object-contain" />
          <span className="hidden md:inline text-lg font-medium theme-text-transition text-slate-800">交通摄影网</span>
        </button>
        <div className="flex items-center gap-4">
          {/* 移动端通知铃铛：未读角标沿用 blue-700，点击进通知中心（未登录引导登录） */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(isAuthenticated ? '/notifications' : '/auth');
            }}
            aria-label="通知中心"
            className="relative flex md:hidden h-11 w-11 items-center justify-center text-slate-700"
          >
            <Bell className="h-6 w-6" />
            {unreadCount > 0 && (
              <span
                className="absolute right-1 top-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-none bg-blue-700 text-white"
                title={`${unreadCount} 条未读通知`}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {/* 桌面端导航菜单组：移动端隐藏 */}
          <div className="hidden md:flex items-center gap-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/gallery');
            }}
            className="theme-text-transition text-slate-600 hover:text-slate-800 transition-colors"
          >
            作品集
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/recommend');
            }}
            className="theme-text-transition text-slate-600 hover:text-slate-800 transition-colors"
          >
            热门推荐
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/forum');
            }}
            className="theme-text-transition text-slate-600 hover:text-slate-800 transition-colors"
          >
            论坛
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/news');
            }}
            className="theme-text-transition text-slate-600 hover:text-slate-800 transition-colors"
          >
            新闻
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/about');
            }}
            className="theme-text-transition text-slate-600 hover:text-slate-800 transition-colors"
          >
            关于我们
          </button>
          </div>

          {isAuthenticated ? (
            <div
              className="relative hidden md:block"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/profile');
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-300 bg-gray-100 hover:bg-gray-200 hover:shadow-md cursor-pointer group"
                title="点击访问个人资料"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url.startsWith('/') ? `/api${user.avatar_url}` : user.avatar_url}
                      alt={user.username || '用户'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>
                <span className="theme-text-transition text-sm font-medium text-slate-800 group-hover:text-slate-900">
                  {user?.username || '用户'}
                </span>
              </button>

              <div
                className={`absolute right-0 mt-2 w-48 rounded-xl shadow-xl transition-all duration-300 ${
                  showDropdown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
                } bg-white border border-gray-200`}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <div className="py-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      navigate('/notifications');
                    }}
                    className="w-full px-4 py-2 text-left text-sm transition-colors text-gray-700 hover:bg-gray-100 flex items-center justify-between"
                  >
                    <span>通知中心</span>
                    {unreadCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-none bg-blue-700 text-white"
                        title={`${unreadCount} 条未读通知`}
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      navigate('/profile');
                    }}
                    className="w-full px-4 py-2 text-left text-sm transition-colors text-gray-700 hover:bg-gray-100"
                  >
                    个人资料
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      navigate('/upload');
                    }}
                    className="w-full px-4 py-2 text-left text-sm transition-colors text-gray-700 hover:bg-gray-100"
                  >
                    上传图片
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      navigate('/my-works');
                    }}
                    className="w-full px-4 py-2 text-left text-sm transition-colors text-gray-700 hover:bg-gray-100"
                  >
                    我的作品
                  </button>
                  <div className="h-px bg-gray-200" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full px-4 py-2 text-left text-sm transition-colors text-red-600 hover:bg-red-50"
                  >
                    退出登录
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/auth');
              }}
              className="hidden md:block theme-text-transition px-4 py-2 rounded-full bg-gradient-to-r from-blue-700 to-blue-800 text-white hover:from-blue-600 hover:to-blue-700 transition-all duration-300 shadow-lg"
            >
              登录
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
