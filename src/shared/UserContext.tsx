import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { login, register, getCurrentUser } from '../api/auth';
import type { User } from '../api/auth';

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username?: string) => Promise<void>;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      getCurrentUser().then((result) => {
        if (result.success && result.data) {
          setUser(result.data);
        } else {
          localStorage.removeItem('token');
        }
        setIsLoading(false);
      }).catch(() => {
        localStorage.removeItem('token');
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleLogin = useCallback(async (email: string, password: string) => {
    const result = await login(email, password);
    if (result.success && result.data) {
      localStorage.setItem('token', result.data.token);
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
    setUser(null);
  }, []);

  return (
    <UserContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login: handleLogin,
        register: handleRegister,
        logout: handleLogout,
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