/**
 * @file 用户上下文
 * @description
 *  全局用户认证与信息状态管理。
 *  核心功能：
 *   1. 维护 user / token / isAuthenticated / isLoading 等状态。
 *   2. 提供 login / register / logout / updateUserInfo / refreshUser 等方法。
 *   3. 应用启动时尝试用 localStorage 中的 token 获取用户信息；失败则尝试 session_token 自动登录。
 *   4. 通过 Context API 向全组件树暴露用户状态，避免逐层 props 传递。
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { login, register, verifyLogin, getCurrentUser, updateUser, refresh } from '../api/auth';
import type { User } from '../api/auth';

/**
 * 登录流程结果（V1.11.0 两段式登录）
 * - success：直接登录成功（测试 bypass 场景）
 * - otp_required：密码校验通过，需凭 login_ticket 完成验证码确认
 * - phone_not_registered：手机号未注册，引导「继续登录将注册新账号」流程
 */
export type LoginFlowResult =
  | { status: 'success' }
  | { status: 'otp_required'; loginTicket: string; channels: Array<'email' | 'phone'> }
  | { status: 'phone_not_registered'; message: string };

/**
 * 用户上下文类型
 */
interface UserContextType {
  user: User | null;                                              // 当前用户信息
  token: string | null;                                           // 当前 Token
  isAuthenticated: boolean;                                       // 是否已认证（user 是否存在）
  isLoading: boolean;                                             // 初始化加载中
  login: (identifier: string, password: string, turnstileToken?: string) => Promise<LoginFlowResult>;
  verifyLogin: (loginTicket: string, channel: 'email' | 'phone', code: string) => Promise<void>;
  register: (identifier: string, password: string, username: string | undefined, code: string, turnstileToken?: string) => Promise<void>;
  logout: () => void;
  updateUserInfo: (data: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

/**
 * 用户状态 Provider
 * @param children - 子组件树
 */
export function UserProvider({ children }: { children: ReactNode }) {
  // 当前用户信息
  const [user, setUser] = useState<User | null>(null);
  // 初始化加载标志（应用启动时为 true，首次校验 token 后置 false）
  const [isLoading, setIsLoading] = useState(true);
  // Token 状态，初始值从 localStorage 读取
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  /**
   * 应用启动时校验登录状态
   * 依赖：[] - 仅在挂载时执行一次
   * 流程：
   *   1. 存在 token：调用 getCurrentUser 获取用户信息；失败则清除 token 并尝试 session_token 自动登录。
   *   2. 无 token：直接尝试 session_token 自动登录。
   *   3. 无论结果，最后将 isLoading 置 false。
   */
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      getCurrentUser().then((result) => {
        if (result.success && result.data) {
          setUser(result.data);
        } else {
          // token 无效：清除后尝试 session_token 自动登录
          localStorage.removeItem('token');
          autoLogin();
        }
        setIsLoading(false);
      }).catch(() => {
        localStorage.removeItem('token');
        autoLogin();
        setIsLoading(false);
      });
    } else {
      autoLogin();
      setIsLoading(false);
    }
  }, []);

  /**
   * 使用 session_token 自动登录（remember 模式）
   * @description 通过 refresh 接口换取新的 token 与用户信息；失败则清除 session_token
   */
  const autoLogin = useCallback(async () => {
    const sessionToken = localStorage.getItem('session_token');
    if (!sessionToken) return;

    try {
      const result = await refresh(sessionToken);
      if (result.success && result.data) {
        localStorage.setItem('token', result.data.token);
        setUser(result.data.user);
      } else {
        // session_token 失效：清除避免下次重复尝试
        localStorage.removeItem('session_token');
      }
    } catch {
      localStorage.removeItem('session_token');
    }
  }, []);

  /**
   * 持久化登录结果：写入 token / session_token 并更新用户状态，
   * 随后异步拉取完整用户资料（登录签发接口仅返回 id/email/username/avatar_url 基础字段）。
   */
  const persistAuth = useCallback((data: { user: User; token: string; session_token?: string }) => {
    localStorage.setItem('token', data.token);
    setToken(data.token);
    if (data.session_token) {
      localStorage.setItem('session_token', data.session_token);
    } else {
      localStorage.removeItem('session_token');
    }
    setUser(data.user);
    // 补全完整用户资料（bio / phone / custom_fields 等），失败静默不影响登录态
    getCurrentUser().then((res) => {
      if (res.success && res.data) setUser(res.data);
    }).catch(() => {});
  }, []);

  /**
   * 登录第一步：密码校验
   * @param identifier - 邮箱或手机号
   * @param password - 密码
   * @param turnstileToken - Turnstile 人机验证令牌
   * @returns LoginFlowResult（otp_required 时需继续 verifyLogin）
   * @throws 密码错误 / 验证拦截等失败时抛出 Error（携带 code）
   */
  const handleLogin = useCallback(async (identifier: string, password: string, turnstileToken?: string): Promise<LoginFlowResult> => {
    const result = await login(identifier, password, undefined, turnstileToken);
    if (result.success && result.data) {
      const data = result.data;
      // 两段式：密码通过，返回票据与可用通道，进入验证码确认段
      if ('otp_required' in data && data.otp_required) {
        return { status: 'otp_required', loginTicket: data.login_ticket, channels: data.channels };
      }
      // 直接签发（测试 bypass 场景）
      persistAuth(data as { user: User; token: string; session_token?: string });
      return { status: 'success' };
    }
    // 手机号未注册：不抛错，交由界面引导注册流程
    if (result.code === 'PHONE_NOT_REGISTERED') {
      return { status: 'phone_not_registered', message: result.message || '该手机号未注册，继续登录将注册新账号' };
    }
    const err = new Error(result.message || '登录失败') as Error & { code?: string };
    err.code = result.code;
    throw err;
  }, [persistAuth]);

  /**
   * 登录第二步：验证码确认
   * @param loginTicket - 登录第一步返回的票据
   * @param channel - 验证通道（email / phone）
   * @param code - 6 位数字验证码
   * @throws 验证码错误 / 票据失效等失败时抛出 Error（携带 code）
   */
  const handleVerifyLogin = useCallback(async (loginTicket: string, channel: 'email' | 'phone', code: string) => {
    const result = await verifyLogin(loginTicket, channel, code);
    if (result.success && result.data) {
      persistAuth(result.data);
      return;
    }
    const err = new Error(result.message || '登录失败') as Error & { code?: string };
    err.code = result.code;
    throw err;
  }, [persistAuth]);

  /**
   * 注册（V1.11.0 验证码注册，注册成功即完成登录）
   * @param identifier - 邮箱或手机号
   * @param password - 密码
   * @param username - 用户名（可选）
   * @param code - 6 位数字验证码
   * @param turnstileToken - Turnstile 人机验证令牌
   * @throws 注册失败时抛出 Error（携带 code）
   */
  const handleRegister = useCallback(async (identifier: string, password: string, username: string | undefined, code: string, turnstileToken?: string) => {
    const result = await register(identifier, password, username, code, turnstileToken);
    if (result.success && result.data) {
      // 注册成功视同登录：直接持久化 token 与会话
      persistAuth(result.data);
      return;
    }
    const err = new Error(result.message || '注册失败') as Error & { code?: string };
    err.code = result.code;
    throw err;
  }, [persistAuth]);

  /**
   * 退出登录：清除 token / session_token 与用户状态
   */
  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('session_token');
    setToken(null);
    setUser(null);
  }, []);

  /**
   * 更新用户信息
   * @param data - 需要更新的字段
   * @throws 更新失败时抛出 Error
   */
  const handleUpdateUserInfo = useCallback(async (data: Partial<User>) => {
    const result = await updateUser(data);
    if (result.success && result.data) {
      setUser(result.data);
    } else {
      throw new Error(result.message || '更新用户信息失败');
    }
  }, []);

  /**
   * 重新拉取当前用户信息（用于头像、资料变更后刷新）
   */
  const handleRefreshUser = useCallback(async () => {
    const result = await getCurrentUser();
    if (result.success && result.data) {
      setUser(result.data);
    }
  }, []);

  return (
    <UserContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login: handleLogin,
        verifyLogin: handleVerifyLogin,
        register: handleRegister,
        logout: handleLogout,
        updateUserInfo: handleUpdateUserInfo,
        refreshUser: handleRefreshUser,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

/**
 * 用户上下文 Hook
 * @returns UserContextType
 * @throws 必须在 UserProvider 内使用，否则抛错
 */
export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
}