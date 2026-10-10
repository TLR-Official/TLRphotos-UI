/**
 * @file CommentItem.tsx（V3.0.0）
 * @description 单条评论的展示组件：头像、作者、相对时间、正文（L3 互回带"回复 @用户"）、
 *              点赞按钮、回复按钮、删除按钮。
 *              纯受控：所有操作经回调上抛，是否可删由父层计算，任意主题可复用。
 */
import type { CommentDTO } from '../../../api/comments';
import { formatRelativeDate } from '../../../shared/utils';
import { Heart, Reply, Trash2 } from 'lucide-react';

export interface CommentItemProps {
  comment: CommentDTO;
  /** 当前登录用户 id（用于本人删除按钮） */
  currentUserId?: string | null;
  /** 允许删除（本人或管理员） */
  canDelete?: boolean;
  /** 是否显示回复按钮（归档只读视图可关闭） */
  replyable?: boolean;
  onToggleLike?: (comment: CommentDTO) => void | Promise<void>;
  onReply?: (comment: CommentDTO) => void;
  onDelete?: (
    commentId: string
  ) => Promise<{ success: boolean; message?: string }> | void;
}

/** 头像：取作者名首字符的 teal 圆 */
function Avatar({ author }: { author: string }) {
  const initial = (author || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
      {initial}
    </div>
  );
}

export function CommentItem({
  comment,
  canDelete = false,
  replyable = true,
  onToggleLike,
  onReply,
  onDelete,
}: CommentItemProps) {
  const liked = comment.is_liked === true;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Avatar author={comment.author} />
        <span className="truncate text-sm font-medium text-gray-900">
          {comment.author}
        </span>
        <span className="flex-shrink-0 text-xs text-gray-400">
          {formatRelativeDate(comment.created_at)}
        </span>
      </div>

      <div className="mt-2 pl-10 text-sm leading-relaxed text-gray-700">
        {/* L3 平铺互回：前缀"回复 @用户"，永不出现第四级 */}
        {comment.depth === 3 && comment.reply_to_user_name && (
          <span className="mr-1 text-teal-600">
            回复 @{comment.reply_to_user_name}：
          </span>
        )}
        <span className="whitespace-pre-wrap break-words">{comment.content}</span>
      </div>

      <div className="mt-2 flex items-center gap-4 pl-8 text-xs">
        <button
          type="button"
          onClick={() => onToggleLike?.(comment)}
          aria-label={liked ? '取消点赞' : '点赞'}
          className={`inline-flex items-center gap-1 transition-colors ${
            liked ? 'text-red-500' : 'text-gray-500 hover:text-red-500'
          }`}
        >
          <Heart
            className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`}
          />
          <span>{comment.like_count}</span>
        </button>

        {replyable && (
          <button
            type="button"
            onClick={() => onReply?.(comment)}
            className="inline-flex items-center gap-1 text-gray-500 transition-colors hover:text-teal-600"
          >
            <Reply className="h-3.5 w-3.5" />
            回复
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete?.(comment.id)}
            aria-label="删除评论"
            className="inline-flex items-center gap-1 text-gray-500 transition-colors hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        )}
      </div>
    </div>
  );
}
