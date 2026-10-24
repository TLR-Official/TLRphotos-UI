/**
 * @file 帖子流列表项（论坛首页 / 板块页共用）
 * @description
 *  桌面端保持原单行布局（标题 truncate + 右侧统计）。
 *  移动端（≤768px）改为：标题至多两行截断 + 纯文本统计行独立成行，
 *  统计区严禁图标/emoji，仅「x 回复 · x 点赞 · x 浏览」灰色文本（V3.2.0 红线）。
 */
import { Link } from 'react-router-dom';
import type { ThreadListItem as ThreadListItemData } from '../types';

/** 相对时间格式化：1 分钟内「刚刚」，1 小时内「x 分钟前」，24 小时内「x 小时前」，否则日期 */
function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN');
}

interface ThreadListItemProps {
  thread: ThreadListItemData;
}

export function ThreadListItem({ thread: t }: ThreadListItemProps) {
  return (
    <Link
      to={`/forum/t/${t.id}`}
      className="block p-4 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 max-md:flex-col max-md:gap-1">
        <div className="min-w-0 flex-1 max-md:w-full">
          <div className="flex items-center gap-2">
            {t.is_pinned === 1 && <span className="text-xs text-gray-500 shrink-0">置顶</span>}
            {/* 移动端两行截断（whitespace-normal 解除 truncate 的 nowrap），桌面端保持单行 truncate */}
            <h3 className="font-medium text-black truncate max-md:line-clamp-2 max-md:whitespace-normal">{t.title}</h3>
          </div>
          <div className="text-xs text-gray-500 mt-1 flex gap-3">
            <span>{t.author_name}</span>
            <span>{formatTime(t.last_reply_at || t.created_at)}</span>
          </div>
        </div>
        <span className="text-xs text-gray-500 shrink-0">{t.reply_count} 回复 · {t.like_count} 点赞 · {t.view_count} 浏览</span>
      </div>
    </Link>
  );
}
