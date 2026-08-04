/**
 * 底部栏
 * 居中展示版权信息，根据主题切换玻璃质感样式。
 */
import type { ReactNode } from 'react';
import { useTheme } from './ThemeContext';

/**
 * 底部栏组件
 * @returns 底部栏 JSX
 */
export function Footer(): ReactNode {
  const { theme } = useTheme();

  return (
    <footer className={`py-6 text-center text-sm theme-bg-transition ${
      theme === 'dark' ? 'glass text-slate-400' : 'glass-light text-slate-500'
    }`}>
      <p>&copy; 2026 TLRphotos 航空摄影工作室</p>
    </footer>
  );
}