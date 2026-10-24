/**
 * @file CommentItem.tsx（V3.0.0）
 * @description 单条评论的展示组件：头像、作者、相对时间、正文（L3 互回带"回复 @用户"）、
 *              点赞按钮、回复按钮、删除按钮。
 *              纯受控：所有操作经回调上抛，是否可删由父层计算，任意主题可复用。
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommentDTO } from '../../../api/comments';
import { formatRelativeDate } from '../../../shared/utils';
import { useIsMobile } from '../../../shared/useIsMobile';
import { Heart, MoreHorizontal, Reply, Trash2 } from 'lucide-react';

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

/** 头像：取作者名首字符的圆形色块 */
function Avatar({ author }: { author: string }) {
  const initial = (author || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-800">
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
  const isMobile = useIsMobile();
  // 移动端「…」操作菜单开关与容器引用（点击外部/Escape 关闭）
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Avatar author={comment.author} />
        {/* V4.1.0：作者名可点击跳转公开主页（历史迁移评论 user_id 为空时保持纯文本） */}
        {comment.user_id ? (
          <Link
            to={`/users/${comment.user_id}`}
            className="truncate text-sm font-medium text-gray-900 transition-colors hover:text-blue-700 hover:underline"
          >
            {comment.author}
          </Link>
        ) : (
          <span className="truncate text-sm font-medium text-gray-900">
            {comment.author}
          </span>
        )}
        <span className="flex-shrink-0 text-xs text-gray-400">
          {formatRelativeDate(comment.created_at)}
        </span>
      </div>

      <div className="mt-2 pl-10 text-sm leading-relaxed text-gray-700">
        {/* L3 平铺互回：前缀"回复 @用户"，永不出现第四级 */}
        {comment.depth === 3 && comment.reply_to_user_name && (
          <span className="mr-1 text-blue-700">
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
          className={`inline-flex items-center gap-1 transition-colors max-md:min-h-[44px] ${
            liked ? 'text-red-500' : 'text-gray-500 hover:text-red-500'
          }`}
        >
          <Heart
            className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`}
          />
          <span>{comment.like_count}</span>
        </button>

        {/* 桌面端：回复/删除内联按钮（保持原交互不变） */}
        {!isMobile && replyable && (
          <button
            type="button"
            onClick={() => onReply?.(comment)}
            className="inline-flex items-center gap-1 text-gray-500 transition-colors hover:text-blue-700"
          >
            <Reply className="h-3.5 w-3.5" />
            回复
          </button>
        )}

        {!isMobile && canDelete && (
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

        {/* 移动端：回复/删除收进右侧「…」菜单（触发热区 44×44，菜单项高度 ≥44px） */}
        {isMobile && (replyable || canDelete) && (
          <div ref={menuRef} className="relative ml-auto">
            <button
              type="button"
              aria-label="更多操作"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                {replyable && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onReply?.(comment);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Reply className="h-4 w-4" />
                    回复
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete?.(comment.id);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
