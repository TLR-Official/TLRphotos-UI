/**
 * 登录注册页（V2.0.0：纯邮箱认证体系）
 *  - 登录第一段：邮箱 + 密码 + Turnstile，密码通过后进入邮箱验证码确认段；
 *  - 登录第二段：邮箱验证码输入、60s 重发倒计时，每次登录均须验码；
 *  - 无邮箱账号：进入内联邮箱绑定段，凭 bind_ticket 发码并确认，绑定成功即完成登录；
 *  - 注册：邮箱 + 密码 + 确认密码 + 可选用户名 + 邮箱验证码（60s 倒计时）+ Turnstile，注册成功即登录。
 * Turnstile 令牌为一次性，发送验证码 / 提交表单分别消耗一枚，使用后立即 reset 重新挑战。
 */
import { useState, useEffect, useRef } from 'react';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../../components/TurnstileWidget';
import { useUser } from '../../shared/UserContext';
import { sendEmailCode, bindEmail, type LoginSuccessData } from '../../api/auth';
import { useNavigate } from 'react-router-dom';

/** 邮箱格式校验（与后端口径一致） */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** 登录页所处阶段：凭证输入 / 登录验证码 / 强制绑定邮箱 */
type AuthStage = 'credentials' | 'otp' | 'bind';

/**
 * 登录注册页组件
 * @returns 登录注册表单 JSX
 */
