import type { ReactNode } from 'react';
import { useTheme } from './ThemeContext';

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