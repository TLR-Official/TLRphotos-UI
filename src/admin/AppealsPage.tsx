/**
 * 申诉裁决页（V4.0.0）
 * 管理端申诉列表：状态筛选 tabs（pending 优先由后端排序）+ 每条「通过/驳回」操作。
 * 裁决答复 response 必填（后端对 approve/reject 均校验）：
 * 通过 → 照片恢复 approved 并推送通过回执；驳回 → 维持 rejected 并推送驳回回执。
 * 数据来源：GET /api/admin/appeals、PUT /api/admin/appeals/:id/decide。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getAppeals, decideAppeal } from './api';
import type { Appeal, AppealStatus } from './types';

/** 每页数量 */
const PAGE_SIZE = 20;

/** 状态筛选 tabs 配置 */
const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: '待处理' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
  { key: 'withdrawn', label: '已撤回' },
  { key: '', label: '全部' },
];

/** 申诉状态徽章样式映射 */
const STATUS_BADGE: Record<AppealStatus, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  approved: { label: '已通过', className: 'bg-green-100 text-green-700 border-green-200' },
  rejected: { label: '已驳回', className: 'bg-red-100 text-red-700 border-red-200' },
  withdrawn: { label: '已撤回', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

/**
 * 格式化时间为中文短格式
 * @param iso ISO 时间字符串或 null
 */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 申诉裁决页组件
 * @returns 申诉列表 + 裁决弹窗 JSX
 */
export function AppealsPage() {
  const navigate = useNavigate();
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  // 错误提示（列表加载失败等）
  const [error, setError] = useState('');

  // 裁决弹窗状态：目标申诉 + 结论；response 必填
  const [decideTarget, setDecideTarget] = useState<{ appeal: Appeal; decision: 'approve' | 'reject' } | null>(null);
  const [decideResponse, setDecideResponse] = useState('');
  const [decideLoading, setDecideLoading] = useState(false);

  // 状态或页码变化时重新拉取
  useEffect(() => {
    fetchAppeals();
  }, [status, page]);

  /** 按当前筛选拉取申诉列表 */
  const fetchAppeals = async () => {
    setLoading(true);
    setError('');
    const result = await getAppeals((status || undefined) as AppealStatus | undefined, page, PAGE_SIZE);
    if (result.success && result.data) {
      setAppeals(result.data);
      setTotal(result.pagination?.total || 0);
    } else {
      setError(result.message || '加载申诉列表失败');
    }
    setLoading(false);
  };

  /** 切换状态筛选（重置到第一页） */
  const handleStatusChange = (key: string) => {
    setStatus(key);
    setPage(1);
  };

  /** 打开裁决弹窗 */
  const openDecide = (appeal: Appeal, decision: 'approve' | 'reject') => {
    setDecideTarget({ appeal, decision });
    setDecideResponse('');
  };

  /** 提交裁决：调用成功后关闭弹窗并刷新列表 */
  const handleDecide = async () => {
    if (!decideTarget || !decideResponse.trim() || decideLoading) return;
    setDecideLoading(true);
    const result = await decideAppeal(decideTarget.appeal.id, decideTarget.decision, decideResponse.trim());
    if (result.success) {
      setDecideTarget(null);
      setDecideResponse('');
      await fetchAppeals();
    } else {
      alert(result.message || '裁决失败');
    }
    setDecideLoading(false);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">申诉裁决</h2>
          <p className="text-sm text-gray-500 mt-1">共 {total} 条申诉（待处理优先展示）</p>
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

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {error}
          <button onClick={fetchAppeals} className="ml-3 underline">重试</button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <div className="space-y-3">
          {appeals.map((appeal) => {
            const badge = STATUS_BADGE[appeal.status] ?? STATUS_BADGE.withdrawn;
            return (
              <div key={appeal.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="text-sm text-gray-800">
                    申诉人：<span className="font-medium">{appeal.appellant_name || '未知用户'}</span>
                  </span>
                  <span className="text-sm text-gray-500">
                    作品：
                    <button
                      onClick={() => navigate(`/admin/photos/${appeal.photo_id}`)}
                      className="text-blue-700 hover:underline"
                    >
                      {appeal.photo_title || appeal.photo_id}
                    </button>
                  </span>
                  <span className="ml-auto text-xs text-gray-400">
                    {formatTime(appeal.created_at)}
                  </span>
                </div>

                <div className="mt-3 text-sm">
                  <p className="text-gray-500 text-xs mb-1">申诉理由：</p>
                  <p className="text-gray-800 whitespace-pre-wrap">{appeal.reason}</p>
                </div>

                {appeal.response && (
                  <div className="mt-3 text-sm">
                    <p className="text-gray-500 text-xs mb-1">裁决答复（{formatTime(appeal.decided_at)}）：</p>
                    <p className="text-gray-600 whitespace-pre-wrap">{appeal.response}</p>
                  </div>
                )}

                {/* 仅待处理申诉可裁决 */}
                {appeal.status === 'pending' && (
                  <div className="mt-4 flex gap-3 justify-end">
                    <button
                      onClick={() => openDecide(appeal, 'reject')}
                      disabled={decideLoading}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      驳回
                    </button>
                    <button
                      onClick={() => openDecide(appeal, 'approve')}
                      disabled={decideLoading}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      通过
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {appeals.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 text-center py-10 text-gray-500">
              该状态下暂无申诉
            </div>
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

      {/* 裁决弹窗：答复必填（后端 approve/reject 均校验 response） */}
      {decideTarget && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => !decideLoading && setDecideTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-1">
              {decideTarget.decision === 'approve' ? '通过申诉' : '驳回申诉'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {decideTarget.decision === 'approve'
                ? '通过后作品将恢复为「已通过」状态，并通知申诉人。'
                : '驳回后作品维持「未通过」状态，并通知申诉人。'}
            </p>
            <label className="block text-sm text-gray-700 mb-1">裁决答复（必填，将作为回执内容通知申诉人）</label>
            <textarea
              value={decideResponse}
              onChange={(e) => setDecideResponse(e.target.value)}
              className="w-full h-28 p-3 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-700"
              placeholder="请输入裁决答复..."
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setDecideTarget(null)}
                disabled={decideLoading}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDecide}
                disabled={!decideResponse.trim() || decideLoading}
                className={`flex-1 py-2 disabled:bg-gray-300 text-white rounded-lg transition-colors ${
                  decideTarget.decision === 'approve'
                    ? 'bg-blue-700 hover:bg-blue-800'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {decideLoading ? '提交中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
