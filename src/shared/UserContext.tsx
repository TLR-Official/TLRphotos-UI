import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { login, register, getCurrentUser, updateUser, refresh } from '../api/auth';
import type { User } from '../api/auth';

interface UserContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  register: (email: string, password: string, username?: string) => Promise<void>;
  logout: () => void;
  updateUserInfo: (data: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      getCurrentUser().then((result) => {
        if (result.success && result.data) {
          setUser(result.data);
        } else {
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

  const autoLogin = useCallback(async () => {
    const sessionToken = localStorage.getItem('session_token');
    if (!sessionToken) return;

    try {
      const result = await refresh(sessionToken);
      if (result.success && result.data) {
        localStorage.setItem('token', result.data.token);
        setUser(result.data.user);
      } else {
        localStorage.removeItem('session_token');
      }
    } catch {
      localStorage.removeItem('session_token');
    }
  }, []);

  const handleLogin = useCallback(async (email: string, password: string, remember?: boolean) => {
    const result = await login(email, password, remember);
    if (result.success && result.data) {
      localStorage.setItem('token', result.data.token);
      setToken(result.data.token);
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

  const handleRegister = useCallback(async (email: string, password: string, username?: string) => {
    const result = await register(email, password, username);
    if (!result.success) {
      throw new Error(result.message || '注册失败');
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('session_token');
    setToken(null);
    setUser(null);
  }, []);

  const handleUpdateUserInfo = useCallback(async (data: Partial<User>) => {
    const result = await updateUser(data);
    if (result.success && result.data) {
      setUser(result.data);
    } else {
      throw new Error(result.message || '更新用户信息失败');
    }
  }, []);

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

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
}