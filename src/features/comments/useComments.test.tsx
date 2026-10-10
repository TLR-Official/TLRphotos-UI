/**
 * @file useComments.test.tsx
 * @description TR-6.2 通用评论 Hook 测试（fake-indexeddb + jsdom，API 全 mock）：
 *              初始加载、L1 发布置顶、回复并入线程、点赞乐观更新、删除整楼、单楼二次加载。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  CommentDTO,
  RootCommentListDTO,
  RootCommentSummaryDTO,
  ThreadReplyDTO,
} from '../../api/comments';

// ---- API mock（路径相对本测试文件，与 Hook 内部引用解析为同一模块）----
vi.mock('../../api/comments', () => ({
  fetchComments: vi.fn(),
  publishComment: vi.fn(),
  fetchThreadReplies: vi.fn(),
  setCommentLikeApi: vi.fn(),
  removeCommentApi: vi.fn(),
}));

// ---- 人机验证门 mock：直接透传执行 ----
vi.mock('../../shared/useHumanVerification', () => ({
  useHumanVerification: () => ({
    guard: (_action: string, op: () => unknown) => op(),
    modal: null,
    gateOpen: false,
  }),
}));

import {
  fetchComments,
  publishComment,
  fetchThreadReplies,
  setCommentLikeApi,
  removeCommentApi,
} from '../../api/comments';
import { useComments } from './useComments';

const baseNode = {
  subject_type: 'photo' as const,
  subject_id: 'photo-1',
  root_id: 'c1',
  reply_to_user_id: null,
  reply_to_user_name: null,
  created_at: '2026-10-10T10:00:00.000Z',
};

const makeReply = (
  id: string,
  parentId: string,
  depth: number,
  author: string
): ThreadReplyDTO => ({
  ...baseNode,
  id,
  parent_id: parentId,
  depth,
  user_id: `u-${id}`,
  author,
  content: `reply ${id}`,
  like_count: 0,
  is_liked: false,
});

const makeRoot = (
  id: string,
  overrides: Partial<RootCommentSummaryDTO> = {}
): RootCommentSummaryDTO => ({
  ...baseNode,
  id,
  root_id: id,
  parent_id: null,
  depth: 1,
  user_id: 'u1',
  author: 'alice',
  content: 'root content',
  like_count: 3,
  is_liked: false,
  replies: [],
  total_reply_count: 0,
  has_more_replies: false,
  ...overrides,
});

const listWith = (
  items: RootCommentSummaryDTO[],
  total = items.length
): RootCommentListDTO => ({
  items,
  archiveThreads: [],
  page: 1,
  pageSize: 20,
  total,
  totalPages: 1,
});

const subject = { subjectType: 'photo' as const, subjectId: 'photo-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useComments', () => {
  it('挂载时自动加载评论列表', async () => {
    vi.mocked(fetchComments).mockResolvedValue({
      success: true,
      data: listWith([makeRoot('c1')]),
    });
    const { result } = renderHook(() => useComments(subject));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.items).toHaveLength(1);
    expect(fetchComments).toHaveBeenCalledOnce();
  });

  it('发表 L1 成功后在最新列表顶部插入并使 total+1', async () => {
    vi.mocked(fetchComments).mockResolvedValue({
      success: true,
      data: listWith([makeRoot('c1')]),
    });
    vi.mocked(publishComment).mockResolvedValue({
      success: true,
      data: { ...makeRoot('c2'), is_liked: false } as CommentDTO,
    });

    const { result } = renderHook(() => useComments(subject));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const r = await result.current.publishTopLevel('new top comment');
      expect(r.success).toBe(true);
    });

    expect(result.current.data?.items[0].id).toBe('c2');
    expect(result.current.data?.total).toBe(2);
  });

  it('回复成功后并入对应线程且回复计数+1', async () => {
    vi.mocked(fetchComments).mockResolvedValue({
      success: true,
      data: listWith([makeRoot('c1')]),
    });
    const reply = makeReply('r1', 'c1', 2, 'bob');
    vi.mocked(publishComment).mockResolvedValue({ success: true, data: reply });

    const { result } = renderHook(() => useComments(subject));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const r = await result.current.replyTo({ parentId: 'c1', content: 'hi' });
      expect(r.success).toBe(true);
    });

    const thread = result.current.data?.items[0];
    expect(thread?.replies).toHaveLength(1);
    expect(thread?.total_reply_count).toBe(1);
  });

  it('点赞执行乐观更新并调用 API，随后以服务端值校准', async () => {
    vi.mocked(fetchComments).mockResolvedValue({
      success: true,
      data: listWith([makeRoot('c1')]),
    });
    vi.mocked(setCommentLikeApi).mockResolvedValue({
      success: true,
      data: { like_count: 4, is_liked: true },
    });

    const { result } = renderHook(() => useComments(subject));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const root = result.current.data!.items[0];
    await act(async () => {
      await result.current.toggleLike(root);
    });

    expect(setCommentLikeApi).toHaveBeenCalledWith('c1', true);
    const updated = result.current.data?.items[0];
    expect(updated?.is_liked).toBe(true);
    expect(updated?.like_count).toBe(4);
  });

  it('删除整楼后从列表移除并使 total-1', async () => {
    vi.mocked(fetchComments).mockResolvedValue({
      success: true,
      data: listWith([makeRoot('c1'), makeRoot('c2')]),
    });
    vi.mocked(removeCommentApi).mockResolvedValue({
      success: true,
      data: { deletedThread: true, removedCount: 1 },
    });

    const { result } = renderHook(() => useComments(subject));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const r = await result.current.remove('c1');
      expect(r.success).toBe(true);
    });

    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.data?.items[0].id).toBe('c2');
    expect(result.current.data?.total).toBe(1);
  });

  it('单楼二次加载把新回复并入线程', async () => {
    vi.mocked(fetchComments).mockResolvedValue({
      success: true,
      data: listWith([
        makeRoot('c1', {
          replies: [makeReply('r1', 'c1', 2, 'bob')],
          total_reply_count: 2,
          has_more_replies: true,
        }),
      ]),
    });
    vi.mocked(fetchThreadReplies).mockResolvedValue({
      success: true,
      data: {
        items: [makeReply('r2', 'c1', 2, 'carol')],
        total: 2,
        limit: 100,
        offset: 1,
      },
    });

    const { result } = renderHook(() => useComments(subject));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const r = await result.current.loadMoreReplies('c1');
      expect(r.success).toBe(true);
    });

    const thread = result.current.data?.items[0];
    expect(thread?.replies).toHaveLength(2);
    expect(thread?.has_more_replies).toBe(false);
  });
});
