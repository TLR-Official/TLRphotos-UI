/** 论坛首页（V3.1.0）：板块导航 + 帖子流 + 板块卡片；移动端板块卡片单列通栏 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getBoards, getThreads } from '../../api/forum';
import { ThreadListItem } from './components/ThreadListItem';
import { ThreadPagination } from './components/ThreadPagination';
import type { Board, ThreadListItem as ThreadListItemData, ThreadSort } from './types';

export function ForumHomePage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [threads, setThreads] = useState<ThreadListItemData[]>([]);
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
          className="px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors text-sm font-medium max-md:py-3"
        >
          + 发帖
        </button>
      </div>

      {/* 板块横向导航 */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        <Link
          to="/forum"
          className="px-3 py-1.5 bg-blue-50 text-blue-800 rounded-full text-sm whitespace-nowrap hover:bg-blue-200 max-md:py-3 max-md:inline-flex max-md:items-center"
        >
          全部
        </Link>
        {boards.map((b) => (
          <Link
            key={b.id}
            to={`/forum/b/${b.id}`}
            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-sm whitespace-nowrap hover:bg-slate-200 max-md:py-3 max-md:inline-flex max-md:items-center"
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
              className={`px-3 py-1.5 rounded-lg text-sm max-md:py-3 ${sort === 'latest' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              最新
            </button>
            <button
              onClick={() => { setSort('hot'); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm max-md:py-3 ${sort === 'hot' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}
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
                <ThreadListItem key={t.id} thread={t} />
              ))}
            </div>
          )}

          <ThreadPagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>

        {/* 板块卡片侧栏：移动端拆分为单列通栏卡片（min-h 72px），桌面端保持白卡内列表 */}
        <div className="lg:col-span-1">
          <div className="md:bg-white md:rounded-lg md:border md:border-gray-200 md:p-4">
            <h2 className="font-medium text-black mb-3">板块</h2>
            <div className="space-y-2">
              {boards.map((b) => (
                <Link
                  key={b.id}
                  to={`/forum/b/${b.id}`}
                  className="flex min-h-[72px] flex-col justify-center rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 md:block md:min-h-0 md:rounded md:border-0 md:bg-transparent md:p-2"
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
