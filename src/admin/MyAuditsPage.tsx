/**
 * 我的已处理页（V4.0.0 审核员工作量可视化）
 * 展示当前登录管理员经手（reviewed_by=本人）的照片列表：总数 + 状态筛选 + 分页表格。
 * 数据来源：GET /api/admin/my-audits（reviewed_at 倒序，字段为 photos 表行，缩略图已转代理 URL）。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMyAudits } from './api';
import type { AdminPhoto } from './types';
import { CachedImage } from '../components/CachedImage';

/** 每页数量 */
const PAGE_SIZE = 20;

/** 状态筛选配置 */
const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'pending', label: '待审核（召回/回退）' },
] as const;

/**
 * 我的已处理页组件
 * @returns 工作量列表 JSX
 */
export function MyAuditsPage() {
  const navigate = useNavigate();
  const [audits, setAudits] = useState<AdminPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // 状态或页码变化时重新拉取
  useEffect(() => {
    fetchAudits();
  }, [page, status]);

  /** 按当前筛选拉取我的审核记录 */
  const fetchAudits = async () => {
    setLoading(true);
    const result = await getMyAudits(page, PAGE_SIZE, status || undefined);
    if (result.success && result.data) {
      setAudits(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
  };

  /** 切换状态筛选（重置到第一页） */
  const handleStatusChange = (key: string) => {
    setStatus(key);
    setPage(1);
  };

  /** 渲染状态徽章 */
  const renderStatus = (s: string) => {
    if (s === 'approved') {
      return <span className="px-2 py-1 rounded text-sm bg-green-50 text-green-600 font-medium">已通过</span>;
    }
    if (s === 'rejected') {
      return <span className="px-2 py-1 rounded text-sm bg-red-100 text-red-700 font-medium">已拒绝</span>;
    }
    return <span className="px-2 py-1 rounded text-sm bg-yellow-100 text-yellow-700 font-medium">待审核</span>;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">我的已处理</h2>
          <p className="text-sm text-gray-500 mt-1">共处理 {total} 张照片（按审核时间倒序）</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleStatusChange(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === key
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">作品</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">当前状态</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">审核时间</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">上传时间</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((photo) => (
                <tr
                  key={photo.id}
                  onClick={() => navigate(`/admin/photos/${photo.id}`)}
                  className="border-t border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-9 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                        <CachedImage
                          src={photo.thumbnail_path}
                          alt={photo.title}
                          status={photo.status}
                          cacheEnabled={photo.status === 'approved'}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="text-gray-800 truncate max-w-[240px]">{photo.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{renderStatus(photo.status)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {(photo as unknown as { reviewed_at?: string | null }).reviewed_at
                      ? new Date((photo as unknown as { reviewed_at: string }).reviewed_at).toLocaleString('zh-CN', { hour12: false })
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(photo.created_at).toLocaleString('zh-CN', { hour12: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {audits.length === 0 && (
            <div className="text-center py-10 text-gray-500">暂无经手的审核记录</div>
          )}
        </div>
      )}

      {/* 分页 */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-gray-500">共 {total} 条记录</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="p-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-gray-600 px-2">{page} / {Math.ceil(total / PAGE_SIZE)}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= Math.ceil(total / PAGE_SIZE)}
              className="p-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
