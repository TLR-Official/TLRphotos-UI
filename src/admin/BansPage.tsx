/**
 * 用户封禁管理页（V4.1.0）
 * 统一处罚入口：搜索选择用户 → 三级处罚表单（L1 警告 / L2 功能封禁按项勾选 / L3 直接封禁）
 * → 多重确认弹窗（摘要卡 + 红色二次警示）→ 人机验证门 → 提交并刷新处罚历史。
 * 处罚历史区支持撤销/解除（L1 仅 super，L2/L3 super/zone_master）。
 * 页面级角色门：仅 super / zone_master 可访问。
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, User, X, ShieldAlert, Gavel, Undo2, Ban } from 'lucide-react';
import { getUsers, getUserPenalties, penalizeUser, revokePenalty, submitAdminVerification } from './api';
import { useHumanVerification } from '../shared/useHumanVerification';
import { MobileReadOnlyNotice } from './MobileReadOnlyNotice';
import { UserTitleBadge } from '../shared/UserTitleBadge';
import type { User as SiteUser, Penalty, AdminUser } from './types';

/** 期限下拉选项（天） */
const PENALTY_DAYS_OPTIONS = [30, 60, 90, 120, 180, 270, 360];

/** L2 功能封禁四项能力配置 */
const CAP_OPTIONS: { key: string; label: string }[] = [
  { key: 'upload', label: '上传图片' },
  { key: 'comment', label: '发评论' },
  { key: 'forum_post', label: '论坛发帖' },
  { key: 'download', label: '下载图片' },
];

/** 三级处罚元信息（名称 + 徽章配色 + 说明） */
const LEVEL_META: Record<1 | 2 | 3, { label: string; badge: string; desc: string }> = {
  1: { label: '警告', badge: 'bg-blue-50 text-blue-700 border-blue-200', desc: '仅留痕与通知，不限制任何能力' },
  2: { label: '功能封禁', badge: 'bg-orange-100 text-orange-700 border-orange-200', desc: '按项勾选封禁能力，30~360 天到期自动恢复' },
  3: { label: '直接封禁', badge: 'bg-red-100 text-red-700 border-red-200', desc: '账号封禁并强制下线，永久或限时' },
};

/** 选中的处罚目标（搜索命中为完整用户；URL 预选未命中时仅含 id） */
interface SelectedTarget {
  id: string;
  username?: string;
  email?: string | null;
  avatar_url?: string;
  is_active?: number;
  banned_at?: string | null;
  /** V4.7.0：邀请码授予的专属称号（未获称号为 null） */
  user_title?: string | null;
}

/**
 * 用户封禁管理页组件
 * @param currentAdmin 当前登录管理员（页面级角色门与撤销按钮角色判断）
 * @returns 角色门占位 / 用户选择 + 处罚表单 + 处罚历史 JSX
 */
