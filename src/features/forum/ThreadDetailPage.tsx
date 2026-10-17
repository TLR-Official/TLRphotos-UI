/** 帖子详情页（V3.1.0）：正文 + 复用 CommentList */
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getThread, likeThread, unlikeThread, deleteThread } from '../../api/forum';
import { CommentList } from '../comments/components/CommentList';
import { useUser } from '../../shared/UserContext';
import type { Thread } from './types';

export function ThreadDetailPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useUser();
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!threadId) return;
    setLoading(true);
    getThread(threadId)
      .then((r) => {
        if (r.success && r.data) {
          setThread(r.data ?? null);
          setLikeCount(r.data?.like_count ?? 0);
        } else {
          setError(r.message || '加载失败');
        }
      })
      .finally(() => setLoading(false));
  }, [threadId]);

  const handleLike = async () => {
    if (!isAuthenticated) { navigate('/auth'); return; }
    if (liked) {
      const r = await unlikeThread(threadId!);
      if (r.success && r.data) { setLiked(false); setLikeCount(r.data?.like_count ?? 0); }
    } else {
      const r = await likeThread(threadId!);
      if (r.success && r.data) { setLiked(true); setLikeCount(r.data?.like_count ?? 0); }
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定删除该帖子？此操作不可恢复。')) return;
    const r = await deleteThread(threadId!);
    if (r.success) navigate('/forum');
    else alert(r.message || '删除失败');
  };

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-12 text-center text-slate-400">加载中…</div>;
  if (error || !thread) return <div className="mx-auto max-w-3xl px-4 py-12 text-center text-slate-400">{error || '帖子不存在'}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Link to="/forum" className="hover:text-blue-700">论坛</Link>
        <span>/</span>
        <Link to={`/forum/b/${thread.board_id}`} className="hover:text-blue-700">{thread.board_id}</Link>
      </div>

      <article className="bg-white rounded-lg border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-black mb-3">{thread.title}</h1>
        <div className="flex items-center justify-between text-sm text-gray-500 mb-6">
          <span>{thread.author_name} · {new Date(thread.created_at).toLocaleDateString('zh-CN')}</span>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500">{thread.reply_count} 回复 · {likeCount} 点赞 · {thread.view_count} 浏览</span>
            <button
              onClick={handleLike}
              className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                liked
                  ? 'bg-blue-700 border-blue-700 text-white'
                  : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
              }`}
            >
              {liked ? '已点赞' : '点赞'}
            </button>
          </div>
        </div>

        <div className="prose prose-sm max-w-none text-slate-700 [&_a]:text-blue-700 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded">
          <ReactMarkdown>{thread.content_md}</ReactMarkdown>
        </div>

        {user?.id === thread.author_id && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <button onClick={handleDelete} className="text-sm text-gray-500 hover:text-red-600">删除帖子</button>
          </div>
        )}
      </article>

      <div className="mt-6">
        <CommentList
          subject={{ subjectType: 'thread', subjectId: thread.id }}
          title={`评论 (${thread.reply_count})`}
        />
      </div>
    </div>
  );
}
