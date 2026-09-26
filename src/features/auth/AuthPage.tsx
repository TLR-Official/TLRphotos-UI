/**
 * 登录注册页
 * V1.11.0 两段式登录与验证码注册：
 *  - 登录第一段：账号（邮箱或手机号）+ 密码 + Turnstile，密码通过后进入验证码确认段；
 *  - 登录第二段：通道选择（邮箱/手机，仅一个时隐藏）、验证码输入、60s 重发倒计时；
 *  - 手机号未注册：提示「该手机号未注册，继续登录将注册新账号」并可一键切换到注册表单预填手机号；
 *  - 注册：账号 + 密码 + 确认密码 + 可选用户名 + 验证码（60s 倒计时）+ Turnstile，注册成功即登录。
 * Turnstile 令牌为一次性，发送验证码 / 提交表单分别消耗一枚，使用后立即 reset 重新挑战。
 */
import { useState, useEffect, useRef } from 'react';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../../components/TurnstileWidget';
import { useUser } from '../../shared/UserContext';
import { sendOtp } from '../../api/auth';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../shared/ThemeContext';

/** 识别账号类型：手机号 / 邮箱 / 无效 */
function detectIdentifierType(value: string): 'phone' | 'email' | null {
  const v = value.trim();
  if (/^1[3-9]\d{9}$/.test(v)) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  return null;
}

/**
 * 登录注册页组件
 * @returns 登录注册表单 JSX
 */