export function BansPage({ currentAdmin }: { currentAdmin?: AdminUser | null }) {
  const [searchParams] = useSearchParams();
  const role = currentAdmin?.role;
  const allowed = role === 'super' || role === 'zone_master';

  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification({
    description: '实施处罚与撤销处罚为高危管理操作，需完成人机验证。验证通过后 7 天内同一网络环境下无需重复验证。',
    submitFn: submitAdminVerification,
  });

  // 用户搜索与选择
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SiteUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  const [targetIsAdmin, setTargetIsAdmin] = useState(false);
  const [history, setHistory] = useState<Penalty[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 处罚表单
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [caps, setCaps] = useState<string[]>([]);
  const [l3Permanent, setL3Permanent] = useState(true);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState('');

  // 多重确认：0=未打开，1=摘要确认弹窗，2=红色二次警示弹窗
  const [confirmStep, setConfirmStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  /**
   * 选中处罚目标并加载其处罚历史
   * 处罚历史接口对非站点用户返回 404，据此识别管理员目标并显示「仅留痕」提示。
   * URL 预选且无昵称时，先反查用户资料（用户名/邮箱模糊匹配后按 id 精确命中）。
   * @param target 目标（搜索命中用户或 URL 预选的最小 stub）
   */
  const selectTarget = async (target: SelectedTarget) => {
    setSelected(target);
    setTargetIsAdmin(false);
    setNotice(null);
    setHistoryLoading(true);
    if (!target.username) {
      const found = await getUsers(1, 20, target.id);
      const match = found.data?.find((u) => u.id === target.id);
      if (match) {
        setSelected(match);
        target = match;
      }
    }
    const res = await getUserPenalties(target.id);
    if (res.success && res.data) {
      setHistory(res.data);
    } else {
      setHistory([]);
      setTargetIsAdmin(true);
    }
    setHistoryLoading(false);
  };

  // URL ?userId=xxx 预选
  useEffect(() => {
    const uid = searchParams.get('userId');
    if (uid) selectTarget({ id: uid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 按关键字搜索站点用户（用户名/邮箱模糊匹配） */
  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    const res = await getUsers(1, 20, keyword.trim());
    if (res.success && res.data) {
      setResults(res.data);
    } else {
      setResults([]);
      setNotice({ type: 'error', text: '搜索用户失败，请稍后重试' });
    }
    setSearched(true);
    setSearching(false);
  };

  /** 切换 L2 能力勾选 */
  const toggleCap = (key: string) => {
    setCaps(caps.includes(key) ? caps.filter((c) => c !== key) : [...caps, key]);
  };

  /** 表单校验：通过返回 null，否则返回错误文案 */
  const validateForm = (): string | null => {
    if (!selected) return '请先选择处罚用户';
    const trimmed = reason.trim();
    if (!trimmed) return '请填写处罚原因';
    if (trimmed.length > 500) return '处罚原因不可超过 500 字';
    if (level === 2 && caps.length === 0) return '功能封禁至少勾选一项能力';
    return null;
  };

  /** 点击「提交处罚」：先校验，通过后进入第一重确认 */
  const startConfirm = () => {
    const err = validateForm();
    if (err) {
      setNotice({ type: 'error', text: err });
      return;
    }
    setNotice(null);
    setConfirmStep(1);
  };

  /** 组装提交参数并实施处罚（挂人机验证门），成功后刷新历史并重置表单 */
  const submitPenalty = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    const result = await verificationGuard('admin_user_admin', () =>
      penalizeUser(
        selected.id,
        level,
        reason.trim(),
        level === 2 ? caps : undefined,
        level === 2 ? days : level === 3 && !l3Permanent ? days : undefined
      )
    );
    if (result.success) {
      setNotice({ type: 'success', text: result.message || '处罚已生效' });
      setConfirmStep(0);
      setReason('');
      setCaps([]);
      setLevel(1);
      setL3Permanent(true);
      setDays(30);
      await selectTarget({ ...selected });
    } else {
      setNotice({ type: 'error', text: result.message || '处罚提交失败' });
      setConfirmStep(0);
    }
    setSubmitting(false);
  };

  /** 撤销/解除按钮可见性：L1 仅 super；L2/L3 super/zone_master（页面角色门已保证） */
  const canRevoke = (p: Penalty) => (p.level === 1 ? role === 'super' : true);

  /** 撤销/解除处罚：confirm → 人机验证门 → 刷新历史；BAN_MANAGE_DENIED 提示无权限 */
  const handleRevoke = async (p: Penalty) => {
    if (revokingId) return;
    if (!confirm(`确定撤销该处罚？\n等级：${LEVEL_META[p.level].label}\n原因：${p.reason}`)) return;
    setRevokingId(p.id);
    const result = await verificationGuard('admin_user_admin', () => revokePenalty(p.id));
    if (result.success) {
      setNotice({ type: 'success', text: result.message || '处罚已撤销' });
      if (selected) await selectTarget({ ...selected });
    } else if (result.code === 'BAN_MANAGE_DENIED') {
      setNotice({ type: 'error', text: '无权撤销该处罚：一级警告仅超级管理员可撤销' });
    } else {
      setNotice({ type: 'error', text: result.message || '撤销失败' });
    }
    setRevokingId(null);
  };

  /** 渲染目标状态徽章（封禁 > 禁用 > 正常；URL 预选未解析资料时不显示） */
  const renderTargetBadge = (target: SelectedTarget) => {
    if (target.banned_at) {
      return <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 font-medium">已封禁</span>;
    }
    if (target.is_active === 0) {
      return <span className="px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-600">禁用</span>;
    }
    if (target.is_active !== undefined) {
      return <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">正常</span>;
    }
    return null;
  };

  /** 当前活跃处罚（未撤销且未到期） */
  const activePenalties = history.filter(
    (p) => !p.revoked_at && (!p.expires_at || new Date(p.expires_at).getTime() > Date.now())
  );

  /** 摘要确认弹窗中的期限/能力描述 */
  const confirmSummary = level === 1
    ? '警告（不限制能力）'
    : level === 2
      ? `封禁 ${caps.map((c) => CAP_OPTIONS.find((o) => o.key === c)?.label ?? c).join('、')} · ${days} 天`
      : l3Permanent ? '永久封禁账号' : `封禁账号 ${days} 天`;

  // 页面级角色门：非 super/zone_master 显示无权限占位
  if (!allowed) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">用户封禁管理</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <ShieldAlert className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-800 font-medium">无权限访问</p>
          <p className="text-sm text-gray-500 mt-2">用户封禁管理仅对超级管理员与分区总审核开放。</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {verificationModal}
      <MobileReadOnlyNotice />
      <h2 className="text-2xl font-bold text-gray-800 mb-6">用户封禁管理</h2>

      {/* 操作结果提示 */}
      {notice && (
        <div className={`mb-4 text-sm rounded-lg px-4 py-2 border ${
          notice.type === 'success'
            ? 'text-green-700 bg-green-50 border-green-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左列：用户选择 + 处罚表单 */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4">选择用户</h3>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索用户名或邮箱..."
                  className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || !keyword.trim()}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {searching ? '搜索中...' : '搜索'}
              </button>
            </div>

            {/* 搜索结果列表 */}
            {searched && (
              <div className="mt-3 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">未找到匹配用户</p>
                ) : (
                  results.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => { selectTarget(u); setSearched(false); setKeyword(''); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left transition-colors"
                    >
                      {u.avatar_url ? (
                        <img src={u.avatar_url.startsWith('/') ? `/api${u.avatar_url}` : u.avatar_url} alt={u.username || ''} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                      <span className="text-sm text-gray-800 flex-1 flex items-center">
                        <span className="truncate">{u.username || u.email}</span>
                        <UserTitleBadge title={u.user_title} />
                      </span>
                      <span className="text-xs text-gray-400">{u.id.slice(0, 8)}…</span>
                      {renderTargetBadge(u)}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* 当前选中目标卡片 */}
            {selected && (
              <div className="mt-4 p-3 rounded-lg bg-gray-50 flex items-center gap-3 flex-wrap">
                {selected.avatar_url ? (
                  <img src={selected.avatar_url.startsWith('/') ? `/api${selected.avatar_url}` : selected.avatar_url} alt={selected.username || ''} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white">
                    <User className="w-5 h-5" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {selected.username || selected.email || '未知用户'}
                    <UserTitleBadge title={selected.user_title} />
                  </p>
                  <p className="text-xs text-gray-500">ID：{selected.id}</p>
                </div>
                {renderTargetBadge(selected)}
                {/* 活跃处罚摘要徽章 */}
                {activePenalties.map((p) => (
                  <span key={p.id} className={`px-2 py-0.5 rounded text-xs border font-medium ${LEVEL_META[p.level].badge}`}>
                    {LEVEL_META[p.level].label}
                    {p.expires_at ? ` · 至 ${new Date(p.expires_at).toLocaleDateString('zh-CN')}` : p.level === 3 ? ' · 永久' : ''}
                  </span>
                ))}
                <button onClick={() => { setSelected(null); setHistory([]); setTargetIsAdmin(false); }} className="text-gray-400 hover:text-gray-600" title="清除选择">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 管理员目标提示：处罚历史 404 = 非站点用户 */}
            {selected && targetIsAdmin && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
                <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>该 ID 不属于站点用户：若为管理员账号，处罚仅作留痕记录，不产生实际封禁效果。</span>
              </div>
            )}
          </div>

          {/* 处罚表单 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4">处罚等级</h3>
            <div className="space-y-2">
              {([1, 2, 3] as const).map((lv) => (
                <label key={lv} className="flex items-start p-3 rounded-lg bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="penalty-level"
                    checked={level === lv}
                    onChange={() => setLevel(lv)}
                    className="mt-0.5 accent-blue-700"
                  />
                  <span className="ml-2">
                    <span className="block text-sm font-medium text-gray-800">
                      {lv} 级处罚：{LEVEL_META[lv].label}
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">{LEVEL_META[lv].desc}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* L2：能力四项勾选 + 期限下拉 */}
            {level === 2 && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-gray-700">封禁能力（至少勾选一项）：</p>
                <div className="grid grid-cols-2 gap-2">
                  {CAP_OPTIONS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={caps.includes(key)}
                        onChange={() => toggleCap(key)}
                        className="accent-blue-700"
                      />
                      <span className="text-sm text-gray-800">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-700 flex-shrink-0">封禁期限</label>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                  >
                    {PENALTY_DAYS_OPTIONS.map((d) => (
                      <option key={d} value={d}>{d} 天</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* L3：永久/限时切换 */}
            {level === 3 && (
              <div className="mt-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setL3Permanent(true)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      l3Permanent ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    永久
                  </button>
                  <button
                    onClick={() => setL3Permanent(false)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      !l3Permanent ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    限时
                  </button>
                </div>
                {!l3Permanent && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700 flex-shrink-0">封禁期限</label>
                    <select
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                    >
                      {PENALTY_DAYS_OPTIONS.map((d) => (
                        <option key={d} value={d}>{d} 天</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* 处罚原因 */}
            <div className="mt-4">
              <label className="block text-sm text-gray-700 mb-1">处罚原因（必填，将通知用户，≤500 字）</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                className="w-full h-24 p-3 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="请输入处罚原因..."
              />
            </div>

            <button
              onClick={startConfirm}
              disabled={!selected}
              className="mt-4 w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Gavel className="w-4 h-4" />
              提交处罚
            </button>
          </div>
        </div>

        {/* 右列：处罚历史 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 self-start">
          <h3 className="text-base font-semibold text-gray-800 mb-4">处罚历史</h3>
          {!selected ? (
            <p className="text-sm text-gray-500 text-center py-10">请先在左侧选择用户</p>
          ) : historyLoading ? (
            <p className="text-sm text-gray-500 text-center py-10">加载中...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">{targetIsAdmin ? '管理员账号暂无处罚记录' : '该用户暂无处罚记录'}</p>
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              {history.map((p) => (
                <div key={p.id} className={`p-3 rounded-lg border ${p.revoked_at ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${LEVEL_META[p.level].badge}`}>
                      {LEVEL_META[p.level].label}
                    </span>
                    {/* 期限/能力摘要 */}
                    <span className="text-xs text-gray-500">
                      {p.level === 2 && p.capabilities.length > 0 && (
                        `${p.capabilities.map((c) => CAP_OPTIONS.find((o) => o.key === c)?.label ?? c).join('、')} · `
                      )}
                      {p.level === 1 ? '' : p.expires_at ? `${p.days ?? '-'} 天` : '永久'}
                    </span>
                    {p.revoked_at ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">已撤销</span>
                    ) : (
                      canRevoke(p) && (
                        <button
                          onClick={() => handleRevoke(p)}
                          disabled={revokingId === p.id}
                          title={p.level === 1 ? '撤销警告' : '解除处罚'}
                          className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          {p.level === 1 ? '撤销' : '解除'}
                        </button>
                      )
                    )}
                  </div>
                  <p className="text-sm text-gray-800 mt-2">{p.reason}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                    {p.expires_at && !p.revoked_at && <span>到期：{new Date(p.expires_at).toLocaleString('zh-CN')}</span>}
                    {p.created_by_name && <span>操作人：{p.created_by_name}</span>}
                    <span className="ml-auto">{new Date(p.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                  {p.revoked_at && (
                    <p className="text-xs text-gray-400 mt-1">撤销时间：{new Date(p.revoked_at).toLocaleString('zh-CN')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 第一重确认：处罚摘要卡 */}
      {confirmStep === 1 && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => !submitting && setConfirmStep(0)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">确认处罚</h3>
              <button onClick={() => setConfirmStep(0)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">用户</span><span className="font-medium text-gray-800">{selected.username || selected.email || selected.id}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-500">处罚等级</span><span className={`px-2 py-0.5 rounded text-xs font-medium border ${LEVEL_META[level].badge}`}>{level} 级 · {LEVEL_META[level].label}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">内容</span><span className="font-medium text-gray-800 text-right">{confirmSummary}</span></div>
              <div>
                <p className="text-gray-500 mb-1">原因</p>
                <p className="text-gray-800 whitespace-pre-wrap p-3 rounded-lg bg-gray-50">{reason.trim()}</p>
              </div>
              {targetIsAdmin && (
                <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">注意：目标为管理员账号，处罚仅作留痕记录。</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setConfirmStep(0)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors">取消</button>
              <button onClick={() => setConfirmStep(2)} className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg transition-colors">下一步</button>
            </div>
          </div>
        </div>
      )}

      {/* 第二重确认：红色警示 */}
      {confirmStep === 2 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
              <Ban className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-red-600 mb-2">高危操作警示</h3>
            <p className="text-sm text-gray-800 mb-1">此操作将立即生效，确认执行？</p>
            <p className="text-xs text-gray-500 mb-5">处罚将通知用户{level === 3 ? '并强制其下线' : ''}，请再次确认。</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmStep(0)} disabled={submitting} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg transition-colors">返回</button>
              <button onClick={submitPenalty} disabled={submitting} className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors">
                {submitting ? '执行中...' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
