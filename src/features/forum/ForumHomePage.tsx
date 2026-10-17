/** 论坛首页（V3.1.0）：板块导航 + 帖子流 + 板块卡片 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getBoards, getThreads } from '../../api/forum';
import type { Board, ThreadListItem, ThreadSort } from './types';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN');
}

export function ForumHomePage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [sort, setSort] = useState<ThreadSort>('latest');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBoards().then((r) => r.success && r.data && setBoards(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getThreads({ sort, page, page_size: 20 })
      .then((r) => {
        if (r.success && r.data) {
          setThreads(r.data.items);
          setTotal(r.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [sort, page]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-black">论坛</h1>
        <button
          onClick={() => navigate('/forum/new')}
          className="px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors text-sm font-medium"
        >
          + 发帖
        </button>
      </div>

      {/* 板块横向导航 */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        <Link
          to="/forum"
          className="px-3 py-1.5 bg-blue-50 text-blue-800 rounded-full text-sm whitespace-nowrap hover:bg-blue-200"
        >
          全部
        </Link>
        {boards.map((b) => (
          <Link
            key={b.id}
            to={`/forum/b/${b.id}`}
            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-sm whitespace-nowrap hover:bg-slate-200"
          >
            {b.name}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 帖子流 */}
        <div className="lg:col-span-3">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { setSort('latest'); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm ${sort === 'latest' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              最新
            </button>
            <button
              onClick={() => { setSort('hot'); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm ${sort === 'hot' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              最热
            </button>
          </div>

          {loading ? (
            <div className="text-slate-400 text-sm py-8 text-center">加载中…</div>
          ) : threads.length === 0 ? (
            <div className="text-slate-400 text-sm py-12 text-center">还没有帖子，来发第一篇吧</div>
          ) : (
            <div className="space-y-2">
              {threads.map((t) => (
                <Link
                  key={t.id}
                  to={`/forum/t/${t.id}`}
                  className="block p-4 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {t.is_pinned === 1 && <span className="text-xs text-gray-500">置顶</span>}
                        <h3 className="font-medium text-black truncate">{t.title}</h3>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex gap-3">
                        <span>{t.author_name}</span>
                        <span>{formatTime(t.last_reply_at || t.created_at)}</span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 shrink-0">{t.reply_count} 回复 · {t.like_count} 点赞 · {t.view_count} 浏览</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded bg-slate-100 text-slate-600 disabled:opacity-40"
              >
                上一页
              </button>
              <span className="px-3 py-1 text-sm text-slate-500">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded bg-slate-100 text-slate-600 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>

        {/* 板块卡片侧栏 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="font-medium text-black mb-3">板块</h2>
            <div className="space-y-2">
              {boards.map((b) => (
                <Link
                  key={b.id}
                  to={`/forum/b/${b.id}`}
                  className="block p-2 rounded hover:bg-gray-50"
                >
                  <div className="text-sm text-slate-700">{b.name}</div>
                  <div className="text-xs text-slate-400">{b.thread_count} 篇帖子</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
