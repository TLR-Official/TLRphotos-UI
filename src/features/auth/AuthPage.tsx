import { useState, useEffect } from 'react';
import { useUser } from '../../shared/UserContext';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../shared/ThemeContext';

export function AuthPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, register, isAuthenticated } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('请填写邮箱和密码');
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (!isLogin && !username) {
      setError('请填写用户名');
      return;
    }

    setIsLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        navigate('/');
      } else {
        await register(email, password, username);
        setIsLogin(true);
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setUsername('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider: string) => {
    setError(`${provider} 登录功能开发中`);
    setTimeout(() => setError(''), 3000);
  };

  return (
    <div className="flex items-center justify-center py-8">
      <div className="relative w-full max-w-md">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-500 rounded-3xl blur-xl opacity-30 animate-pulse" />
        
        <div className={`relative backdrop-blur-lg rounded-3xl p-8 border shadow-2xl transition-all duration-500 ${
          isDark 
            ? 'bg-white/10 border-white/20' 
            : 'bg-gray-50/90 border-gray-200 shadow-gray-200'
        }`}>
          <div className="flex justify-center mb-8">
            <div className={`text-4xl font-bold ${
              isDark 
                ? 'bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent' 
                : 'bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent'
            }`}>
              TLRphotos
            </div>
          </div>

          <div className="flex justify-center mb-8">
            <div className={`relative w-64 h-12 rounded-full p-1 ${
              isDark ? 'bg-black/20' : 'bg-gray-200'
            }`}>
              <button
                onClick={() => setIsLogin(true)}
                className={`absolute inset-y-0 left-0 right-1/2 flex items-center justify-center rounded-full transition-all duration-500 ease-out ${
                  isLogin 
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-105' 
                    : isDark ? 'text-white/60 hover:text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                登录
              </button>
              <button
                onClick={() => setIsLogin(false)}
                className={`absolute inset-y-0 left-1/2 right-0 flex items-center justify-center rounded-full transition-all duration-500 ease-out ${
                  !isLogin 
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg transform scale-105' 
                    : isDark ? 'text-white/60 hover:text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                注册
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱地址"
                className={`w-full pl-12 pr-4 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 ${
                  isDark 
                    ? 'bg-white/10 border border-white/20 text-white placeholder-white/40' 
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                className={`w-full pl-12 pr-4 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 ${
                  isDark 
                    ? 'bg-white/10 border border-white/20 text-white placeholder-white/40' 
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            <div 
              className={`relative transition-all duration-500 ease-out ${
                !isLogin ? 'opacity-100 max-h-32' : 'opacity-0 max-h-0 overflow-hidden'
              }`}
            >
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="确认密码"
                className={`w-full pl-12 pr-4 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 ${
                  isDark 
                    ? 'bg-white/10 border border-white/20 text-white placeholder-white/40' 
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            <div 
              className={`relative transition-all duration-500 ease-out ${
                !isLogin ? 'opacity-100 max-h-32' : 'opacity-0 max-h-0 overflow-hidden'
              }`}
            >
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
                className={`w-full pl-12 pr-4 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 ${
                  isDark 
                    ? 'bg-white/10 border border-white/20 text-white placeholder-white/40' 
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            {error && (
              <div className={`rounded-xl p-4 text-center animate-bounce ${
                isDark 
                  ? 'bg-red-500/20 border border-red-500/30 text-red-300' 
                  : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                isLoading 
                  ? isDark ? 'bg-white/20 cursor-not-allowed' : 'bg-gray-200 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-600 hover:from-purple-500 hover:via-blue-500 hover:to-cyan-500 shadow-lg hover:shadow-xl'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <svg className={`animate-spin h-5 w-5 ${isDark ? 'text-white' : 'text-gray-600'}`} fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>{isLogin ? '登录中...' : '注册中...'}</span>
                </div>
              ) : (
                <span>{isLogin ? '登录' : '注册'}</span>
              )}
            </button>
          </form>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className={`w-full border-t ${isDark ? 'border-white/20' : 'border-gray-200'}`} />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className={`px-4 -top-2 relative ${
                  isDark ? 'bg-white/10 text-white/60' : 'bg-gray-50 text-gray-500'
                }`}>或使用以下方式登录</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <button
                onClick={() => handleSocialLogin('微信')}
                className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                  isDark 
                    ? 'bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30' 
                    : 'bg-green-50 border border-green-200 text-green-600 hover:bg-green-100'
                }`}
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c4.801 0 8.692-3.287 8.692-7.342 0-4.054-3.891-7.34-8.692-7.34z" />
                </svg>
                <span>微信登录</span>
              </button>
              <button
                onClick={() => handleSocialLogin('QQ')}
                className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                  isDark 
                    ? 'bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30' 
                    : 'bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100'
                }`}
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                <span>QQ登录</span>
              </button>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
              {isLogin ? '还没有账号？' : '已有账号？'}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className={`ml-2 font-semibold transition-colors duration-300 ${
                  isDark ? 'text-purple-400 hover:text-purple-300' : 'text-purple-600 hover:text-purple-500'
                }`}
              >
                {isLogin ? '立即注册' : '立即登录'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}