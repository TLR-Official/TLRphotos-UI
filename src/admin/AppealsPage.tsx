/**
 * 申诉裁决页（V4.0.0 / V4.1.2-beta.3）
 * 管理端申诉列表：状态筛选 tabs（pending 优先由后端排序）+ 每条「通过/驳回」操作。
 * 裁决答复 response 必填（后端对 approve/reject 均校验）：
 * 通过 → 照片恢复 approved 并推送通过回执；驳回 → 维持 rejected 并推送驳回回执。
 * V4.1.2-beta.3：新增审核员责任判定 reviewer_fault（none/mistake/violation），
 * 判定有责时后端强制视为申诉成立并写入处分记录（admin_warnings）。
 * 数据来源：GET /api/admin/appeals、PUT /api/admin/appeals/:id/decide。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Gavel } from 'lucide-react';
import { getAppeals, decideAppeal, getAdminWarnings } from './api';
import { MobileReadOnlyNotice } from './MobileReadOnlyNotice';
import type { Appeal, AppealStatus, AdminWarning } from './types';

/** 每页数量 */
const PAGE_SIZE = 20;

/** 审核员责任判定选项（V4.1.2-beta.3） */
const FAULT_OPTIONS: { key: 'none' | 'mistake' | 'violation'; label: string; hint: string }[] = [
  { key: 'none', label: '原审核无责', hint: '按当前裁决结论执行' },
  { key: 'mistake', label: '审核失误', hint: '申诉视为成立，记录警告处分' },
  { key: 'violation', label: '审核违规', hint: '申诉视为成立，记录违规待处罚' },
];

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

/** 责任判定徽章样式映射（仅裁决后展示有责结论） */
const FAULT_BADGE: Record<'mistake' | 'violation', { label: string; className: string }> = {
  mistake: { label: '原审核失误', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  violation: { label: '原审核违规', className: 'bg-red-100 text-red-700 border-red-200' },
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
  // 审核员责任判定：默认无责
  const [decideFault, setDecideFault] = useState<'none' | 'mistake' | 'violation'>('none');
  const [decideLoading, setDecideLoading] = useState(false);

  // 审核员处分记录（仅 super 可见）：非 super 请求返回 403，此处静默隐藏面板
  const [warnings, setWarnings] = useState<AdminWarning[]>([]);
  const [warningsTotal, setWarningsTotal] = useState(0);
  const [showWarnings, setShowWarnings] = useState(false);

  // 状态或页码变化时重新拉取
  useEffect(() => {
    fetchAppeals();
  }, [status, page]);

  /** 拉取审核员处分记录（仅 super 有权限，无权限时静默隐藏） */
  const fetchWarnings = async () => {
    const result = await getAdminWarnings(1, 10);
    if (result.success && result.data) {
      setWarnings(result.data);
      setWarningsTotal(result.pagination?.total || 0);
      setShowWarnings(result.data.length > 0);
    } else {
      setWarnings([]);
      setWarningsTotal(0);
      setShowWarnings(false);
    }
  };

  // 挂载时拉取一次处分记录
  useEffect(() => {
    fetchWarnings();
  }, []);

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
    setDecideFault('none');
  };

  /** 提交裁决：调用成功后关闭弹窗并刷新列表 */
  const handleDecide = async () => {
    if (!decideTarget || !decideResponse.trim() || decideLoading) return;
    setDecideLoading(true);
    const result = await decideAppeal(decideTarget.appeal.id, decideTarget.decision, decideResponse.trim(), decideFault);
    if (result.success) {
      setDecideTarget(null);
      setDecideResponse('');
      setDecideFault('none');
      await fetchAppeals();
      // 有责判定会写入处分记录，刷新面板
      await fetchWarnings();
    } else {
      alert(result.message || '裁决失败');
    }
    setDecideLoading(false);
  };

  return (
    <div>
      <MobileReadOnlyNotice />
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

      {/* 审核员处分记录（仅 super 可见，展示最近 10 条） */}
      {showWarnings && (
        <div className="mb-6 bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <p className="text-sm font-medium text-amber-800">
              审核员处分记录（共 {warningsTotal} 条，展示最近 {warnings.length} 条）
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {warnings.map((w) => (
              <div key={w.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                    w.severity === 'penalty'
                      ? 'bg-red-100 text-red-700 border-red-200'
                      : 'bg-amber-100 text-amber-700 border-amber-200'
                  }`}
                >
                  {w.severity === 'penalty' ? '审核违规' : '审核失误'}
                </span>
                <span className="text-gray-800">{w.admin_name || '未知审核员'}</span>
                {w.photo_title && (
                  <button
                    onClick={() => w.photo_id && navigate(`/admin/photos/${w.photo_id}`)}
                    className="text-blue-700 hover:underline truncate max-w-[180px]"
                  >
                    {w.photo_title}
                  </button>
                )}
                <span className="text-gray-500 truncate max-w-[320px]" title={w.reason}>{w.reason}</span>
                <span className="ml-auto text-xs text-gray-400">
                  记录人：{w.created_by_name || '未知'} · {formatTime(w.created_at)}
                </span>
              </div>
            ))}
          </div>
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
                  {/* 原审核员（申诉指向的审核结论责任人）与责任判定结果 */}
                  <span className="text-sm text-gray-500">
                    原审核员：
                    <span className="text-gray-800">{appeal.reviewer_name || '未知'}</span>
                  </span>
                  {appeal.reviewer_fault && appeal.reviewer_fault !== 'none' && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${FAULT_BADGE[appeal.reviewer_fault].className}`}>
                      {FAULT_BADGE[appeal.reviewer_fault].label}
                    </span>
                  )}
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

                {/* 行操作区：V4.1.0 每行提供「处罚该用户」跳转；待处理申诉追加裁决按钮 */}
                <div className="mt-4 flex gap-3 justify-end">
                  {appeal.user_id && (
                    <button
                      onClick={() => navigate(`/admin/bans?userId=${encodeURIComponent(appeal.user_id)}`)}
                      title="前往用户封禁管理预选该申诉人"
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Gavel className="w-4 h-4" />
                      处罚该用户
                    </button>
                  )}
                  {/* 仅待处理申诉可裁决 */}
                  {appeal.status === 'pending' && (
                    <>
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
                    </>
                  )}
                </div>
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
              {decideFault !== 'none'
                ? '已判定原审核员有责，申诉将视为成立：作品恢复为「已通过」状态并通知申诉人，同时记录审核员处分。'
                : decideTarget.decision === 'approve'
                  ? '通过后作品将恢复为「已通过」状态，并通知申诉人。'
                  : '驳回后作品维持「未通过」状态，并通知申诉人。'}
            </p>
            {/* 审核员责任判定：判定有责时后端强制按申诉成立处理并写入处分记录 */}
            <div className="mb-4">
              <p className="text-sm text-gray-700 mb-2">
                审核员责任判定
                {decideTarget.appeal.reviewer_name && (
                  <span className="text-gray-500">（原审核员：{decideTarget.appeal.reviewer_name}）</span>
                )}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {FAULT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setDecideFault(opt.key)}
                    disabled={decideLoading}
                    title={opt.hint}
                    className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      decideFault === opt.key
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {FAULT_OPTIONS.find((o) => o.key === decideFault)?.hint}
              </p>
            </div>
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
