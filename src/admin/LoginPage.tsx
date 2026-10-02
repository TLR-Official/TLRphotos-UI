/**
 * 管理后台登录页
 * 两阶段登录：
 * 1) 用户名 + 密码 + Turnstile 人机验证 —— 审核员通过即直接登录；
 * 2) 超管追加手机短信验证码（复用 Spug 短信通道），验证码通过才签发 JWT。
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, MessageSquare, ShieldCheck, User } from 'lucide-react';
import { login, sendAdminSms, verifyAdminSms, setAdminToken } from './api';
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
  // 第一阶段
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  // 第二阶段（仅超管）
  const [stage, setStage] = useState<'password' | 'sms'>('password');
  const [ticket, setTicket] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [error, setError] = useState('');
  /** 防止第二阶段验证码因 StrictMode/重复渲染被自动发送多次 */
  const autoSentRef = useRef('');

  // 重发倒计时：常驻 1s 节拍，到 0 自动停止
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * 发送/重发超管短信验证码
   * @param useTicket 指定票据（默认当前票据）
   */
  const handleSendSms = async (useTicket = ticket) => {
    if (!useTicket) return;
    setSmsSending(true);
    setError('');

    const result = await sendAdminSms(username.trim(), useTicket);

    if (result.success) {
      setCountdown(result.cooldown_seconds ?? 60);
    } else {
      setError(result.message || '验证码发送失败，请稍后再试');
    }
    setSmsSending(false);
  };

  // 进入第二阶段后自动发送一次验证码（同票据只发一次）
  useEffect(() => {
    if (stage === 'sms' && ticket && autoSentRef.current !== ticket) {
      autoSentRef.current = ticket;
      void handleSendSms(ticket);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, ticket]);

  /**
   * 提交第一阶段登录
   * 审核员直接保存 token 并进入后台；超管切换到短信验证阶段。
   * @param e 表单提交事件
   */
  const handleStageOneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username.trim(), password, turnstileToken);

    if (result.success && result.token) {
      // 审核员：第一阶段即完成登录
      setAdminToken(result.token);
      onLogin();
    } else if (result.success && result.sms_required && result.ticket) {
      // 超管：进入短信第二因素阶段（此刻尚未签发 JWT）
      setTicket(result.ticket);
      setSmsCode('');
      setStage('sms');
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

  /**
   * 提交短信验证码完成超管登录
   * @param e 表单提交事件
   */
  const handleStageTwoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = smsCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位数字验证码');
      return;
    }

    setError('');
    setVerifying(true);

    const result = await verifyAdminSms(username.trim(), ticket, code);

    if (result.success && result.token) {
      setAdminToken(result.token);
      onLogin();
    } else {
      if (result.code === 'ADMIN_LOGIN_LOCKED' && result.data?.retry_after_seconds) {
        setError(`${result.message || '账号已临时锁定'}（约 ${Math.ceil(result.data.retry_after_seconds / 60)} 分钟后重试）`);
      } else {
        setError(result.message || '验证失败，请重新输入');
      }
      setSmsCode('');
    }
    setVerifying(false);
  };

  /** 返回第一阶段：票据作废，重新完成人机挑战 */
  const handleBack = () => {
    setStage('password');
    setTicket('');
    setSmsCode('');
    setCountdown(0);
    setError('');
    setTurnstileToken('');
    turnstileRef.current?.reset();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-200">
        {stage === 'password' ? (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-teal-500 to-blue-500 rounded-full mb-4">
                <Lock className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-800">管理后台</h1>
              <p className="text-gray-500 mt-2">TLRphotos 管理系统</p>
            </div>

            <form onSubmit={handleStageOneSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
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
                    className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
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
                className="w-full py-3 bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {loading ? '登录中...' : '登录'}
              </button>
            </form>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-700 transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </button>

            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-teal-500 to-blue-500 rounded-full mb-4">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-800">手机验证</h1>
              <p className="text-gray-500 mt-2 text-sm">
                验证码已发送至该超管账号绑定的手机号
                <br />
                请输入收到的 6 位短信验证码
              </p>
            </div>

            <form onSubmit={handleStageTwoSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">短信验证码</label>
                <div className="relative">
                  <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                    placeholder="6 位验证码"
                    maxLength={6}
                    autoComplete="one-time-code"
                    disabled={verifying}
                    autoFocus
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={verifying || smsCode.length !== 6 || smsSending}
                className="w-full py-3 bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-700 hover:to-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {verifying ? '验证中...' : '确认登录'}
              </button>

              <div className="text-center text-sm">
                {countdown > 0 ? (
                  <span className="text-gray-400">{countdown} 秒后可重新发送</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSendSms()}
                    disabled={smsSending}
                    className="text-teal-700 hover:text-teal-800 font-medium disabled:text-gray-400"
                  >
                    {smsSending ? '发送中...' : '重新发送验证码'}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
