/**
 * @file 人机验证门 Hook（V1.8.0）
 * @description
 *  将高危操作包裹为可自动通过人机验证门的调用：
 *   1. guard(action, op) 首次执行 op；响应携带 code=HUMAN_VERIFICATION_REQUIRED 时
 *      记录重试回调并弹出验证弹窗。
 *   2. 用户完成挑战后自动重试 op 一次并返回其结果；用户关闭弹窗则返回首次拦截响应。
 *  使用方需将返回的 modal 渲染到组件树中。
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { HumanVerificationModal } from '../components/HumanVerificationModal';
import { isVerificationRequired, type VerificationAction } from '../api/verification';

/** 可进入验证门的响应结构（request 客户端与原生 fetch 响应均满足） */
interface GateableResponse {
  success: boolean;
  code?: string;
  message?: string;
}

/** 弹窗自定义文案与自定义提交函数（管理后台传入 admin 版提交接口） */
export interface VerificationGateOptions {
  title?: string;
  description?: string;
  submitFn?: (token: string) => Promise<{ success: boolean; message?: string }>;
}

/**
 * 人机验证门 Hook
 * @param options 弹窗文案与自定义提交函数（可选）
 * @returns guard 包裹函数与需渲染的 modal
 */
export function useHumanVerification(options?: VerificationGateOptions) {
  const [gate, setGate] = useState<{ open: boolean; action: VerificationAction }>({
    open: false,
    action: 'photo_upload',
  });

  // 重试与"未验证关闭"回调（guard 执行期间赋值）
  const retryRef = useRef<(() => void) | null>(null);
  const dismissRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** 用户主动关闭弹窗：视为放弃重试，返回首次拦截响应 */
  const closeGate = useCallback(() => {
    setGate((g) => ({ ...g, open: false }));
    dismissRef.current?.();
  }, []);

  /**
   * 包裹高危操作
   * @param action 当前操作对应的验证 action
   * @param op 原操作执行函数（返回携带 success/code 的响应）
   * @returns 未被拦截时返回 op 的响应；被拦截且完成验证后返回重试响应；
   *          被拦截且用户关闭弹窗时返回首次拦截响应（success=false）
   */
  const guard = useCallback(async <T extends GateableResponse>(
    action: VerificationAction,
    op: () => Promise<T>
  ): Promise<T> => {
    const first = await op();
    if (!isVerificationRequired(first)) return first;

    return new Promise<T>((resolve) => {
      let enteredRetry = false; // 是否已进入重试流程（此后 dismiss 不再 settle）
      retryRef.current = () => {
        enteredRetry = true;
        setGate((g) => ({ ...g, open: false }));
        op().then(resolve).catch(() => resolve({ success: false, message: '操作失败，请重试' } as unknown as T));
      };
      dismissRef.current = () => {
        if (enteredRetry) return;
        resolve(first);
      };
      setGate({ open: true, action });
    });
  }, []);

  /** 需渲染到组件树的验证弹窗 */
  const modal: ReactNode = (
    <HumanVerificationModal
      open={gate.open}
      action={gate.action}
      onVerified={() => retryRef.current?.()}
      onClose={closeGate}
      title={optionsRef.current?.title}
      description={optionsRef.current?.description}
      submitFn={optionsRef.current?.submitFn}
    />
  );

  return { guard, modal, gateOpen: gate.open };
}
