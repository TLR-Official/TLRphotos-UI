/**
 * 强制改密页
 * 登录后账号 must_change_password=1 时展示：必须设置符合强度的新密码后才能进入后台。
 * 改密成功后旧 JWT 立即失效，以响应中的新 JWT 接替。
 */
import { useRef, useState } from 'react';
import { AlertTriangle, KeyRound, Lock } from 'lucide-react';
import { changeMyPassword, setAdminToken } from './api';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../components/TurnstileWidget';

/** ForceChangePassword 组件 props */
interface ForceChangePasswordProps {
  /** 改密成功回调（携带新 JWT 已完成存储） */
  onDone: () => void;
  /** 放弃登录回调（清除凭据回到登录页） */
  onLogout: () => void;
}

/**
 * 新密码强度本地提示口径（与后端 validateSuperAdminPassword 对齐）：
 * trim 后 12–128 位、不等于当前密码、不与用户名相同由后端最终把关。
 */
function localStrengthHint(pw: string): string {
  if (pw.length === 0) return '';
  if (pw.trim().length < 12) return '至少 12 位字符';
  return '';
}

/**
 * 强制改密组件
 * @param onDone 改密成功回调
 * @param onLogout 放弃登录回调
 */
export function ForceChangePassword({ onDone, onLogout }: ForceChangePasswordProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  /**
   * 提交改密：成功后存储新 JWT 并通知父组件；失败重置人机验证。
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (localStrengthHint(newPassword)) {
      setError(localStrengthHint(newPassword));
      return;
    }

    setLoading(true);
    const result = await changeMyPassword(currentPassword, newPassword, confirmPassword, turnstileToken);

    if (result.success && result.token) {
      setAdminToken(result.token);
      onDone();
    } else {
      setError(result.message || '密码修改失败，请重试');
      setTurnstileToken('');
      turnstileRef.current?.reset();
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-200">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">请先修改密码</h1>
          <p className="text-gray-500 mt-2 text-sm">
            当前为初始/已泄露密码，完成改密后才能访问管理后台
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">当前密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                placeholder="请输入当前密码"
                maxLength={128}
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">新密码</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                placeholder="至少 12 位字符"
                maxLength={128}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">确认新密码</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                placeholder="再次输入新密码"
                maxLength={128}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>

          <TurnstileWidget
            ref={turnstileRef}
            action="admin_change_password"
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
            disabled={loading || !currentPassword || !newPassword || !confirmPassword || !turnstileToken}
            className="w-full py-3 bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? '提交中...' : '确认修改并进入后台'}
          </button>

          <button
            type="button"
            onClick={onLogout}
            disabled={loading}
            className="w-full py-2 text-gray-500 hover:text-gray-700 text-sm transition-colors"
          >
            退出并返回登录页
          </button>
        </form>
      </div>
    </div>
  );
}
