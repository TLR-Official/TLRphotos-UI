/**
 * @file CommentThread.tsx（V3.0.0）
 * @description 单条 L1 线程组件：楼主评论 + 回复树（L2/L3 按 parent_id 嵌套渲染，
 *              L3 互回平铺不出现第四级），单楼回复二次加载按钮。
 *              回复输入盒的展示位置在本组件内管理；数据动作全部经回调上抛，主题无关。
 */
import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  type CommentDTO,
  type RootCommentSummaryDTO,
} from '../../../api/comments';
import { buildCommentTree, type TreeNode } from '../../../utils/commentTree';
import { useIsMobile } from '../../../shared/useIsMobile';
import { CommentItem } from './CommentItem';
import { CommentReplyBox } from './CommentReplyBox';

export interface CommentThreadProps {
  thread: RootCommentSummaryDTO;
  currentUserId?: string | null;
  isAdmin?: boolean;
  busy?: boolean;
  onToggleLike: (comment: CommentDTO) => void | Promise<void>;
  onSubmitReply: (params: {
    parentId: string;
    rootId?: string;
    content: string;
  }) => Promise<{ success: boolean; message?: string }>;
  onDelete: (
    commentId: string
  ) => Promise<{ success: boolean; message?: string }> | void;
  onLoadMore: (rootId: string) => Promise<{ success: boolean; message?: string }>;
}

export function CommentThread({
  thread,
  currentUserId,
  isAdmin = false,
  busy = false,
  onToggleLike,
  onSubmitReply,
  onDelete,
  onLoadMore,
}: CommentThreadProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const isMobile = useIsMobile();

  const canDeleteOf = (comment: CommentDTO) =>
    isAdmin || (comment.user_id !== null && comment.user_id === currentUserId);

  const renderNode = (node: TreeNode<CommentDTO>) => {
    // 移动端三级平铺：depth≥2 节点的子节点（即 L3）不再追加缩进，与父级同层展示，
    // 互回语境由 CommentItem 的"回复 @用户"前缀表达；桌面端保持原嵌套结构。
    const flattenChildren = isMobile && (node.depth ?? 1) >= 2;
    return (
      <div key={node.id} className="min-w-0">
        <CommentItem
          comment={node}
          currentUserId={currentUserId}
          canDelete={canDeleteOf(node)}
          onToggleLike={onToggleLike}
          onReply={(c) => setReplyingTo(c.id)}
          onDelete={onDelete}
        />
        {replyingTo === node.id && (
          <div className="ml-6 mt-2">
            <CommentReplyBox
              targetAuthor={node.author}
              onSubmit={(content) =>
                onSubmitReply({ parentId: node.id, rootId: thread.id, content })
              }
              onCancel={() => setReplyingTo(null)}
            />
          </div>
        )}
        {node.children.length > 0 &&
          (flattenChildren ? (
            <div className="mt-3 space-y-4">{node.children.map(renderNode)}</div>
          ) : (
            // 移动端每级缩进 12px（ml-3），桌面端维持 ml-6
            <div className="ml-3 mt-3 space-y-4 border-l border-gray-100 pl-3 md:ml-6 md:pl-4">
              {node.children.map(renderNode)}
            </div>
          ))}
      </div>
    );
  };

  const replyRoots = buildCommentTree(thread.replies, { depthOf: (r) => r.depth });

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await onLoadMore(thread.id);
    setLoadingMore(false);
  };

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
      <CommentItem
        comment={thread}
        currentUserId={currentUserId}
        canDelete={canDeleteOf(thread)}
        onToggleLike={onToggleLike}
        onReply={(c) => setReplyingTo(c.id)}
        onDelete={onDelete}
      />
      {replyingTo === thread.id && (
        <div className="ml-6 mt-2">
          <CommentReplyBox
            targetAuthor={thread.author}
            onSubmit={(content) =>
              onSubmitReply({ parentId: thread.id, rootId: thread.id, content })
            }
            onCancel={() => setReplyingTo(null)}
          />
        </div>
      )}

      {replyRoots.length > 0 && (
        // 移动端 L2 缩进 12px（ml-3），桌面端维持 ml-6
        <div className="ml-3 mt-4 space-y-5 border-l border-gray-100 pl-3 md:ml-6 md:pl-4">
          {replyRoots.map(renderNode)}
        </div>
      )}

      {thread.has_more_replies && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore || busy}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-50 disabled:opacity-50"
        >
          {loadingMore ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          查看全部 {thread.total_reply_count} 条回复
        </button>
      )}
    </article>
  );
}
