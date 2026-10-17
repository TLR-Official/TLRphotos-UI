/**
 * @file 通知中心页（V4.0.0）
 * @description
 *  展示当前登录用户的站内通知列表：
 *   - 类型用文字徽章区分（点赞/下载/热门/处罚/申诉回执/召回/回复），无 emoji 无图标；
 *   - 未读条目 blue-50 底 + 标题加粗，已读条目灰色；
 *   - 点击条目标记已读并按 related_type 跳转（photo → 照片详情，thread → 论坛帖详情，其余停留）；
 *   - 「全部已读」一键清零；分页「加载更多」；空状态文案。
 *  未登录时渲染登录引导（与 MyWorksPage 同口径，无独立 PrivateRoute）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../shared/UserContext';
import {
  getNotifications,
  markRead,
  markAllRead,
} from '../../api/notifications';
import type { NotificationItem, NotificationType } from '../../api/notifications';

/** 每页条数（与后端默认一致） */
const PAGE_SIZE = 20;

/** 类型文字徽章配置：label + 配色（热门用 violet 次级点缀，处罚用灰，其余 blue-50） */
const TYPE_BADGE: Record<NotificationType, { label: string; className: string }> = {
  photo_liked: { label: '点赞', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  photo_downloaded: { label: '下载', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  photo_hot: { label: '热门', className: 'bg-violet-50 text-violet-700 border border-violet-200' },
  penalty: { label: '处罚', className: 'bg-gray-100 text-gray-700 border border-gray-200' },
  appeal_approved: { label: '申诉回执', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  appeal_rejected: { label: '申诉回执', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  photo_recalled: { label: '召回', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  forum_reply: { label: '回复', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
};

/** 未知类型的兜底徽章 */
const FALLBACK_BADGE = { label: '通知', className: 'bg-gray-100 text-gray-700 border border-gray-200' };

/**
 * 格式化通知时间为中文短格式
 * @param iso ISO 时间字符串
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 通知中心页组件
 * @returns 登录引导 / 通知列表 JSX
 */
export function NotificationPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useUser();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  // 是否还有更多（已加载条数 < 总数）
  const [hasMore, setHasMore] = useState(false);
  // 操作提示（全部已读 / 已读失败等），3 秒自动清空
  const [notice, setNotice] = useState('');

  /** 拉取指定页通知：第一页覆盖列表，后续页追加（以 id 去重防翻页间隙重复） */
  const fetchPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    const res = await getNotifications(targetPage, PAGE_SIZE);
    if (res.success && res.data) {
      const fetched = res.data;
      const totalCount = res.pagination?.total ?? 0;
      setTotal(totalCount);
      setItems((prev) => {
        const base = targetPage === 1 ? [] : prev;
        const seen = new Set(base.map((n) => n.id));
        return [...base, ...fetched.filter((n) => !seen.has(n.id))];
      });
      setPage(targetPage);
      setHasMore(fetched.length > 0 && targetPage * PAGE_SIZE < totalCount);
    }
    setLoading(false);
  }, []);

  // 登录态变化时重置并拉取第一页
  useEffect(() => {
    if (isAuthenticated) {
      fetchPage(1);
    } else {
      setItems([]);
      setTotal(0);
      setHasMore(false);
    }
  }, [isAuthenticated, fetchPage]);

  /** 全部标记已读：本地同步置灰并刷新角标数据源 */
  const handleMarkAllRead = async () => {
    const res = await markAllRead();
    if (res.success) {
      setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
      setNotice('已全部标记为已读');
    } else {
      setNotice(res.message || '操作失败');
    }
    setTimeout(() => setNotice(''), 3000);
  };

  /**
   * 点击条目：未读时先标记已读，再按 related_type 跳转
   * photo → /photos/:id；thread → /forum/t/:id；其余（appeal/penalty/null）停留本页
   */
  const handleItemClick = async (item: NotificationItem) => {
    if (!item.is_read) {
      const res = await markRead(item.id);
      if (res.success) {
        setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: 1 } : n)));
      }
    }
    if (item.related_type === 'photo' && item.related_id) {
      navigate(`/photos/${item.related_id}`);
    } else if (item.related_type === 'thread' && item.related_id) {
      navigate(`/forum/t/${item.related_id}`);
    }
  };

  // 未登录引导
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">通知中心</h1>
          <p className="text-gray-500 mb-6">登录后即可查看您的站内通知</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-3 rounded-lg font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">通知中心</h1>
            <p className="text-sm text-gray-500 mt-1">共 {total} 条通知</p>
          </div>
          <button
            onClick={handleMarkAllRead}
            disabled={loading || items.every((n) => n.is_read)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
          >
            全部已读
          </button>
        </div>

        {/* 操作提示 */}
        {notice && (
          <p className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            {notice}
          </p>
        )}

        {/* 空状态 */}
        {!loading && items.length === 0 && (
          <div className="text-center py-16 text-gray-500">暂无通知</div>
        )}

        {/* 通知列表 */}
        <div className="space-y-2">
          {items.map((item) => {
            const badge = TYPE_BADGE[item.type] ?? FALLBACK_BADGE;
            const unread = !item.is_read;
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                  unread
                    ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span
                    className={`text-sm ${unread ? 'font-bold text-gray-900' : 'text-gray-500'}`}
                  >
                    {item.title}
                  </span>
                  <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                    {formatTime(item.created_at)}
                  </span>
                </div>
                {item.content && (
                  <p className={`mt-1.5 text-sm leading-relaxed ${unread ? 'text-gray-800' : 'text-gray-500'}`}>
                    {item.content}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* 加载更多 */}
        {hasMore && (
          <div className="text-center mt-6">
            <button
              onClick={() => fetchPage(page + 1)}
              disabled={loading}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}

        {/* 首屏加载态 */}
        {loading && items.length === 0 && (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        )}
      </div>
    </div>
  );
}