export function AuthPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // isLogin：true 为登录模式，false 为注册模式
  const [isLogin, setIsLogin] = useState(true);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  // remember：登录模式下是否保存登录状态（30 天）
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  // successMsg：绿色成功提示（验证码已发送等）
  const [successMsg, setSuccessMsg] = useState('');
  // phoneNotice：手机号未注册引导提示（404 PHONE_NOT_REGISTERED）
  const [phoneNotice, setPhoneNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Turnstile 令牌与实例（登录第一段 / 注册 / 登录第二段各自独立，令牌一次性）
  const [loginToken, setLoginToken] = useState('');
  const [regToken, setRegToken] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const loginTurnstileRef = useRef<TurnstileWidgetHandle>(null);
  const regTurnstileRef = useRef<TurnstileWidgetHandle>(null);
  const otpTurnstileRef = useRef<TurnstileWidgetHandle>(null);

  // 注册验证码：code / 60s 倒计时 / 发送中
  const [regCode, setRegCode] = useState('');
  const [regCooldown, setRegCooldown] = useState(0);
  const [regSending, setRegSending] = useState(false);

  // 登录第二段：票据 / 通道 / 验证码 / 倒计时 / 脱敏目标
  const [otpStage, setOtpStage] = useState(false);
  const [loginTicket, setLoginTicket] = useState('');
  const [channels, setChannels] = useState<Array<'email' | 'phone'>>([]);
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [maskedTarget, setMaskedTarget] = useState('');
  // 进入第二段后，待 Turnstile 挑战成功即自动发出首条验证码
  const autoSendRef = useRef(false);

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
    setPhoneNotice('');
    setPassword('');
    setConfirmPassword('');
    setOtpStage(false);
    setLoginTicket('');
    setOtpCode('');
    setMaskedTarget('');
    setRegCode('');
    setRegCooldown(0);
    setOtpCooldown(0);
    autoSendRef.current = false;
    setLoginToken('');
    setRegToken('');
    setOtpToken('');
    loginTurnstileRef.current?.reset();
    regTurnstileRef.current?.reset();
    otpTurnstileRef.current?.reset();
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

  /** 当前登录第二段所选通道的验证目标是否为登录时输入的账号（另一通道的目标前端不可知） */
  const isChannelTargetKnown = (c: 'email' | 'phone') => detectIdentifierType(identifier) === c;

  /**
   * 发送登录验证码（第二段）
   * @param token 可用的 Turnstile 令牌（自动发送场景由 onSuccess 直接传入）
   */
  const doSendLoginOtp = async (token: string) => {
    if (!isChannelTargetKnown(channel)) {
      setError('该验证通道需使用对应账号登录后才能发送验证码');
      return;
    }
    setOtpSending(true);
    setError('');
    const res = await sendOtp(identifier.trim(), 'login', token);
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

  /** 发送注册验证码 */
  const handleSendRegCode = async () => {
    setError('');
    setSuccessMsg('');
    if (!detectIdentifierType(identifier)) {
      setError('请输入正确的手机号或邮箱');
      return;
    }
    if (!regToken) {
      setError('请先完成安全验证');
      return;
    }
    setRegSending(true);
    const res = await sendOtp(identifier.trim(), 'register', regToken);
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

  /** 切换到注册表单并预填手机号（手机号未注册引导） */
  const handleGotoRegister = () => {
    setIsLogin(false);
    setPhoneNotice('');
  };

  /** 返回登录第一段修改密码 */
  const handleBackToPassword = () => {
    setOtpStage(false);
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

  /** 切换登录第二段验证通道 */
  const handleChannelChange = (c: 'email' | 'phone') => {
    if (c === channel) return;
    setChannel(c);
    setOtpCode('');
    setError('');
    setSuccessMsg('');
    setMaskedTarget('');
    setOtpCooldown(0);
    // 目标已知（与登录账号同类型）时重置挑战并自动发送新通道验证码
    if (isChannelTargetKnown(c)) {
      autoSendRef.current = true;
      setOtpToken('');
      otpTurnstileRef.current?.reset();
    }
  };

  /**
   * 表单提交处理
   * 登录第一段：密码校验 → otp_required 进入第二段 / phone_not_registered 引导注册；
   * 登录第二段：验证码确认 → 登录成功；
   * 注册：验证码 + 密码一致性校验 → 注册成功即登录。
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setPhoneNotice('');

    if (!identifier.trim() || !password) {
      setError(isLogin ? '请填写账号和密码' : '请填写邮箱/手机号和密码');
      return;
    }

    if (isLogin && otpStage) {
      // 登录第二段：验证码确认
      if (!/^\d{6}$/.test(otpCode)) {
        setError('请输入 6 位验证码');
        return;
      }
      setIsLoading(true);
      try {
        await verifyLogin(loginTicket, channel, otpCode);
        navigate('/');
      } catch (err) {
        setError(err instanceof Error ? err.message : '登录失败');
        if ((err as { code?: string })?.code === 'INVALID_TICKET') {
          // 票据失效：回到第一段重新登录
          handleBackToPassword();
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (isLogin) {
      // 登录第一段：密码校验
      if (!detectIdentifierType(identifier)) {
        setError('请输入正确的手机号或邮箱');
        return;
      }
      setIsLoading(true);
      try {
        const result = await login(identifier.trim(), password, loginToken || undefined);
        if (result.status === 'success') {
          navigate('/');
          return;
        }
        if (result.status === 'phone_not_registered') {
          setPhoneNotice(result.message);
          return;
        }
        // otp_required：进入第二段，默认通道与登录账号类型一致
        const preferred = detectIdentifierType(identifier) === 'phone' ? 'phone' : 'email';
        const nextChannel = result.channels.includes(preferred) ? preferred : result.channels[0];
        setLoginTicket(result.loginTicket);
        setChannels(result.channels);
        setChannel(nextChannel);
        setOtpStage(true);
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
    if (!detectIdentifierType(identifier)) {
      setError('请输入正确的手机号或邮箱');
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
      await register(identifier.trim(), password, username.trim() || undefined, regCode, regToken || undefined);
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

  // 输入框通用样式
  const inputClass = `w-full pl-12 pr-4 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent transition-all duration-300 ${
    isDark
      ? 'bg-white/10 border border-white/20 text-white placeholder-white/40'
      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
  }`;

  return (
    <div className="flex items-center justify-center py-8">
      <div className="relative w-full max-w-md">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-600 via-blue-600 to-cyan-500 rounded-3xl blur-xl opacity-30 animate-pulse" />

        <div className={`relative backdrop-blur-lg rounded-3xl p-8 border shadow-2xl transition-all duration-500 ${
          isDark
            ? 'bg-white/10 border-white/20'
            : 'bg-gray-50/90 border-gray-200 shadow-gray-200'
        }`}>
          <div className="flex justify-center mb-8">
            <div className={`text-4xl font-bold ${
              isDark
                ? 'bg-gradient-to-r from-teal-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent'
                : 'bg-gradient-to-r from-teal-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent'
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
                    ? 'bg-gradient-to-r from-teal-600 to-blue-600 text-white shadow-lg transform scale-105'
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
            {/* 登录第二段：验证码确认 */}
            {isLogin && otpStage ? (
              <>
                <div className={`rounded-xl p-4 text-sm ${
                  isDark ? 'bg-teal-500/10 border border-teal-500/30 text-teal-300' : 'bg-teal-50 border border-teal-200 text-teal-700'
                }`}>
                  验证码已发送至{maskedTarget ? ` ${maskedTarget} ` : channel === 'email' ? '您的邮箱' : '您的手机'}，请在 10 分钟内完成验证
                </div>

                {/* 通道选择：仅一个可用通道时隐藏 */}
                {channels.length > 1 && (
                  <div className="flex gap-3">
                    {channels.map((c) => {
                      const known = isChannelTargetKnown(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          disabled={!known}
                          title={known ? undefined : '该通道需使用对应账号登录'}
                          onClick={() => handleChannelChange(c)}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                            channel === c
                              ? 'bg-gradient-to-r from-teal-600 to-blue-600 text-white shadow-lg'
                              : known
                                ? isDark
                                  ? 'bg-white/10 text-white/70 hover:bg-white/20'
                                  : 'bg-white border border-gray-200 text-gray-600 hover:border-teal-400'
                                : isDark
                                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {c === 'email' ? '邮箱验证' : '手机验证'}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6 位验证码"
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
                        ? isDark ? 'text-white/30 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed'
                        : isDark ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-500'
                    }`}
                  >
                    {otpSending ? '发送中...' : otpCooldown > 0 ? `${otpCooldown}s 后重新发送` : '重新发送验证码'}
                  </button>
                  <button
                    type="button"
                    onClick={handleBackToPassword}
                    className={`text-sm transition-colors duration-300 ${
                      isDark ? 'text-white/50 hover:text-white/80' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    返回修改密码
                  </button>
                </div>

                {/* 第二段 Turnstile：首枚令牌自动触发发送验证码，之后供重发使用 */}
                <TurnstileWidget
                  ref={otpTurnstileRef}
                  action="login"
                  theme={isDark ? 'dark' : 'light'}
                  onSuccess={handleOtpTurnstileSuccess}
                  onExpire={() => setOtpToken('')}
                  onError={() => setOtpToken('')}
                />
              </>
            ) : (
              <>
                {/* 账号（邮箱或手机号） */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="邮箱或手机号"
                    className={inputClass}
                  />
                </div>

                {/* 密码 */}
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
                        className={`w-5 h-5 rounded border-2 transition-all duration-300 focus:ring-2 focus:ring-teal-600 ${
                          isDark
                            ? 'border-white/30 text-teal-700 bg-white/10'
                            : 'border-gray-300 text-teal-700 bg-white'
                        }`}
                      />
                      <span className={`ml-2 text-sm ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
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
                    <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

                {/* 注册验证码 + 发送按钮 */}
                {!isLogin && (
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg className={`h-5 w-5 ${isDark ? 'text-white/50' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6 位验证码"
                        className={inputClass}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={regCooldown > 0 || regSending}
                      onClick={handleSendRegCode}
                      className={`flex-shrink-0 px-4 rounded-xl text-sm font-medium transition-all duration-300 ${
                        regCooldown > 0 || regSending
                          ? isDark ? 'bg-white/10 text-white/30 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-teal-600 to-blue-600 text-white hover:from-teal-500 hover:to-blue-500 shadow-lg'
                      }`}
                    >
                      {regSending ? '发送中...' : regCooldown > 0 ? `${regCooldown}s` : '发送验证码'}
                    </button>
                  </div>
                )}

                {/* 人机验证（Turnstile）：登录第一段 / 注册各一枚，令牌一次性，通过后 7 天内同 IP 免重复验证 */}
                <div>
                  <label className={`mb-2 block text-sm font-medium ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                    安全验证
                  </label>
                  {isLogin ? (
                    <TurnstileWidget
                      ref={loginTurnstileRef}
                      action="login"
                      theme={isDark ? 'dark' : 'light'}
                      onSuccess={setLoginToken}
                      onExpire={() => setLoginToken('')}
                      onError={() => setLoginToken('')}
                    />
                  ) : (
                    <TurnstileWidget
                      ref={regTurnstileRef}
                      action="register"
                      theme={isDark ? 'dark' : 'light'}
                      onSuccess={setRegToken}
                      onExpire={() => setRegToken('')}
                      onError={() => setRegToken('')}
                    />
                  )}
                </div>
              </>
            )}

            {/* 手机号未注册引导 */}
            {phoneNotice && (
              <div className={`rounded-xl p-4 ${
                isDark ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-amber-50 border border-amber-200'
              }`}>
                <p className={`text-sm ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>{phoneNotice}</p>
                <button
                  type="button"
                  onClick={handleGotoRegister}
                  className={`mt-2 text-sm font-semibold transition-colors duration-300 ${
                    isDark ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-500'
                  }`}
                >
                  去注册
                </button>
              </div>
            )}

            {error && (
              <div className={`rounded-xl p-4 text-center ${
                isDark
                  ? 'bg-red-500/20 border border-red-500/30 text-red-300'
                  : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                {error}
              </div>
            )}

            {successMsg && !error && (
              <div className={`rounded-xl p-4 text-center ${
                isDark
                  ? 'bg-green-500/20 border border-green-500/30 text-green-300'
                  : 'bg-green-50 border border-green-200 text-green-600'
              }`}>
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                isLoading
                  ? isDark ? 'bg-white/20 cursor-not-allowed' : 'bg-gray-200 cursor-not-allowed'
                  : 'bg-gradient-to-r from-teal-600 via-blue-600 to-cyan-600 hover:from-teal-500 hover:via-blue-500 hover:to-cyan-500 shadow-lg hover:shadow-xl'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <svg className={`animate-spin h-5 w-5 ${isDark ? 'text-white' : 'text-gray-600'}`} fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>{isLogin ? (otpStage ? '验证中...' : '登录中...') : '注册中...'}</span>
                </div>
              ) : (
                <span>{isLogin ? (otpStage ? '确认登录' : '登录') : '注册'}</span>
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
                  isDark ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-500'
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