export function AuthPage() {
  // isLogin：true 为登录模式，false 为注册模式
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  // V4.7.0：邀请码（注册选填，有效时授予专属称号）
  const [inviteCode, setInviteCode] = useState('');
  // remember：登录模式下是否保存登录状态（30 天）
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  // successMsg：绿色成功提示（验证码已发送等）
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 登录流程阶段（V2.0.0：凭证 / 验证码 / 绑定邮箱）
  const [stage, setStage] = useState<AuthStage>('credentials');

  // Turnstile 令牌与实例（登录第一段 / 注册 / 登录第二段 / 绑定段各自独立，令牌一次性）
  const [loginToken, setLoginToken] = useState('');
  const [regToken, setRegToken] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [bindToken, setBindToken] = useState('');
  const loginTurnstileRef = useRef<TurnstileWidgetHandle>(null);
  const regTurnstileRef = useRef<TurnstileWidgetHandle>(null);
  const otpTurnstileRef = useRef<TurnstileWidgetHandle>(null);
  const bindTurnstileRef = useRef<TurnstileWidgetHandle>(null);

  // 注册验证码：code / 60s 倒计时 / 发送中
  const [regCode, setRegCode] = useState('');
  const [regCooldown, setRegCooldown] = useState(0);
  const [regSending, setRegSending] = useState(false);

  // 登录第二段：票据 / 验证码 / 倒计时 / 脱敏目标
  const [loginTicket, setLoginTicket] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [maskedTarget, setMaskedTarget] = useState('');
  // 进入第二段后，待 Turnstile 挑战成功即自动发出首条验证码
  const autoSendRef = useRef(false);

  // 绑定段：绑定票据 / 新邮箱 / 验证码 / 倒计时 / 脱敏目标
  const [bindTicket, setBindTicket] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [bindCode, setBindCode] = useState('');
  const [bindCooldown, setBindCooldown] = useState(0);
  const [bindSending, setBindSending] = useState(false);
  const [bindMasked, setBindMasked] = useState('');
  // 点击「发送验证码」时若挑战尚未完成，待挑战成功即补发
  const pendingBindSendRef = useRef(false);

  const { login, verifyLogin, register, isAuthenticated } = useUser();
  const navigate = useNavigate();

  // 已登录用户访问登录页时自动跳转首页
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // 切换登录/注册模式时重置全部表单状态与人机验证（action 变化，旧令牌不再匹配）
  useEffect(() => {
    setError('');
    setSuccessMsg('');
    setPassword('');
    setConfirmPassword('');
    setStage('credentials');
    setLoginTicket('');
    setOtpCode('');
    setMaskedTarget('');
    setBindTicket('');
    setNewEmail('');
    setBindCode('');
    setBindMasked('');
    setRegCode('');
    setRegCooldown(0);
    setOtpCooldown(0);
    setBindCooldown(0);
    autoSendRef.current = false;
    pendingBindSendRef.current = false;
    setLoginToken('');
    setRegToken('');
    setOtpToken('');
    setBindToken('');
    loginTurnstileRef.current?.reset();
    regTurnstileRef.current?.reset();
    otpTurnstileRef.current?.reset();
    bindTurnstileRef.current?.reset();
  }, [isLogin]);

  // 注册发送验证码 60s 倒计时
  useEffect(() => {
    if (regCooldown <= 0) return;
    const timer = setInterval(() => setRegCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [regCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // 登录第二段重发 60s 倒计时
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => setOtpCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [otpCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // 绑定段重发 60s 倒计时
  useEffect(() => {
    if (bindCooldown <= 0) return;
    const timer = setInterval(() => setBindCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [bindCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 发送登录验证码（第二段）
   * @param token 可用的 Turnstile 令牌（自动发送场景由 onSuccess 直接传入）
   */
  const doSendLoginOtp = async (token: string) => {
    setOtpSending(true);
    setError('');
    const res = await sendEmailCode(email.trim(), 'login', token);
    setOtpSending(false);
    // 令牌已消耗，重置挑战获取下一枚（供 60s 后重发使用）
    setOtpToken('');
    otpTurnstileRef.current?.reset();
    if (res.success && res.data) {
      setOtpCooldown(res.data.cooldown || 60);
      setMaskedTarget(res.data.target);
      setSuccessMsg('验证码已发送，10 分钟内有效');
    } else {
      setError(res.message || '验证码发送失败，请稍后再试');
    }
  };

  /** 登录第二段 Turnstile 挑战成功回调：记录令牌；首次进入时自动发出验证码 */
  const handleOtpTurnstileSuccess = (token: string) => {
    setOtpToken(token);
    if (autoSendRef.current) {
      autoSendRef.current = false;
      void doSendLoginOtp(token);
    }
  };

  /**
   * 发送绑定邮箱验证码（绑定段）
   * @param token 可用的 Turnstile 令牌
   */
  const doSendBindCode = async (token: string) => {
    setBindSending(true);
    setError('');
    const res = await sendEmailCode(newEmail.trim(), 'bind_email', token, bindTicket);
    setBindSending(false);
    // 令牌已消耗，重置挑战获取确认步所需的下一枚
    setBindToken('');
    bindTurnstileRef.current?.reset();
    if (res.success && res.data) {
      setBindCooldown(res.data.cooldown || 60);
      setBindMasked(res.data.target);
      setSuccessMsg('验证码已发送，10 分钟内有效');
    } else {
      setError(res.message || '验证码发送失败，请稍后再试');
    }
  };

  /** 绑定段 Turnstile 挑战成功回调：记录令牌；若此前已点击发送则补发 */
  const handleBindTurnstileSuccess = (token: string) => {
    setBindToken(token);
    if (pendingBindSendRef.current) {
      pendingBindSendRef.current = false;
      void doSendBindCode(token);
    }
  };

  /** 点击「发送验证码」：有令牌即发，无令牌则标记待挑战成功后补发 */
  const handleRequestBindCode = () => {
    setError('');
    setSuccessMsg('');
    if (!isValidEmail(newEmail)) {
      setError('请输入正确的邮箱地址');
      return;
    }
    if (bindToken) {
      void doSendBindCode(bindToken);
    } else {
      pendingBindSendRef.current = true;
      setError('安全验证未完成，请稍候再试');
    }
  };

  /** 发送注册验证码 */
  const handleSendRegCode = async () => {
    setError('');
    setSuccessMsg('');
    if (!isValidEmail(email)) {
      setError('请输入正确的邮箱地址');
      return;
    }
    if (!regToken) {
      setError('请先完成安全验证');
      return;
    }
    setRegSending(true);
    const res = await sendEmailCode(email.trim(), 'register', regToken);
    setRegSending(false);
    // 令牌已消耗，重置挑战获取下一枚（注册提交仍需一枚有效令牌）
    setRegToken('');
    regTurnstileRef.current?.reset();
    if (res.success && res.data) {
      setRegCooldown(res.data.cooldown || 60);
      setSuccessMsg(`验证码已发送至 ${res.data.target}，10 分钟内有效`);
    } else {
      setError(res.message || '验证码发送失败，请稍后再试');
    }
  };

  /** 返回登录第一段修改凭证 */
  const handleBackToCredentials = () => {
    setStage('credentials');
    setLoginTicket('');
    setOtpCode('');
    setMaskedTarget('');
    setError('');
    setSuccessMsg('');
    setOtpCooldown(0);
    autoSendRef.current = false;
    setOtpToken('');
    otpTurnstileRef.current?.reset();
    setLoginToken('');
    loginTurnstileRef.current?.reset();
  };

  /**
   * 表单提交处理
   * 登录第二段：验证码确认 → 登录成功；
   * 绑定段：验证码 + 新令牌确认绑定 → 绑定即登录；
   * 登录第一段：密码校验 → otp 进入第二段 / 无邮箱进入绑定段；
   * 注册：验证码 + 密码一致性校验 → 注册成功即登录。
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (stage === 'otp') {
      // 登录第二段：验证码确认
      if (!/^\d{6}$/.test(otpCode)) {
        setError('请输入 6 位验证码');
        return;
      }
      setIsLoading(true);
      try {
        await verifyLogin(loginTicket, otpCode);
        navigate('/');
      } catch (err) {
        setError(err instanceof Error ? err.message : '登录失败');
        if ((err as { code?: string })?.code === 'INVALID_TICKET') {
          // 票据失效：回到第一段重新登录
          handleBackToCredentials();
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (stage === 'bind') {
      // 绑定段：确认绑定（确认步仍需一枚未消耗的 Turnstile 令牌）
      if (!isValidEmail(newEmail)) {
        setError('请输入正确的邮箱地址');
        return;
      }
      if (!/^\d{6}$/.test(bindCode)) {
        setError('请输入 6 位验证码');
        return;
      }
      if (!bindToken) {
        setError('安全验证未完成，请稍候再试');
        return;
      }
      setIsLoading(true);
      try {
        const res = await bindEmail(newEmail.trim(), bindCode, bindToken, bindTicket);
        if (res.success && res.data && 'token' in res.data) {
          // 绑定即登录：持久化令牌后整页跳转，由 UserProvider 引导完成登录态初始化
          const data = res.data as LoginSuccessData;
          localStorage.setItem('token', data.token);
          if (data.session_token) localStorage.setItem('session_token', data.session_token);
          window.location.assign('/');
          return;
        }
        setError(res.message || '邮箱绑定失败，请稍后再试');
      } catch (err) {
        setError(err instanceof Error ? err.message : '邮箱绑定失败');
        if ((err as { code?: string })?.code === 'INVALID_TICKET') {
          setError('绑定凭证已失效，请重新登录');
          handleBackToCredentials();
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setError(isLogin ? '请填写邮箱和密码' : '请填写邮箱和密码');
      return;
    }

    if (isLogin) {
      // 登录第一段：密码校验
      if (!isValidEmail(email)) {
        setError('请输入正确的邮箱地址');
        return;
      }
      setIsLoading(true);
      try {
        const result = await login(email.trim(), password, loginToken || undefined);
        if (result.status === 'success') {
          navigate('/');
          return;
        }
        if (result.status === 'email_bind_required') {
          // 无邮箱账号：进入内联绑定段
          setBindTicket(result.bindTicket);
          setNewEmail('');
          setBindCode('');
          setBindMasked('');
          setBindCooldown(0);
          pendingBindSendRef.current = false;
          setBindToken('');
          bindTurnstileRef.current?.reset();
          setStage('bind');
          return;
        }
        // otp_required：进入第二段，等待 Turnstile 成功后自动发送验证码
        setLoginTicket(result.loginTicket);
        setStage('otp');
        autoSendRef.current = true;
        // 第一段令牌已消耗，重置挑战（返回第一段时需新令牌）
        setLoginToken('');
        loginTurnstileRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : '登录失败');
        setLoginToken('');
        loginTurnstileRef.current?.reset();
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 注册
    if (!isValidEmail(email)) {
      setError('请输入正确的邮箱地址');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (!/^\d{6}$/.test(regCode)) {
      setError('请输入 6 位验证码');
      return;
    }
    setIsLoading(true);
    try {
      await register(
        email.trim(),
        password,
        username.trim() || undefined,
        regCode,
        regToken || undefined,
        inviteCode.trim() || undefined,
      );
      // 注册成功即登录
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
      setRegToken('');
      regTurnstileRef.current?.reset();
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 第三方登录占位处理
   * @param provider 第三方提供方名称（如 微信 / QQ）
   */
  const handleSocialLogin = (provider: string) => {
    setError(`${provider} 登录功能开发中`);
    setTimeout(() => setError(''), 3000);
  };

  // 输入框通用样式（移动端 ≤768px：h-12 固定高 + 16px 字号防 iOS 聚焦放大）
  const inputClass = 'w-full pl-12 pr-4 py-4 rounded-xl bg-white border border-gray-200 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent transition-all duration-300 max-md:h-12 max-md:py-0';

  return (
    <div className="flex items-center justify-center py-8">
      <div className="relative w-full max-w-md">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 rounded-3xl blur-xl opacity-30 animate-pulse" />

        <div className="relative backdrop-blur-lg rounded-3xl p-8 border bg-gray-50/90 border-gray-200 shadow-2xl shadow-gray-200 transition-all duration-500">
          <div className="flex justify-center mb-8">
            <div className="text-4xl font-bold bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 bg-clip-text text-transparent">
              TLRphotos
            </div>
          </div>

          <div className="flex justify-center mb-8">
            <div className="relative w-64 h-12 rounded-full p-1 bg-gray-200">
              <button
                onClick={() => setIsLogin(true)}
                className={`absolute inset-y-0 left-0 right-1/2 flex items-center justify-center rounded-full transition-all duration-500 ease-out ${
                  isLogin
                    ? 'bg-gradient-to-r from-blue-700 to-blue-800 text-white shadow-lg transform scale-105'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                登录
              </button>
              <button
                onClick={() => setIsLogin(false)}
                className={`absolute inset-y-0 left-1/2 right-0 flex items-center justify-center rounded-full transition-all duration-500 ease-out ${
                  !isLogin
                    ? 'bg-gradient-to-r from-blue-700 to-blue-800 text-white shadow-lg transform scale-105'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                注册
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 登录第二段：邮箱验证码确认 */}
            {isLogin && stage === 'otp' ? (
              <>
                <div className="rounded-xl p-4 text-sm bg-blue-50 border border-blue-200 text-blue-800">
                  验证码已发送至{maskedTarget ? ` ${maskedTarget} ` : '您的邮箱'}，请在 10 分钟内完成验证
                </div>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6 位邮箱验证码"
                    className={inputClass}
                  />
                </div>

                {/* 重发验证码：60s 倒计时，发送中禁用 */}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={otpCooldown > 0 || otpSending}
                    onClick={() => {
                      if (!otpToken) {
                        setError('安全验证未完成，请稍候再试');
                        return;
                      }
                      void doSendLoginOtp(otpToken);
                    }}
                    className={`text-sm font-medium transition-colors duration-300 ${
                      otpCooldown > 0 || otpSending
                        ? 'text-gray-400 cursor-not-allowed'
                        : 'text-blue-800 hover:text-blue-600'
                    }`}
                  >
                    {otpSending ? '发送中...' : otpCooldown > 0 ? `${otpCooldown}s 后重新发送` : '重新发送验证码'}
                  </button>
                  <button
                    type="button"
                    onClick={handleBackToCredentials}
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-300"
                  >
                    返回修改邮箱
                  </button>
                </div>

                {/* 第二段 Turnstile：首枚令牌自动触发发送验证码，之后供重发使用 */}
                <TurnstileWidget
                  ref={otpTurnstileRef}
                  action="login"
                  theme="light"
                  onSuccess={handleOtpTurnstileSuccess}
                  onExpire={() => setOtpToken('')}
                  onError={() => setOtpToken('')}
                />
              </>
            ) : isLogin && stage === 'bind' ? (
              /* 无邮箱账号：强制绑定邮箱段 */
              <>
                <div className="rounded-xl p-4 text-sm bg-amber-50 border border-amber-200 text-amber-800">
                  您的账号尚未绑定邮箱。为保障账号安全，请先填写常用邮箱并完成验证码确认，绑定成功后即可正常使用全部功能。
                </div>

                {/* 新邮箱 */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="请输入常用邮箱"
                    className={inputClass}
                  />
                </div>

                {/* 验证码 + 发送按钮 */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={bindCode}
                      onChange={(e) => setBindCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6 位验证码"
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={bindCooldown > 0 || bindSending}
                    onClick={handleRequestBindCode}
                    className={`flex-shrink-0 px-4 rounded-xl text-sm font-medium transition-all duration-300 ${
                      bindCooldown > 0 || bindSending
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-700 to-blue-800 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg'
                    }`}
                  >
                    {bindSending ? '发送中...' : bindCooldown > 0 ? `${bindCooldown}s` : '发送验证码'}
                  </button>
                </div>

                {bindMasked && (
                  <p className="text-xs text-gray-500 -mt-3">
                    验证码已发送至 {bindMasked}，10 分钟内有效
                  </p>
                )}

                {/* 绑定段 Turnstile：供发码与确认各消耗一枚 */}
                <TurnstileWidget
                  ref={bindTurnstileRef}
                  action="login"
                  theme="light"
                  onSuccess={handleBindTurnstileSuccess}
                  onExpire={() => setBindToken('')}
                  onError={() => setBindToken('')}
                />
              </>
            ) : (
              <>
                {/* 邮箱 */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="邮箱"
                    className={inputClass}
                  />
                </div>

                {/* 密码 */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="密码"
                    className={inputClass}
                  />
                </div>

                {isLogin && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="w-5 h-5 rounded border-2 border-gray-300 text-blue-800 bg-white transition-all duration-300 focus:ring-2 focus:ring-blue-700"
                      />
                      <span className="ml-2 text-sm text-gray-600">
                        保存登录状态（30天内有效）
                      </span>
                    </label>
                  </div>
                )}

                {/* 确认密码（注册） */}
                <div
                  className={`relative transition-all duration-500 ease-out ${
                    !isLogin ? 'opacity-100 max-h-32' : 'opacity-0 max-h-0 overflow-hidden'
                  }`}
                >
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="确认密码"
                    className={inputClass}
                  />
                </div>

                {/* 用户名（注册，可选） */}
                <div
                  className={`relative transition-all duration-500 ease-out ${
                    !isLogin ? 'opacity-100 max-h-32' : 'opacity-0 max-h-0 overflow-hidden'
                  }`}
                >
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="用户名（可选）"
                    className={inputClass}
                  />
                </div>

                {/* V4.7.0：邀请码（注册选填，有效时授予专属称号） */}
                {!isLogin && (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      maxLength={64}
                      autoComplete="off"
                      placeholder="邀请码（选填，可用于获得专属称号）"
                      className={inputClass}
                    />
                  </div>
                )}

                {/* 注册验证码 + 发送按钮 */}
                {!isLogin && (
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6 位邮箱验证码"
                        className={inputClass}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={regCooldown > 0 || regSending}
                      onClick={handleSendRegCode}
                      className={`flex-shrink-0 px-4 rounded-xl text-sm font-medium transition-all duration-300 ${
                        regCooldown > 0 || regSending
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-blue-700 to-blue-800 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg'
                      }`}
                    >
                      {regSending ? '发送中...' : regCooldown > 0 ? `${regCooldown}s` : '发送验证码'}
                    </button>
                  </div>
                )}

                {/* 人机验证（Turnstile）：登录第一段 / 注册各一枚，令牌一次性，通过后 7 天内同 IP 免重复验证 */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-600">
                    安全验证
                  </label>
                  {isLogin ? (
                    <TurnstileWidget
                      ref={loginTurnstileRef}
                      action="login"
                      theme="light"
                      onSuccess={setLoginToken}
                      onExpire={() => setLoginToken('')}
                      onError={() => setLoginToken('')}
                    />
                  ) : (
                    <TurnstileWidget
                      ref={regTurnstileRef}
                      action="register"
                      theme="light"
                      onSuccess={setRegToken}
                      onExpire={() => setRegToken('')}
                      onError={() => setRegToken('')}
                    />
                  )}
                </div>
              </>
            )}

            {error && (
              <div className="rounded-xl p-4 text-center bg-red-50 border border-red-200 text-red-600">
                {error}
              </div>
            )}

            {successMsg && !error && (
              <div className="rounded-xl p-4 text-center bg-green-50 border border-green-200 text-green-600">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                isLoading
                  ? 'bg-gray-200 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 hover:from-blue-600 hover:via-blue-500 hover:to-blue-400 shadow-lg hover:shadow-xl'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <svg className="animate-spin h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>
                    {isLogin ? (stage === 'otp' ? '验证中...' : stage === 'bind' ? '绑定中...' : '登录中...') : '注册中...'}
                  </span>
                </div>
              ) : (
                <span>
                  {isLogin ? (stage === 'otp' ? '确认登录' : stage === 'bind' ? '确认绑定并登录' : '登录') : '注册'}
                </span>
              )}
            </button>
          </form>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 -top-2 relative bg-gray-50 text-gray-500">或使用以下方式登录</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <button
                onClick={() => handleSocialLogin('微信')}
                className="flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-green-50 border border-green-200 text-green-600 hover:bg-green-100 transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c4.801 0 8.692-3.287 8.692-7.342 0-4.054-3.891-7.34-8.692-7.34z" />
                </svg>
                <span>微信登录</span>
              </button>
              <button
                onClick={() => handleSocialLogin('QQ')}
                className="flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                <span>QQ登录</span>
              </button>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              {isLogin ? '还没有账号？' : '已有账号？'}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="ml-2 font-semibold text-blue-800 hover:text-blue-600 transition-colors duration-300"
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
