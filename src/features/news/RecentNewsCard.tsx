/**
 * @file RecentNewsCard.tsx（V4.8.0）
 * @description 首页侧栏「最近新闻」卡片：取新闻区最新 5 条（GET /api/news），
 *              点击进入新闻详情，底部入口跳转新闻列表。替换原「航拍技术专栏」卡片。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNewsList } from '../../api/news';
import type { NewsListItem } from '../../api/news';
import { CachedImage } from '../../components/CachedImage';
import { formatShortDate } from '../../shared/utils';

/** 侧栏展示条数 */
const RECENT_NEWS_COUNT = 5;

/**
 * 首页最近新闻卡片
 * @returns 新闻侧栏卡片 JSX（含空态与全部新闻入口）
 */
export function RecentNewsCard() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NewsListItem[]>([]);

  useEffect(() => {
    getNewsList(1, RECENT_NEWS_COUNT).then((result) => {
      if (result.success && result.data) {
        setItems(result.data.items.slice(0, RECENT_NEWS_COUNT));
      }
    });
  }, []);

  return (
    <div className="h-full rounded-2xl shadow-lg overflow-hidden flex flex-col bg-white">
      <div className="p-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold mb-1 text-gray-900">最近新闻</h3>
        <p className="text-sm text-gray-500">航空领域最新动态</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">暂无新闻</div>
        ) : (
          items.map((item, index) => (
            <div
              key={item.id}
              onClick={() => navigate(`/news/${item.id}`)}
              className={`p-4 cursor-pointer transition-colors hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${
                index === 0 ? 'bg-gray-50/60' : ''
              }`}
            >
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-100">
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
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium mb-1 line-clamp-2 text-gray-900">
                    {item.title}
                  </h4>
                  <p className="text-xs truncate mb-2 text-gray-500">{item.excerpt}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex-shrink-0">{formatShortDate(item.created_at)}</span>
                    <span className="truncate">作者：{item.author_name}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-gray-100">
        <button
          onClick={() => navigate('/news')}
          className="w-full py-2 rounded-lg text-sm font-medium transition-colors bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          查看全部新闻 →
        </button>
      </div>
    </div>
  );
}
