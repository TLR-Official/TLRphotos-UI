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
import { login, register, getCurrentUser, updateUser, refresh } from '../api/auth';
import type { User } from '../api/auth';

/**
 * 用户上下文类型
 */
interface UserContextType {
  user: User | null;                                              // 当前用户信息
  token: string | null;                                           // 当前 Token
  isAuthenticated: boolean;                                       // 是否已认证（user 是否存在）
  isLoading: boolean;                                             // 初始化加载中
  login: (email: string, password: string, remember?: boolean, turnstileToken?: string) => Promise<void>;
  register: (email: string, password: string, username?: string, turnstileToken?: string) => Promise<void>;
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
   * 登录
   * @param email - 邮箱
   * @param password - 密码
   * @param remember - 是否启用长期会话（保存 session_token）
   * @throws 登录失败时抛出 Error，由调用方处理
   */
  const handleLogin = useCallback(async (email: string, password: string, remember?: boolean, turnstileToken?: string) => {
    const result = await login(email, password, remember, turnstileToken);
    if (result.success && result.data) {
      localStorage.setItem('token', result.data.token);
      setToken(result.data.token);
      // remember 模式：持久化 session_token；否则清除已有的 session_token
      if (result.data.session_token) {
        localStorage.setItem('session_token', result.data.session_token);
      } else {
        localStorage.removeItem('session_token');
      }
      setUser(result.data.user);
    } else {
      throw new Error(result.message || '登录失败');
    }
  }, []);

  /**
   * 注册
   * @param email - 邮箱
   * @param password - 密码
   * @param username - 用户名（可选）
   * @throws 注册失败时抛出 Error
   */
  const handleRegister = useCallback(async (email: string, password: string, username?: string, turnstileToken?: string) => {
    const result = await register(email, password, username, turnstileToken);
    if (!result.success) {
      throw new Error(result.message || '注册失败');
    }
  }, []);

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