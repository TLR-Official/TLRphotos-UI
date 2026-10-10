/**
 * @file CommentReplyBox.tsx（V3.0.0）
 * @description 内联回复输入盒：显示"回复 @用户"，自动聚焦，提交/取消。
 *              与具体主题解耦，提交动作经 onSubmit 上抛。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CornerDownLeft, X } from 'lucide-react';

export interface CommentReplyBoxProps {
  /** 被回复者展示名 */
  targetAuthor: string;
  onSubmit: (content: string) => Promise<{ success: boolean; message?: string }>;
  onCancel: () => void;
}

export function CommentReplyBox({
  targetAuthor,
  onSubmit,
  onCancel,
}: CommentReplyBoxProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trimmed = content.trim();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setMessage('');
    const result = await onSubmit(trimmed);
    if (result.success) {
      setContent('');
      onCancel();
    } else {
      setMessage(result.message || '回复失败，请重试');
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      <p className="text-xs text-gray-500">
        回复 <span className="font-medium text-teal-700">@{targetAuthor}</span>
      </p>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => setContent(event.target.value.slice(0, 1000))}
        rows={2}
        placeholder="写下你的回复…"
        className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!trimmed || submitting}
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
            !trimmed || submitting
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : 'bg-teal-600 text-white hover:bg-teal-700 active:scale-95'
          }`}
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
          {submitting ? '发送中…' : '回复'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" />
          取消
        </button>
      </div>
      {message && <p className="text-xs text-red-500">{message}</p>}
    </form>
  );
}
