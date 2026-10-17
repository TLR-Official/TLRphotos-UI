/**
 * @file CommentList.tsx（V3.0.0）
 * @description 通用评论区编排组件（主题参数化）：评论数量与排序切换、L1 发布器、
 *              活跃线程列表、归档线程提示条、加载/空态/错误重试、分页，以及人机验证弹窗。
 *              照片详情页 / 文章详情页 / 未来论坛帖子页只需：
 *                <CommentList subject={{ subjectType, subjectId }} />
 */
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Flame, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import type { CommentSubject } from '../../../api/comments';
import { useUser } from '../../../shared/UserContext';
import { useComments } from '../useComments';
import { CommentComposer } from './CommentComposer';
import { CommentThread } from './CommentThread';
import { ArchiveBanner } from './ArchiveBanner';

export interface CommentListProps {
  subject: CommentSubject;
  /** 标题文案，默认"评论" */
  title?: string;
}

export function CommentList({ subject, title = '评论' }: CommentListProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useUser();
  const {
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
    verificationModal,
  } = useComments(subject);

  // 已回迁的归档索引对应线程已在活跃列表，不再重复展示提示条
  const activeArchives = (data?.archiveThreads ?? []).filter(
    (archive) => !archive.rehydrated_at
  );

  return (
    <section className="space-y-5" aria-label={title}>
      {/* 标题 + 数量 + 排序 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-black">
          <MessageSquare className="h-5 w-5 text-blue-700" />
          {title}
          {data && <span className="text-sm font-normal text-gray-400">{data.total}</span>}
        </h2>
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setSort('latest')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              sort === 'latest' ? 'bg-white text-blue-800 shadow-sm' : 'text-gray-500'
            }`}
          >
            最新
          </button>
          <button
            type="button"
            onClick={() => setSort('hottest')}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
              sort === 'hottest' ? 'bg-white text-blue-800 shadow-sm' : 'text-gray-500'
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            最热
          </button>
        </div>
      </div>

      {/* L1 发布器 */}
      <CommentComposer
        isAuthenticated={isAuthenticated}
        onLogin={() => navigate('/login')}
        onPublish={publishTopLevel}
      />

      {/* 加载态 */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          评论加载中…
        </div>
      )}

      {/* 错误态 */}
      {!isLoading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-red-400" />
          <p className="mt-2 text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新加载
          </button>
        </div>
      )}

      {/* 列表区 */}
      {!isLoading && !error && data && (
        <>
          {data.items.length === 0 && activeArchives.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-12 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-3 text-sm text-gray-400">
                还没有评论，来发表第一条评论吧
              </p>
            </div>
          )}

          <div className="space-y-4">
            {activeArchives.map((archive) => (
              <ArchiveBanner
                key={archive.root_id}
                archive={archive}
                currentUserId={user?.id ?? null}
                onReply={replyTo}
                onAfterRehydrate={refresh}
                onDelete={remove}
              />
            ))}
            {data.items.map((thread) => (
              <CommentThread
                key={thread.id}
                thread={thread}
                currentUserId={user?.id ?? null}
                onToggleLike={toggleLike}
                onSubmitReply={replyTo}
                onDelete={remove}
                onLoadMore={loadMoreReplies}
              />
            ))}
          </div>

          {/* 分页 */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-xs text-gray-500">
                {page} / {data.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      {/* 删除操作的人机验证门弹窗 */}
      {verificationModal}
    </section>
  );
}
