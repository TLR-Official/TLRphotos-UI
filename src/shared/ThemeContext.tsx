/**
 * @file 主题上下文
 * @description
 *  全局主题（明/暗）状态管理。
 *  核心功能：
 *   1. 维护当前主题（默认 light）。
 *   2. 通过 document.documentElement 的 class 切换主题样式。
 *  注意：当前实现仅锁定 light 主题，预留 ThemeContext 以便后续扩展动态切换。
 */

import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

/** 主题类型 */
type Theme = 'dark' | 'light';

/** 主题上下文类型 */
interface ThemeContextType {
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * 主题状态 Provider
 * @param children - 子组件树
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // 当前主题（默认 light，后续可扩展为可切换状态）
  const [theme] = useState<Theme>('light');

  /**
   * 同步主题到 documentElement 的 class，供 Tailwind dark: 变体识别
   * 依赖：[theme] - 主题变化时重新应用
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    root.classList.add('light');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 主题上下文 Hook
 * @returns ThemeContextType
 * @throws 必须在 ThemeProvider 内使用，否则抛错
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
