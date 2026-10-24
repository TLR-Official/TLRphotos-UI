/** 板块页（V3.1.0）：该板块下的帖子列表；移动端支持下拉刷新（70px 阈值） */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBoards, getThreads } from '../../api/forum';
import { useIsMobile } from '../../shared/useIsMobile';
import { ThreadListItem } from './components/ThreadListItem';
import { ThreadPagination } from './components/ThreadPagination';
import type { Board, ThreadListItem as ThreadListItemData, ThreadSort } from './types';

/** 下拉刷新触发阈值（px） */
const PULL_THRESHOLD = 70;
/** 下拉距离上限（px），防止指示条无限增高 */
const PULL_MAX = 140;

export function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<ThreadListItemData[]>([]);
  const [sort, setSort] = useState<ThreadSort>('latest');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // 下拉手势运行态（ref 避免 touchmove 高频触发渲染依赖）
  const pullStateRef = useRef({ startY: 0, distance: 0, active: false });

  useEffect(() => {
    getBoards().then((r) => {
      if (r.success && r.data) setBoard(r.data.find((b) => b.id === boardId) || null);
    });
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;
    setLoading(true);
    getThreads({ board_id: boardId, sort, page, page_size: 20 })
      .then((r) => {
        if (r.success && r.data) { setThreads(r.data.items); setTotal(r.data.total); }
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [boardId, sort, page, refreshTick]);

  // 移动端下拉刷新：仅页面滚动至顶部（scrollY===0）时下拉生效，达阈值松手触发重新加载
  useEffect(() => {
    if (!isMobile) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (window.scrollY <= 0) {
        pullStateRef.current = { startY: touch.clientY, distance: 0, active: true };
      } else {
        pullStateRef.current.active = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const st = pullStateRef.current;
      if (!st.active) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - st.startY;
      if (dy > 0 && window.scrollY <= 0) {
        st.distance = Math.min(dy, PULL_MAX);
        setPullDistance(st.distance);
      } else if (st.distance !== 0) {
        st.distance = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      const st = pullStateRef.current;
      if (!st.active) return;
      st.active = false;
      if (st.distance >= PULL_THRESHOLD) {
        setRefreshing(true);
        setPage(1);
        setRefreshTick((t) => t + 1);
      }
      st.distance = 0;
      setPullDistance(0);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* 下拉刷新指示条（仅移动端）：下拉中提示阈值状态，刷新中常驻显示 */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden text-xs text-slate-400 md:hidden"
          style={{ height: refreshing ? 32 : Math.min(pullDistance, 56) }}
        >
          {refreshing ? '刷新中…' : pullDistance >= PULL_THRESHOLD ? '松开刷新' : '下拉刷新'}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Link to="/forum" className="hover:text-blue-700">论坛</Link>
        <span>/</span>
        <span className="text-slate-700">{board?.name || boardId}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-black">{board?.name || '板块'}</h1>
        <button
          onClick={() => navigate(`/forum/new?board_id=${boardId}`)}
          className="px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors text-sm font-medium max-md:py-3"
        >
          + 发帖
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => { setSort('latest'); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-sm max-md:py-3 ${sort === 'latest' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}>最新</button>
        <button onClick={() => { setSort('hot'); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-sm max-md:py-3 ${sort === 'hot' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}>最热</button>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">加载中…</div>
      ) : threads.length === 0 ? (
        <div className="text-slate-400 text-sm py-12 text-center">该板块暂无帖子</div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <ThreadListItem key={t.id} thread={t} />
          ))}
        </div>
      )}

      <ThreadPagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
