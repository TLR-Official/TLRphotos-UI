/**
 * @file useKeyboardShortcuts - 快捷键处理 hook
 * @description
 *  监听 keydown 事件，匹配单字母快捷键触发对应 handler。
 *  在输入框/文本域聚焦时自动禁用，避免误触。
 */

import { useEffect } from 'react';

export interface KeyboardShortcutConfig {
  /** 快捷键 → 回调函数映射，键为小写字母 */
  [key: string]: () => void;
}

/**
 * 注册快捷键监听
 * @param config 快捷键配置：{ 'h': () => toggleHistogram(), ... }
 * @param enabled 是否启用（false 时移除监听）
 */
export function useKeyboardShortcuts(config: KeyboardShortcutConfig, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // 输入框/文本域聚焦时跳过，避免与用户输入冲突
      const target = e.target as HTMLElement;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
          return;
        }
      }

      // 修饰键（Ctrl/Meta/Alt）组合时跳过，避免与浏览器/系统快捷键冲突
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const handlerFn = config[key];

      if (handlerFn) {
        e.preventDefault();
        handlerFn();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [config, enabled]);
}
