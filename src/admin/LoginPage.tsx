/**
 * 管理后台登录页（V2.0.0：全角色单阶段登录）
 * 用户名 + 密码 + Turnstile 人机验证，校验通过即签发 JWT。
 * 原超管短信验证码第二因素已随手机验证码体系一并移除。
 */
import { useRef, useState } from 'react';
import { Lock, User } from 'lucide-react';
import { login, setAdminToken } from './api';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../components/TurnstileWidget';

/** LoginPage 组件 props */
interface LoginPageProps {
  /** 登录成功回调 */
  onLogin: () => void;
}

/**
 * 管理后台登录页组件
 * @param onLogin 登录成功回调
 * @returns 登录表单 JSX
 */
export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  /**
   * 提交登录
   * @param e 表单提交事件
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username.trim(), password, turnstileToken);

    if (result.success && result.token) {
      setAdminToken(result.token);
      onLogin();
    } else {
      // 锁定场景展示剩余等待时间
      if (result.code === 'ADMIN_LOGIN_LOCKED' && result.data?.retry_after_seconds) {
        setError(`${result.message || '账号已临时锁定'}（约 ${Math.ceil(result.data.retry_after_seconds / 60)} 分钟后重试）`);
      } else {
        setError(result.message || '登录失败');
      }
      // 令牌一次性：失败后重置挑战
      setTurnstileToken('');
      turnstileRef.current?.reset();
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-200">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-full mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">管理后台</h1>
          <p className="text-gray-500 mt-2">TLRphotos 管理系统</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
                placeholder="请输入用户名"
                maxLength={64}
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
                placeholder="请输入密码"
                maxLength={128}
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
          </div>

          <TurnstileWidget
            ref={turnstileRef}
            action="admin_login"
            theme="light"
            onSuccess={setTurnstileToken}
            onError={(msg) => setError(msg)}
            onExpire={() => setTurnstileToken('')}
            className="flex justify-center"
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password || !turnstileToken}
            className="w-full py-3 bg-gradient-to-r from-blue-700 to-blue-800 hover:from-blue-800 hover:to-blue-900 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
