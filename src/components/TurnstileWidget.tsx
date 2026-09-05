/**
 * @file Cloudflare Turnstile 人机验证组件（V1.8.0）
 * @description
 *  显式渲染模式挂载 Turnstile widget：
 *   - 挂载后加载官方脚本并渲染挑战组件，挑战通过回调 onSuccess(token)。
 *   - Turnstile 令牌为一次性：每次提交后必须调用 ref.reset() 重置才能重新挑战。
 *   - sitekey 为公开 key，优先取 .env 的 VITE_TURNSTILE_SITE_KEY，未配置时回退内置站点 key。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/** Turnstile sitekey（公开 key，可经 VITE_TURNSTILE_SITE_KEY 覆盖） */
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAEjANyXSjJckEyBI';
/** Turnstile 官方脚本地址 */
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** Turnstile 全局对象最小类型声明 */
interface TurnstileApi {
  render: (el: HTMLElement, params: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// 脚本加载 Promise 缓存：保证全站仅注入一次
let scriptPromise: Promise<void> | null = null;

/**
 * 加载 Turnstile 官方脚本（幂等）
 * @returns 脚本就绪后 resolve；加载失败 reject
 */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // 加载失败允许后续重试
      scriptPromise = null;
      script.remove();
      reject(new Error('人机验证脚本加载失败'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** 对外暴露的组件实例方法 */
export interface TurnstileWidgetHandle {
  /** 重置挑战（令牌一次性，每次提交后必须重置） */
  reset: () => void;
}

interface TurnstileWidgetProps {
  /** 与后端约定的操作类型（siteverify action 校验） */
  action: string;
  /** 挑战通过回调（携带一次性令牌） */
  onSuccess: (token: string) => void;
  /** 挑战出错回调 */
  onError?: (message: string) => void;
  /** 令牌过期回调（未提交即过期） */
  onExpire?: () => void;
  /** widget 主题，跟随页面明暗 */
  theme?: 'light' | 'dark' | 'auto';
  /** 容器附加样式 */
  className?: string;
}

/**
 * Turnstile 人机验证组件
 * 通过 forwardRef 暴露 reset()，供调用方在每次提交后重置挑战。
 */
export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ action, onSuccess, onError, onExpire, theme = 'auto', className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);

    // 回调经 ref 中转，避免父组件重渲染导致 widget 重建
    const callbacksRef = useRef({ onSuccess, onError, onExpire });
    callbacksRef.current = { onSuccess, onError, onExpire };

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            // 重置失败静默处理，异常由 error-callback 兜底
          }
        }
      },
    }));

    useEffect(() => {
      let cancelled = false;

      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          if (widgetIdRef.current) return; // StrictMode 双挂载保护
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            action,
            theme,
            retry: 'never',
            callback: (token: string) => callbacksRef.current.onSuccess(token),
            'error-callback': () => callbacksRef.current.onError?.('人机验证加载异常，请刷新页面重试'),
            'expired-callback': () => callbacksRef.current.onExpire?.(),
          });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            callbacksRef.current.onError?.(err instanceof Error ? err.message : '人机验证加载失败');
          }
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // 卸载异常忽略
          }
          widgetIdRef.current = null;
        }
      };
    }, [action, theme]);

    return <div ref={containerRef} className={className} />;
  }
);
