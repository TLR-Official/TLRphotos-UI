/**
 * @file useComments.tsx（V3.0.0）
 * @description 通用评论统一状态 Hook（主题参数化）：
 *              L1 分页加载/排序、发表 L1、回复（含归档线程后端自动回迁）、
 *              点赞（乐观更新+失败回滚）、删除（本人，人机验证门）、单楼回复二次加载。
 *              全部操作返回成功标记与消息，组件层仅做交互编排，可被照片页/文章页/
 *              论坛帖子页零改动复用。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  fetchComments,
  publishComment,
  fetchThreadReplies,
  setCommentLikeApi,
  removeCommentApi,
  type CommentSubject,
  type CommentDTO,
  type RootCommentListDTO,
  type ThreadReplyDTO,
} from '../../api/comments';
import { useHumanVerification } from '../../shared/useHumanVerification';

export interface ActionResult {
  success: boolean;
  message?: string;
}

export interface UseCommentsOptions {
  /** 初始排序 */
  initialSort?: 'latest' | 'hottest';
  pageSize?: number;
}

export interface UseCommentsResult {
  data: RootCommentListDTO | null;
  isLoading: boolean;
  error: string;
  sort: 'latest' | 'hottest';
  page: number;
  setSort: (sort: 'latest' | 'hottest') => void;
  setPage: (page: number) => void;
  refresh: () => Promise<void>;
  publishTopLevel: (content: string) => Promise<ActionResult>;
  replyTo: (params: {
    parentId: string;
    rootId?: string;
    content: string;
  }) => Promise<ActionResult>;
  toggleLike: (comment: CommentDTO) => Promise<void>;
  remove: (commentId: string) => Promise<ActionResult>;
  loadMoreReplies: (rootId: string) => Promise<ActionResult>;
  /** 已二次加载的回复（按线程合并） */
  extraReplies: Record<string, ThreadReplyDTO[]>;
  verificationModal: ReactNode;
}

