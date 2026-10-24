/**
 * @file 新闻列表页（V4.0.0）
 * @description
 *  公开新闻列表（/news 路由）：封面缩略图 + 标题 + 作者 + 日期 + 摘要，
 *  按「加载更多」分页（与通知中心同口径），空状态与首屏加载态齐备。
 *  数据来源：GET /api/news（公开端点，无需登录，120 次/分限速）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CachedImage } from '../../components/CachedImage';
import { getNewsList } from '../../api/news';
import type { NewsListItem } from '../../api/news';
import { formatLongDate } from '../../shared/utils';

/** 每页条数（与后端默认一致） */
const PAGE_SIZE = 10;

/**
 * 新闻列表页组件
 * @returns 新闻列表 JSX
 */
export function NewsListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NewsListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  // 是否还有更多（已加载条数 < 总数）
  const [hasMore, setHasMore] = useState(false);
  // 首次加载失败提示（区别于加载更多失败）
  const [error, setError] = useState('');

  /** 拉取指定页新闻：第一页覆盖列表，后续页追加（以 id 去重防翻页间隙重复） */
  const fetchPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    const res = await getNewsList(targetPage, PAGE_SIZE);
    if (res.success && res.data) {
      const fetched = res.data.items;
      const totalCount = res.data.total;
      setTotal(totalCount);
      setItems((prev) => {
        const base = targetPage === 1 ? [] : prev;
        const seen = new Set(base.map((n) => n.id));
        return [...base, ...fetched.filter((n) => !seen.has(n.id))];
      });
      setPage(targetPage);
      setHasMore(fetched.length > 0 && targetPage * PAGE_SIZE < totalCount);
    } else if (targetPage === 1) {
      setError(res.message || '加载新闻失败');
    }
    setLoading(false);
  }, []);

  // 挂载时拉取第一页
  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">新闻</h1>
          <p className="text-sm text-gray-500 mt-1">共 {total} 条新闻 · 航空板块</p>
        </div>

        {/* 首屏加载失败 */}
        {error && (
          <div className="text-center py-16">
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={() => fetchPage(1)}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {/* 空状态 */}
        {!error && !loading && items.length === 0 && (
          <div className="text-center py-16 text-gray-500">暂无新闻</div>
        )}

        {/* 新闻列表 */}
        <div className="space-y-4">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/news/${item.id}`)}
              className="w-full text-left flex gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors max-md:flex-col max-md:gap-0 max-md:p-0 max-md:overflow-hidden"
            >
              {/* 封面缩略图（移动端 16:9 通栏） */}
              <div className="w-36 h-24 sm:w-48 sm:h-32 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 max-md:w-full max-md:h-auto max-md:aspect-video max-md:rounded-none">
                {item.cover_image ? (
                  <CachedImage
                    src={item.cover_image}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                    暂无配图
                  </div>
                )}
              </div>
              {/* 文本信息（移动端卡片下部内边距） */}
              <div className="min-w-0 flex-1 max-md:px-4 max-md:py-3">
                <h2 className="text-base sm:text-lg font-bold text-gray-900 line-clamp-2">
                  {item.title}
                </h2>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                  <span>作者：{item.author_name}</span>
                  <span>{formatLongDate(item.created_at)}</span>
                </div>
                {item.excerpt && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2 leading-relaxed max-md:hidden">{item.excerpt}</p>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* 加载更多 */}
        {hasMore && (
          <div className="text-center mt-8">
            <button
              onClick={() => fetchPage(page + 1)}
              disabled={loading}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 transition-colors"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}

        {/* 首屏加载态 */}
        {loading && items.length === 0 && !error && (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        )}
      </div>
    </div>
  );
}
