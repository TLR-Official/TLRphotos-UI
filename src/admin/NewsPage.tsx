/**
 * 新闻管理列表页（V4.0.0）
 * 管理端新闻列表：标题/板块/作者/时间/图片数 + 编辑与删除操作，顶部「新建新闻」入口。
 * 数据来源：GET /api/admin/news、DELETE /api/admin/news/:id（仅 super / news_editor）。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminNewsList, deleteNews } from './api';
import type { AdminNewsItem } from './api';
import { formatDateTime } from '../shared/utils';

/** 每页数量（与后端默认一致） */
const PAGE_SIZE = 20;

/** 板块显示名映射（首批仅航空） */
const BOARD_LABEL: Record<string, string> = { aviation: '航空' };

/**
 * 新闻管理列表页组件
 * @returns 新闻列表 + 分页 JSX
 */
export function NewsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminNewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // 错误提示（列表加载失败等）
  const [error, setError] = useState('');
  // 操作提示（删除成功/失败等），3 秒自动清空
  const [notice, setNotice] = useState('');
  // 删除确认弹窗目标
  const [deleteTarget, setDeleteTarget] = useState<AdminNewsItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /** 按当前页码拉取新闻列表 */
  const fetchNews = async () => {
    setLoading(true);
    setError('');
    const result = await getAdminNewsList(page, PAGE_SIZE);
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotal(result.data.total);
    } else {
      setError(result.message || '加载新闻列表失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchNews();
  }, [page]);

  /** 执行删除：成功后刷新列表并提示 */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const result = await deleteNews(deleteTarget.id);
    setDeleteLoading(false);
    if (result.success) {
      setNotice(`已删除「${deleteTarget.title}」`);
      setDeleteTarget(null);
      // 当前页删空时回退一页
      if (items.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        fetchNews();
      }
    } else {
      setNotice(result.message || '删除失败');
    }
    setTimeout(() => setNotice(''), 3000);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">新闻管理</h2>
          <p className="text-sm text-gray-500 mt-1">共 {total} 条新闻 · 首批仅开放航空板块</p>
        </div>
        <button
          onClick={() => navigate('/admin/news/new')}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
        >
          新建新闻
        </button>
      </div>

      {/* 操作提示 */}
      {notice && (
        <p className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          {notice}
        </p>
      )}

      {/* 加载失败 */}
      {error && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-800 mb-3">{error}</p>
          <button
            onClick={fetchNews}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* 新闻列表 */}
      {!error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-500">加载中...</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-500">暂无新闻，点击右上角「新建新闻」发布第一条</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {items.map((item) => (
                <div key={item.id} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0">
                        {BOARD_LABEL[item.board_id] || item.board_id}
                      </span>
                      <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex gap-3">
                      <span>作者：{item.author}</span>
                      <span>{formatDateTime(item.published_at)}</span>
                      <span>{item.image_count} 张配图</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/admin/news/${item.id}/edit`)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setDeleteTarget(item)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded bg-gray-100 text-gray-600 disabled:opacity-40 transition-colors"
          >
            上一页
          </button>
          <span className="px-3 py-1 text-sm text-gray-500">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded bg-gray-100 text-gray-600 disabled:opacity-40 transition-colors"
          >
            下一页
          </button>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">确认删除新闻</h3>
            <p className="text-sm text-gray-600 mb-1">将永久删除「{deleteTarget.title}」</p>
            <p className="text-xs text-gray-500 mb-5">配图关联与正文文件将一并清理，不可恢复。</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteLoading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
