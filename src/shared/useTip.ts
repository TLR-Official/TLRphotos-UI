/**
 * @file 新手引导提示 Hook
 * @description
 *  基于 localStorage 计数的功能提示显示控制：
 *  - key 对应 localStorage 键 `tip_${key}`，存储已关闭次数
 *  - 关闭次数达到 maxShows 后不再显示
 *  - localStorage 异常（隐私模式/配额）时静默降级为不显示，不阻断主流程
 */
import { useCallback, useState } from 'react';

/** localStorage 键前缀 */
const TIP_PREFIX = 'tip_';

/** 读取已关闭次数；异常或非法值按 0 处理 */
function readCount(storageKey: string): number {
  try {
    const raw = localStorage.getItem(storageKey);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * 功能提示可见性控制
 * @param key - 提示标识（localStorage 键为 `tip_${key}`）
 * @param maxShows - 最大显示次数，默认 3 次
 * @returns visible 当前是否应显示；dismiss 关闭并累计次数
 */
export function useTip(key: string, maxShows = 3): { visible: boolean; dismiss: () => void } {
  const storageKey = `${TIP_PREFIX}${key}`;
  const [visible, setVisible] = useState<boolean>(() => readCount(storageKey) < maxShows);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(storageKey, String(readCount(storageKey) + 1));
    } catch {
      // 存储不可用时仅本次会话隐藏
    }
  }, [storageKey]);

  return { visible, dismiss };
}

/** useTip 别名（语义化命名） */
export const useTipVisible = useTip;
