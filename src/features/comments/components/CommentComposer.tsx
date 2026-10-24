/**
 * @file CommentComposer.tsx（V3.0.0）
 * @description 顶层 L1 主评论发布器：textarea + 字数统计（≤1000）+ 发布按钮。
 *              纯展示与本地输入态，发布动作经 onPublish 上抛，可在任意主题复用。
 */
import { useState, type FormEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { useIsMobile } from '../../../shared/useIsMobile';

const MAX_LENGTH = 1000;

export interface CommentComposerProps {
  /** 发布回调；返回成功标记以决定是否清空输入 */
  onPublish: (content: string) => Promise<{ success: boolean; message?: string }>;
  placeholder?: string;
  /** 未登录时展示登录引导 */
  isAuthenticated?: boolean;
  onLogin?: () => void;
}

export function CommentComposer({
  onPublish,
  placeholder = '友善评论，理性交流…',
  isAuthenticated = true,
  onLogin,
}: CommentComposerProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const isMobile = useIsMobile();

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-5 text-center text-sm text-gray-500">
        <button
          type="button"
          onClick={onLogin}
          className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
        >
          登录
        </button>
        后参与评论
      </div>
    );
  }

  const trimmed = content.trim();
  const remaining = MAX_LENGTH - content.length;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setMessage('');
    const result = await onPublish(trimmed);
    if (result.success) {
      setContent('');
    } else {
      setMessage(result.message || '发布失败，请重试');
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value.slice(0, MAX_LENGTH))}
        onFocus={(event) => {
          // 移动端：等待虚拟键盘弹出后滚动到视口中央，避免输入框被键盘遮挡
          if (isMobile) {
            const el = event.target;
            setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
          }
        }}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${remaining < 50 ? 'text-amber-600' : 'text-gray-400'}`}
        >
          {remaining}
        </span>
        <button
          type="submit"
          disabled={!trimmed || submitting}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            !trimmed || submitting
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : 'bg-blue-700 text-white hover:bg-blue-800 active:scale-95'
          }`}
        >
          <SendHorizontal className="h-4 w-4" />
          {submitting ? '发布中…' : '发表评论'}
        </button>
      </div>
      {message && <p className="text-xs text-red-500">{message}</p>}
    </form>
  );
}
