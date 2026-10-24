/**
 * @file 移动端能力探测 Hook
 * @description
 *  提供响应式断点与触屏能力探测，用于移动端路由分流与交互适配。
 *  - useIsMobile：基于 768px 媒体查询断点，监听窗口变化实时更新
 *  - useIsTouch：基于 ontouchstart / pointer:coarse 探测触屏能力
 */
import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 768px)';

/**
 * 订阅媒体查询变化
 * @param query - CSS 媒体查询字符串
 * @param onChange - 变化回调
 * @returns 取消订阅函数
 */
function subscribeMediaQuery(query: string, onChange: () => void): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * 判断当前视口是否为移动端（宽度 ≤ 768px）
 * @description 初始值在渲染期同步读取，resize/横竖屏切换时自动更新
 * @returns 是否为移动端断点
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMediaQuery(MOBILE_QUERY, onChange),
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/**
 * 判断当前设备是否为触屏设备
 * @description 组合 ontouchstart 与 pointer:coarse 双通道探测，触屏笔记本亦覆盖
 * @returns 是否具备触屏能力
 */
export function useIsTouch(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMediaQuery('(pointer: coarse)', onChange),
    () => 'ontouchstart' in window || window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );
}
