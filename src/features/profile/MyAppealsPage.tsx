/**
 * @file 我的申诉页（移动端适配）
 * @description
 *  展示当前登录用户的全部申诉记录：单列状态卡，状态徽章清晰区分
 *  （待处理/已通过/已驳回/已撤回），待处理申诉可撤回。
 *  数据来源：GET /api/my-appeals（创建时间倒序）、DELETE /api/my-appeals/:id。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../shared/UserContext';
import { getMyAppeals, withdrawAppeal } from '../../api/appeals';
import type { AppealStatus, MyAppeal } from '../../api/appeals';
import { MobileBackHeader } from '../../shared/MobileBackHeader';

/** 申诉状态徽章样式映射（白底浅色系，状态语义清晰） */
const STATUS_BADGE: Record<AppealStatus, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  approved: { label: '申诉已通过', className: 'bg-green-50 text-green-700 border-green-200' },
  rejected: { label: '申诉未通过', className: 'bg-red-50 text-red-700 border-red-200' },
  withdrawn: { label: '已撤回', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

/** 格式化时间为中文短格式 */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 我的申诉页组件
 * @returns 未登录引导 / 申诉状态卡单列 JSX
 */
export function MyAppealsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useUser();

  const [appeals, setAppeals] = useState<MyAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  /** 拉取本人申诉列表 */
  const fetchAppeals = () => {
    if (!user?.id) return;
    setLoading(true);
    getMyAppeals()
      .then((res) => {
        if (res.success && res.data) setAppeals(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAppeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /** 展示操作提示（3 秒自动清空） */
  const showNotice = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 3000);
  };

  /** 撤回待处理申诉（仅 pending 可撤，撤回后可重新发起） */
  const handleWithdraw = async (appeal: MyAppeal) => {
    if (withdrawingId) return;
    if (!confirm('确定撤回该申诉吗？撤回后可重新发起。')) return;
    setWithdrawingId(appeal.id);
    const result = await withdrawAppeal(appeal.id);
    if (result.success) {
      fetchAppeals();
      showNotice('申诉已撤回');
    } else {
      showNotice(result.message || '撤回失败');
    }
    setWithdrawingId(null);
  };

  // 未登录引导
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">我的申诉</h1>
          <p className="text-gray-500 mb-6">登录后即可查看您的申诉记录</p>
          <button
            onClick={() => navigate('/auth')}
            className="h-12 px-6 rounded-lg font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 移动端返回头部（仅 ≤768px 渲染） */}
      <MobileBackHeader title="我的申诉" />
      <div className="max-w-3xl mx-auto px-4 py-8 max-md:py-4">
        {/* 桌面端页头（移动端由 MobileBackHeader 承载标题） */}
        <div className="mb-6 max-md:hidden">
          <h1 className="text-2xl font-bold text-gray-800">我的申诉</h1>
          <p className="text-sm text-gray-500 mt-1">共 {appeals.length} 条申诉记录</p>
        </div>

        {/* 操作提示（3 秒自动清空） */}
        {notice && (
          <p className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            {notice}
          </p>
        )}

        {/* 加载状态 */}
        {loading && <div className="text-center py-12 text-gray-500">加载中...</div>}

        {/* 空态 */}
        {!loading && appeals.length === 0 && (
          <div className="text-center py-12 text-gray-500">暂无申诉记录</div>
        )}

        {/* 申诉状态卡：单列 */}
        {!loading && appeals.length > 0 && (
          <div className="space-y-3">
            {appeals.map((appeal) => {
              const badge = STATUS_BADGE[appeal.status] ?? STATUS_BADGE.withdrawn;
              return (
                <div
                  key={appeal.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  {/* 标题行：状态徽章 + 作品 + 时间 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <button
                      onClick={() => navigate(`/photos/${appeal.photo_id}`)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-800"
                    >
                      {appeal.photo_title || '作品已删除'}
                    </button>
                    <span className="text-xs text-gray-400">{formatTime(appeal.created_at)}</span>
                  </div>

                  {/* 申诉理由 */}
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-1">申诉理由：</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                      {appeal.reason}
                    </p>
                  </div>

                  {/* 裁决答复 */}
                  {appeal.response && (
                    <div className="mt-3 rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500 mb-1">
                        裁决答复（{formatTime(appeal.decided_at)}）：
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                        {appeal.response}
                      </p>
                    </div>
                  )}

                  {/* 仅待处理可撤回 */}
                  {appeal.status === 'pending' && (
                    <button
                      onClick={() => handleWithdraw(appeal)}
                      disabled={withdrawingId === appeal.id}
                      className="mt-3 h-12 w-full rounded-lg bg-gray-100 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
                    >
                      {withdrawingId === appeal.id ? '撤回中...' : '撤回申诉'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