export function useComments(
  subject: CommentSubject,
  options: UseCommentsOptions = {}
): UseCommentsResult {
  const pageSize = options.pageSize ?? 20;
  const [data, setData] = useState<RootCommentListDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSortState] = useState<'latest' | 'hottest'>(
    options.initialSort ?? 'latest'
  );
  const [page, setPageState] = useState(1);
  const [extraReplies, setExtraReplies] = useState<Record<string, ThreadReplyDTO[]>>({});

  // 删除走人机验证门（action 复用 photo_delete 白名单项；服务端仅校验验证状态）
  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification();

  const load = useCallback(
    async (nextPage: number, nextSort: 'latest' | 'hottest') => {
      setIsLoading(true);
      setError('');
      const result = await fetchComments(subject, {
        page: nextPage,
        pageSize,
        sort: nextSort,
      });
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.message || '评论加载失败');
      }
      setIsLoading(false);
    },
    [subject, pageSize]
  );

  useEffect(() => {
    setPageState(1);
    setExtraReplies({});
    load(1, sort);
    // subject 变化重新加载
  }, [subject.subjectType, subject.subjectId, sort, load]);

  const setSort = useCallback((next: 'latest' | 'hottest') => {
    setSortState(next);
  }, []);

  const setPage = useCallback(
    (next: number) => {
      setPageState(next);
      load(next, sort);
    },
    [load, sort]
  );

  const refresh = useCallback(async () => {
    await load(page, sort);
  }, [load, page, sort]);

  /** 发表 L1：成功后本地置顶（最新排序）或刷新最热列表 */
  const publishTopLevel = useCallback(
    async (content: string): Promise<ActionResult> => {
      const result = await publishComment({ ...subject, content });
      if (!result.success || !result.data) {
        return { success: false, message: result.message };
      }
      if (sort === 'latest' && page === 1) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                items: [
                  {
                    ...(result.data as ThreadReplyDTO),
                    is_liked: false,
                    replies: [],
                    total_reply_count: 0,
                    has_more_replies: false,
                  },
                  ...prev.items,
                ],
                total: prev.total + 1,
              }
            : prev
        );
      }
      return { success: true };
    },
    [subject, sort, page]
  );

  /** 回复：成功后把新评论并入对应线程（归档线程由后端回迁，DTO 含 root_id） */
  const replyTo = useCallback(
    async (params: {
      parentId: string;
      rootId?: string;
      content: string;
    }): Promise<ActionResult> => {
      const result = await publishComment({
        ...subject,
        parentId: params.parentId,
        rootId: params.rootId,
        content: params.content,
      });
      if (!result.success || !result.data) {
        return { success: false, message: result.message };
      }
      const newReply = result.data as ThreadReplyDTO;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => {
            if (item.id !== newReply.root_id) return item;
            return {
              ...item,
              replies: [...item.replies, newReply],
              total_reply_count: item.total_reply_count + 1,
            };
          }),
        };
      });
      return { success: true };
    },
    [subject]
  );

  /** 点赞：乐观更新所有出现位置，失败回滚 */
  const toggleLike = useCallback(async (comment: CommentDTO) => {
    const targetLiked = !comment.is_liked;

    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => {
          const patchNode = <T extends CommentDTO>(node: T): T => {
            if (node.id !== comment.id) return node;
            return {
              ...node,
              is_liked: targetLiked,
              like_count: targetLiked
                ? node.like_count + 1
                : Math.max(0, node.like_count - 1),
            };
          };
          return {
            ...patchNode(item),
            replies: item.replies.map((r) => patchNode(r)),
          };
        }),
      };
    });

    const result = await setCommentLikeApi(comment.id, targetLiked);
    if (!result.success || !result.data) {
      // 回滚：重新拉取当前页保证状态一致
      await load(page, sort);
    } else {
      // 以服务端权威值校准
      const { like_count, is_liked } = result.data;
      setData((prev) => {
        if (!prev) return prev;
        const apply = <T extends CommentDTO>(node: T): T =>
          node.id === comment.id ? { ...node, like_count, is_liked } : node;
        return {
          ...prev,
          items: prev.items.map((item) => ({
            ...apply(item),
            replies: item.replies.map((r) => apply(r)),
          })),
        };
      });
    }
  }, [load, page, sort]);

  /** 删除：人机验证门通过后执行；按返回范围更新本地状态 */
  const remove = useCallback(
    async (commentId: string): Promise<ActionResult> => {
      const result = await verificationGuard('photo_delete', () =>
        removeCommentApi(commentId)
      );
      if (!result.success || !result.data) {
        return { success: false, message: result.message };
      }
      if (result.data.deletedThread) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.filter((item) => item.id !== commentId),
                total: Math.max(0, prev.total - 1),
              }
            : prev
        );
      } else {
        setData((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((item) => {
                  const exists =
                    item.id === commentId ||
                    item.replies.some((r) => r.id === commentId);
                  if (!exists) return item;
                  return {
                    ...item,
                    replies: item.replies.filter((r) => r.id !== commentId),
                    total_reply_count: Math.max(0, item.total_reply_count - 1),
                  };
                }),
              }
            : prev
        );
      }
      return { success: true };
    },
    [verificationGuard]
  );

  /** 单楼二次加载：接续已载数量拉取并合并 */
  const loadMoreReplies = useCallback(
    async (rootId: string): Promise<ActionResult> => {
      const loadedCount =
        (data?.items.find((i) => i.id === rootId)?.replies.length ?? 0) +
        (extraReplies[rootId]?.length ?? 0);
      const result = await fetchThreadReplies(rootId, { offset: loadedCount });
      if (!result.success || !result.data) {
        return { success: false, message: result.message };
      }
      const incoming = result.data.items;
      setExtraReplies((prev) => ({
        ...prev,
        [rootId]: [...(prev[rootId] ?? []), ...incoming],
      }));
      // 同步并入 items 的 replies，消除 has_more 标记
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.id !== rootId
                  ? item
                  : {
                      ...item,
                      replies: [...item.replies, ...incoming],
                      has_more_replies:
                        item.replies.length + incoming.length < item.total_reply_count,
                    }
              ),
            }
          : prev
      );
      return { success: true };
    },
    [data, extraReplies]
  );

  return {
    data,
    isLoading,
    error,
    sort,
    page,
    setSort,
    setPage,
    refresh,
    publishTopLevel,
    replyTo,
    toggleLike,
    remove,
    loadMoreReplies,
    extraReplies,
    verificationModal,
  };
}
