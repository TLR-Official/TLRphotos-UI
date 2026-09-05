/**
 * @file 人机验证弹窗（验证门，V1.8.0）
 * @description
 *  高危操作被后端 403（code=HUMAN_VERIFICATION_REQUIRED）拦截后弹出：
 *  用户完成 Turnstile 挑战 → 自动提交验证接口建立 168h 验证状态 → 触发 onVerified
 *  由调用方关闭弹窗并重试原操作。挑战失败 / 令牌过期自动重置 widget 供再次挑战。
 */

import { useEffect, useRef, useState } from 'react';
import { TurnstileWidget, type TurnstileWidgetHandle } from './TurnstileWidget';
import { submitVerification, type VerificationAction } from '../api/verification';

/** 验证提交函数签名（默认用户侧实现；管理后台传入 admin 版本） */
type SubmitFn = (token: string) => Promise<{ success: boolean; message?: string }>;

interface HumanVerificationModalProps {
  open: boolean;                       // 是否显示弹窗
  action: VerificationAction;          // 当前高危操作对应的 action
  onVerified: () => void;              // 验证通过回调（调用方重试原操作）
  onClose: () => void;                 // 用户主动关闭
  title?: string;                      // 弹窗标题
  description?: string;                // 弹窗说明文案
  submitFn?: SubmitFn;                 // 自定义验证提交函数（默认用户侧 /verification/verify）
}

/**
 * 人机验证弹窗组件
 * 挑战通过即自动提交令牌；提交中禁止关闭，防止状态错乱。
 */
export function HumanVerificationModal({
  open,
  action,
  onVerified,
  onClose,
  title,
  description,
  submitFn,
}: HumanVerificationModalProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const widgetRef = useRef<TurnstileWidgetHandle>(null);
  const submittingRef = useRef(false);

  // 每次打开时重置内部状态
  useEffect(() => {
    if (open) {
      setError('');
      setSubmitting(false);
      submittingRef.current = false;
    }
  }, [open]);

  if (!open) return null;

  /**
   * 提交挑战令牌：成功 → onVerified（调用方关闭弹窗并重试原操作）；
   * 失败 → 提示错误并重置 widget 允许重新挑战。
   */
  const handleSubmit = async (token: string) => {
    if (!token || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');

    const result = submitFn ? await submitFn(token) : await submitVerification(action, token);

    if (result.success) {
      onVerified();
      return; // 调用方关闭弹窗；保持 submitting 防止重复提交
    }

    setError(result.message || '人机验证未通过，请重试');
    widgetRef.current?.reset();
    submittingRef.current = false;
    setSubmitting(false);
  };

  /** 用户主动关闭：提交中不允许关闭 */
  const handleClose = () => {
    if (submittingRef.current) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      {/* 验证卡片（白底黑字） */}
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{title || '安全验证'}</h3>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          {description || '该操作需完成人机验证。验证通过后 7 天内同一网络环境下无需重复验证。'}
        </p>

        {/* Turnstile 挑战区域：挑战通过自动提交 */}
        <div className="mb-2 flex min-h-[80px] items-center justify-center">
          <TurnstileWidget
            ref={widgetRef}
            action={action}
            theme="light"
            onSuccess={(token) => handleSubmit(token)}
            onExpire={() => setError('验证已过期，请重新完成验证')}
            onError={(msg) => setError(msg)}
          />
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {submitting && (
          <div className="flex items-center justify-center text-sm text-gray-500">
            <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            正在校验，请稍候...
          </div>
        )}
      </div>
    </div>
  );
}
