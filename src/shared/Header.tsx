import { useNavigate } from 'react-router-dom';
import { useTheme } from './ThemeContext';
import { useUser } from './UserContext';

export function Header() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, logout } = useUser();

  return (
    <header className={`sticky top-0 z-50 py-2 theme-header-transition ${
      theme === 'dark' ? 'glass' : 'glass-light'
    }`}>
      <nav className="mx-auto max-w-7xl px-4 flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate('/');
          }}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <img src="/favicon.svg" alt="TLRphotos Logo" className="h-24 w-24 object-contain" />
          <span className={`text-lg font-medium theme-text-transition ${
            theme === 'dark' ? 'text-white' : 'text-slate-800'
          }`}>交通摄影网</span>
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/');
            }}
            className={`theme-text-transition ${
              theme === 'dark'
                ? 'text-slate-300 hover:text-white'
                : 'text-slate-600 hover:text-slate-800'
            } transition-colors`}
          >
            作品集
          </button>
          <span className={`theme-text-transition ${
              theme === 'dark' ? 'text-slate-300' : 'text-slate-600'
            }`}>关于我们</span>

          {isAuthenticated ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                logout();
              }}
              className={`theme-text-transition px-4 py-2 rounded-full ${
                theme === 'dark'
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-red-100 text-red-600 hover:bg-red-200'
              } transition-all duration-300`}
            >
              退出登录
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/auth');
              }}
              className={`theme-text-transition px-4 py-2 rounded-full ${
                theme === 'dark'
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                  : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
              } transition-all duration-300 shadow-lg`}
            >
              登录
            </button>
          )}

          {/* 黑白风格切换按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleTheme();
            }}
            className={`relative w-10 h-10 rounded-full flex items-center justify-center theme-button-transition ${
              theme === 'dark'
                ? 'bg-slate-800/50 hover:bg-slate-700/50'
                : 'bg-white/80 hover:bg-white'
            } shadow-lg overflow-hidden group`}
            aria-label={theme === 'dark' ? '切换到白色模式' : '切换到黑色模式'}
          >
            {/* 太阳图标（白色模式） */}
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
              theme === 'dark'
                ? 'opacity-0 rotate-90 scale-0'
                : 'opacity-100 rotate-0 scale-100'
            }`}>
              <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            </div>

            {/* 月亮图标（黑色模式） */}
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
              theme === 'dark'
                ? 'opacity-100 rotate-0 scale-100'
                : 'opacity-0 -rotate-90 scale-0'
            }`}>
              <svg className="w-5 h-5 text-slate-300" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            </div>
          </button>
        </div>
      </nav>
    </header>
  );
}