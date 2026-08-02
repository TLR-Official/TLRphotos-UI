import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from './UserContext';

export function Header() {
  const navigate = useNavigate();
  const { isAuthenticated, logout, user } = useUser();
  const [showDropdown, setShowDropdown] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setShowDropdown(true);
  };

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
          <img src="/favicon.svg" alt="TLRphotos Logo" className="h-24 w-24 object-contain" />
          <span className="text-lg font-medium theme-text-transition text-slate-800">交通摄影网</span>
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/gallery');
            }}
            className="theme-text-transition text-slate-600 hover:text-slate-800 transition-colors"
          >
            作品集
          </button>
          <span className="theme-text-transition text-slate-600">关于我们</span>

          {isAuthenticated ? (
            <div
              className="relative"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDropdown(!showDropdown);
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-300 bg-gray-100 hover:bg-gray-200"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
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
                <span className="theme-text-transition text-sm font-medium text-slate-800">
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
                      navigate('/gallery');
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
              className="theme-text-transition px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all duration-300 shadow-lg"
            >
              登录
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
