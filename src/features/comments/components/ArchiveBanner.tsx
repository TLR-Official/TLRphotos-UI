/**
 * @file ArchiveBanner.tsx（V3.0.0）
 * @description 归档线程提示条：说明该线程已超期迁移至云存储，可展开经签名 URL 直读
 *              （IndexedDB 缓存优先）；在归档视图中回复时由后端回迁线程，随后刷新列表，
 *              线程以活跃状态回到本地。管理员可直接删除归档线程。
 */
import { useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react';
import {
  type ArchivedThreadIndexDTO,
  type CommentDTO,
} from '../../../api/comments';
import { useArchivedThread } from '../useArchivedThread';
import { buildCommentTree, type TreeNode } from '../../../utils/commentTree';
import { CommentItem } from './CommentItem';
import { CommentReplyBox } from './CommentReplyBox';

export interface ArchiveBannerProps {
  archive: ArchivedThreadIndexDTO;
  currentUserId?: string | null;
  isAdmin?: boolean;
  /** 回复归档线程（后端自动回迁） */
  onReply: (params: {
    parentId: string;
    rootId: string;
    content: string;
  }) => Promise<{ success: boolean; message?: string }>;
  /** 回复成功后刷新列表，展示已回迁线程 */
  onAfterRehydrate: () => Promise<void>;
  onDelete: (rootId: string) => Promise<{ success: boolean; message?: string }>;
}

export function ArchiveBanner({
  archive,
  currentUserId,
  isAdmin = false,
  onReply,
  onAfterRehydrate,
  onDelete,
}: ArchiveBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const { state, payload, error, open } = useArchivedThread();

  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && state !== 'ready') {
      await open(archive.root_id);
    }
  };

  const handleReplySubmit = async (parentId: string, content: string) => {
    const result = await onReply({ parentId, rootId: archive.root_id, content });
    if (result.success) {
      setReplyingTo(null);
      setExpanded(false);
      await onAfterRehydrate();
    }
    return result;
  };

  const renderNode = (node: TreeNode<CommentDTO>) => (
    <div key={node.id} className="min-w-0">
      <CommentItem
        comment={node}
        currentUserId={currentUserId}
        canDelete={false}
        onReply={(c) => setReplyingTo(c.id)}
      />
      {replyingTo === node.id && (
        <div className="ml-6 mt-2">
          <CommentReplyBox
            targetAuthor={node.author}
            onSubmit={(content) => handleReplySubmit(node.id, content)}
            onCancel={() => setReplyingTo(null)}
          />
        </div>
      )}
      {node.children.length > 0 && (
        <div className="ml-4 mt-3 space-y-4 border-l border-blue-100 pl-3 md:ml-6 md:pl-4">
          {node.children.map(renderNode)}
        </div>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Archive className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-700" />
          <div>
            <p className="text-sm font-medium text-blue-900">
              该评论线程已归档（{archive.reply_count + 1} 条）
            </p>
            <p className="mt-0.5 text-xs text-blue-800/80">
              超过本地留存周期，已迁移至云存储；回复时将自动回迁本地
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {isAdmin && (
            <button
              type="button"
              aria-label="删除归档线程"
              onClick={() => onDelete(archive.root_id)}
              className="rounded-md p-1.5 text-blue-800 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleExpand}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100"
          >
            {expanded ? (
              <>
                收起 <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                查看归档 <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-white p-4">
          {state === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取归档评论…
            </div>
          )}
          {state === 'error' && (
            <div className="py-6 text-center">
              <p className="text-xs text-red-500">{error || '读取失败'}</p>
              <button
                type="button"
                onClick={() => open(archive.root_id, true)}
                className="mt-2 text-xs font-medium text-blue-700 hover:underline"
              >
                重试
              </button>
            </div>
          )}
          {state === 'ready' && payload && (() => {
            const rootComment = payload.comments.find((c) => c.depth === 1);
            if (!rootComment) {
              return (
                <p className="py-4 text-center text-xs text-red-500">
                  归档内容校验失败：缺少主评论
                </p>
              );
            }
            const replyTree = buildCommentTree(
              payload.comments.filter((c) => c.depth > 1),
              { depthOf: (r) => r.depth }
            );
            return (
            <div className="space-y-5">
              {/* L1 */}
              <div>
                <CommentItem
                  comment={rootComment}
                  currentUserId={currentUserId}
                  canDelete={false}
                  onReply={(c) => setReplyingTo(c.id)}
                />
                {replyingTo === payload.root.id && (
                  <div className="ml-6 mt-2">
                    <CommentReplyBox
                      targetAuthor={rootComment.author}
                      onSubmit={(content) =>
                        handleReplySubmit(payload.root.id, content)
                      }
                      onCancel={() => setReplyingTo(null)}
                    />
                  </div>
                )}
              </div>
              {/* L2/L3 树 */}
              {replyTree.length > 0 && (
                <div className="ml-4 space-y-5 border-l border-blue-100 pl-3 md:ml-6 md:pl-4">
                  {replyTree.map(renderNode)}
                </div>
              )}
            </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
