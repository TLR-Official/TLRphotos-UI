/**
 * 用户管理页
 * 分页展示普通用户列表，支持按用户名或邮箱搜索、启用/禁用、封禁/解封、
 * 精细化功能权限控制（上传/查看/下载/点赞）、一级/二级处罚与处罚历史查看。
 * 所有高危操作挂管理员人机验证门，操作有 loading 态防重复点击。
 * V4.0.0：新增「处罚」对话框（一级=限制上传 N 天 / 二级=永久封禁，原因必填）与「处罚历史」查看。
 */
import { useState, useEffect } from 'react';
import { Search, User, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight, Ban, ShieldCheck, Settings, X } from 'lucide-react';
import { getUsers, toggleUser, banUser, unbanUser, updateUserPermissions, submitAdminVerification, penalizeUser, getUserPenalties } from './api';
import { useHumanVerification } from '../shared/useHumanVerification';
import type { User as AdminUser, Penalty } from './types';

/** 权限弹窗中四项功能权限的配置（label + 字段 key） */
const PERMISSION_FIELDS: { key: 'can_upload' | 'can_view' | 'can_download' | 'can_like'; label: string; desc: string }[] = [
  { key: 'can_upload', label: '上传图片', desc: '禁止后用户无法上传新照片' },
  { key: 'can_view', label: '查看图片', desc: '禁止后登录态无法查看图片详情（匿名仍可公开浏览）' },
  { key: 'can_download', label: '下载图片', desc: '禁止后无法下载图片（下载需登录）' },
  { key: 'can_like', label: '点赞', desc: '禁止后无法点赞或取消点赞' },
];

/**
 * 用户管理页组件
 * @returns 加载态 / 用户表格 + 搜索框 + 分页 + 权限弹窗 JSX
 */
export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  // V1.8.0：人机验证门（封禁/解封/权限变更为高危管理操作，走管理员验证接口）
  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification({
    description: '封禁、解封与权限变更为高危管理操作，需完成人机验证。验证通过后 7 天内同一网络环境下无需重复验证。',
    submitFn: submitAdminVerification,
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  // 当前操作中的用户 id，用于禁用对应行按钮，避免重复点击
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // 权限弹窗：正在编辑权限的用户（null 时弹窗关闭）
  const [permUser, setPermUser] = useState<AdminUser | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  // V4.0.0 处罚弹窗状态：目标用户 / 级别 / 天数 / 原因
  const [penaltyUser, setPenaltyUser] = useState<AdminUser | null>(null);
  const [penaltyLevel, setPenaltyLevel] = useState<1 | 2>(1);
  const [penaltyDays, setPenaltyDays] = useState('7');
  const [penaltyReason, setPenaltyReason] = useState('');
  const [penaltyLoading, setPenaltyLoading] = useState(false);
  // V4.0.0 处罚历史弹窗状态
  const [historyUser, setHistoryUser] = useState<AdminUser | null>(null);
  const [historyList, setHistoryList] = useState<Penalty[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // page 或 keyword 变化时重新拉取用户列表（注意：keyword 即时触发，未做防抖）
  useEffect(() => {
    fetchUsers();
  }, [page, keyword]);

  /** 按当前页码与关键字拉取用户列表 */
  const fetchUsers = async () => {
    setLoading(true);
    const result = await getUsers(page, pageSize, keyword);
    if (result.success && result.data) {
      setUsers(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
  };

  /**
   * 切换用户启用/禁用状态
   * 成功后本地翻转 is_active 字段，无需重新拉取列表。
   * @param id 用户 id
   * @param currentStatus 当前状态（1 启用 / 0 禁用）
   */
  const handleToggle = async (id: string, currentStatus: number) => {
    setActionLoading(id);
    const result = await toggleUser(id);
    if (result.success) {
      setUsers(users.map(u => u.id === id ? { ...u, is_active: currentStatus ? 0 : 1 } : u));
    }
    setActionLoading(null);
  };

  /**
   * 封禁用户
   * 成功后本地标记 banned_at + is_active=0。
   * @param user 目标用户
   */
  const handleBan = async (user: AdminUser) => {
    if (!confirm(`确定封禁用户「${user.username || user.email}」？\n封禁后该用户将立即下线且无法登录。`)) return;
    setActionLoading(user.id);
    const result = await verificationGuard('admin_user_admin', () => banUser(user.id));
    if (result.success) {
      const now = new Date().toISOString();
      setUsers(users.map(u => u.id === user.id ? { ...u, is_active: 0, banned_at: now } : u));
    } else {
      alert(result.message || '封禁失败');
    }
    setActionLoading(null);
  };

  /**
   * 解封用户
   * 成功后本地清除 banned_at + is_active=1。
   * @param user 目标用户
   */
  const handleUnban = async (user: AdminUser) => {
    setActionLoading(user.id);
    const result = await verificationGuard('admin_user_admin', () => unbanUser(user.id));
    if (result.success) {
      setUsers(users.map(u => u.id === user.id ? { ...u, is_active: 1, banned_at: null } : u));
    } else {
      alert(result.message || '解封失败');
    }
    setActionLoading(null);
  };

  /**
   * 切换权限弹窗中某项权限
   * 乐观更新本地状态，调用 API 仅传变更项，失败回滚。
   */
  const handlePermToggle = async (field: 'can_upload' | 'can_view' | 'can_download' | 'can_like') => {
    if (!permUser) return;
    const currentValue = permUser[field] ?? 1;
    const newValue = currentValue ? 0 : 1;
    // 乐观更新
    setPermUser({ ...permUser, [field]: newValue });
    setPermLoading(true);
    const result = await verificationGuard('admin_user_admin', () => updateUserPermissions(permUser.id, { [field]: newValue }));
    if (result.success && result.data) {
      // 用服务端返回的快照同步列表与弹窗
      setUsers(users.map(u => u.id === permUser.id ? { ...u, ...result.data } : u));
      setPermUser({ ...permUser, ...result.data });
    } else {
      // 失败回滚
      setPermUser({ ...permUser, [field]: currentValue });
      alert(result.message || '权限更新失败');
    }
    setPermLoading(false);
  };

  /**
   * 切换分页（带边界校验）
   * @param newPage 目标页码
   */
  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setPage(newPage);
    }
  };

  /**
   * 打开处罚对话框（V4.0.0）：重置表单为一级处罚默认值
   * @param user 目标用户
   */
  const openPenalty = (user: AdminUser) => {
    setPenaltyUser(user);
    setPenaltyLevel(1);
    setPenaltyDays('7');
    setPenaltyReason('');
  };

  /**
   * 提交处罚（V4.0.0，高危操作挂人机验证门）
   * 一级=限制上传 N 天（1-365），二级=永久封禁；原因必填，处罚自动推送通知。
   */
  const handlePenalty = async () => {
    if (!penaltyUser || penaltyLoading) return;
    const reason = penaltyReason.trim();
    if (!reason) {
      alert('请填写处罚原因');
      return;
    }
    const days = Number(penaltyDays);
    if (penaltyLevel === 1 && (!Number.isInteger(days) || days < 1 || days > 365)) {
      alert('一级处罚需填写 1-365 的禁传天数');
      return;
    }
    const levelText = penaltyLevel === 1 ? `限制上传 ${days} 天` : '永久封禁账号';
    if (!confirm(`确定对用户「${penaltyUser.username || penaltyUser.email}」执行${levelText}？\n处罚原因：${reason}`)) return;

    setPenaltyLoading(true);
    const result = await verificationGuard('admin_user_admin', () =>
      penalizeUser(penaltyUser.id, penaltyLevel, reason, penaltyLevel === 1 ? days : undefined)
    );
    if (result.success) {
      // 二级处罚同步本地封禁状态；一级处罚不影响列表字段
      if (penaltyLevel === 2) {
        const now = new Date().toISOString();
        setUsers(users.map(u => u.id === penaltyUser.id ? { ...u, is_active: 0, banned_at: now } : u));
      }
      setPenaltyUser(null);
    } else {
      alert(result.message || '处罚失败');
    }
    setPenaltyLoading(false);
  };

  /**
   * 打开处罚历史弹窗（V4.0.0）：拉取该用户处罚记录
   * @param user 目标用户
   */
  const openPenaltyHistory = async (user: AdminUser) => {
    setHistoryUser(user);
    setHistoryList([]);
    setHistoryLoading(true);
    const result = await getUserPenalties(user.id);
    if (result.success && result.data) {
      setHistoryList(result.data);
    } else {
      alert(result.message || '获取处罚历史失败');
    }
    setHistoryLoading(false);
  };

  /**
   * 渲染三态状态徽章
   * - banned_at 非空 → 已封禁（红色）
   * - is_active=0 且未封禁 → 禁用（橙色）
   * - 否则 → 正常（绿色）
   */
  const renderStatusBadge = (user: AdminUser) => {
    if (user.banned_at) {
      return <span className="px-2 py-1 rounded text-sm bg-red-100 text-red-700 font-medium">已封禁</span>;
    }
    if (!user.is_active) {
      return <span className="px-2 py-1 rounded text-sm bg-orange-50 text-orange-600">禁用</span>;
    }
    return <span className="px-2 py-1 rounded text-sm bg-green-50 text-green-600">正常</span>;
  };

  return (
    <div>
      {verificationModal}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">用户管理</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPage(1); }}
            placeholder="搜索用户名或邮箱..."
            className="pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">用户</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">邮箱</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">状态</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">注册时间</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isBanned = !!user.banned_at;
                  return (
                    <tr key={user.id} className="border-t border-gray-200">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm">
                            <User className="w-4 h-4" />
                          </div>
                          <span className="text-gray-800">{user.username || user.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{user.email}</td>
                      <td className="px-4 py-3">{renderStatusBadge(user)}</td>
                      <td className="px-4 py-3 text-gray-600">{new Date(user.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {/* 启用/禁用切换：被封禁时禁用此按钮（先解封再启用/禁用） */}
                          <button
                            onClick={() => handleToggle(user.id, user.is_active)}
                            disabled={actionLoading === user.id || isBanned}
                            title={isBanned ? '请先解封' : (user.is_active ? '禁用' : '启用')}
                            className={`p-2 rounded-lg transition-colors ${
                              isBanned
                                ? 'text-gray-300 cursor-not-allowed'
                                : user.is_active
                                  ? 'text-green-600 hover:text-green-700 hover:bg-green-100 cursor-pointer'
                                  : 'text-red-600 hover:text-red-700 hover:bg-red-100 cursor-pointer'
                            }`}
                          >
                            {user.is_active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                          </button>
                          {/* 封禁/解封按钮 */}
                          <button
                            onClick={() => isBanned ? handleUnban(user) : handleBan(user)}
                            disabled={actionLoading === user.id}
                            title={isBanned ? '解封' : '封禁'}
                            className={`p-2 rounded-lg transition-colors ${
                              isBanned
                                ? 'text-green-600 hover:text-green-700 hover:bg-green-100 cursor-pointer'
                                : 'text-red-600 hover:text-red-700 hover:bg-red-100 cursor-pointer'
                            }`}
                          >
                            {isBanned ? <ShieldCheck className="w-5 h-5" /> : <Ban className="w-5 h-5" />}
                          </button>
                          {/* 权限设置按钮 */}
                          <button
                            onClick={() => setPermUser(user)}
                            title="功能权限"
                            className="p-2 rounded-lg text-gray-600 hover:text-gray-800 hover:bg-gray-100 cursor-pointer transition-colors"
                          >
                            <Settings className="w-5 h-5" />
                          </button>
                          {/* V4.0.0：处罚与处罚历史（纯文字按钮） */}
                          <button
                            onClick={() => openPenalty(user)}
                            disabled={actionLoading === user.id}
                            title="实施处罚（一级禁传 / 二级永久封禁）"
                            className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium transition-colors"
                          >
                            处罚
                          </button>
                          <button
                            onClick={() => openPenaltyHistory(user)}
                            disabled={actionLoading === user.id}
                            title="查看处罚历史"
                            className="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
                          >
                            历史
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {users.length === 0 && (
              <div className="text-center py-10 text-gray-500">暂无用户</div>
            )}
          </div>

          <div className="flex items-center justify-between mt-6">
            <p className="text-gray-500">共 {total} 条记录</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="p-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-gray-600 px-2">{page} / {Math.ceil(total / pageSize)}</span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= Math.ceil(total / pageSize)}
                className="p-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 权限设置弹窗 */}
      {permUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => !permLoading && setPermUser(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">功能权限</h3>
              <button
                onClick={() => !permLoading && setPermUser(null)}
                disabled={permLoading}
                className="text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600 mb-4">
                用户：<span className="font-medium text-gray-800">{permUser.username || permUser.email}</span>
              </p>
              <div className="space-y-3">
                {PERMISSION_FIELDS.map(({ key, label, desc }) => {
                  const value = permUser[key] ?? 1;
                  const allowed = !!value;
                  return (
                    <div key={key} className="flex items-start justify-between p-3 rounded-lg bg-gray-50">
                      <div className="flex-1 mr-3">
                        <p className="text-sm font-medium text-gray-800">{label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                      </div>
                      <button
                        onClick={() => handlePermToggle(key)}
                        disabled={permLoading}
                        className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                          allowed ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${allowed ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-4">所有权限变更均记录审计日志，含操作人与变更内容。</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setPermUser(null)}
                disabled={permLoading}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg cursor-pointer transition-colors disabled:opacity-50"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V4.0.0：处罚对话框（一级=限制上传 N 天 / 二级=永久封禁，原因必填，挂人机验证门） */}
      {penaltyUser && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => !penaltyLoading && setPenaltyUser(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">实施处罚</h3>
              <button
                onClick={() => setPenaltyUser(null)}
                disabled={penaltyLoading}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600">
                用户：<span className="font-medium text-gray-800">{penaltyUser.username || penaltyUser.email}</span>
              </p>

              {/* 处罚级别 */}
              <div className="space-y-2">
                <label className="flex items-start p-3 rounded-lg bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="penalty-level"
                    checked={penaltyLevel === 1}
                    onChange={() => setPenaltyLevel(1)}
                    className="mt-0.5 accent-blue-700"
                  />
                  <span className="ml-2">
                    <span className="block text-sm font-medium text-gray-800">一级处罚：限制上传</span>
                    <span className="block text-xs text-gray-500 mt-0.5">处罚期内用户无法上传新作品，其余功能不受影响</span>
                  </span>
                </label>
                {penaltyLevel === 1 && (
                  <div className="flex items-center gap-2 ml-6">
                    <label className="text-sm text-gray-600 flex-shrink-0">禁传天数（1-365）</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={penaltyDays}
                      onChange={(e) => setPenaltyDays(e.target.value)}
                      className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>
                )}
                <label className="flex items-start p-3 rounded-lg bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="penalty-level"
                    checked={penaltyLevel === 2}
                    onChange={() => setPenaltyLevel(2)}
                    className="mt-0.5 accent-blue-700"
                  />
                  <span className="ml-2">
                    <span className="block text-sm font-medium text-gray-800">二级处罚：永久封禁</span>
                    <span className="block text-xs text-gray-500 mt-0.5">立即封禁账号并强制下线，不可恢复（与封禁按钮等效）</span>
                  </span>
                </label>
              </div>

              {/* 处罚原因（必填） */}
              <div>
                <label className="block text-sm text-gray-700 mb-1">处罚原因（必填，将通知用户）</label>
                <textarea
                  value={penaltyReason}
                  onChange={(e) => setPenaltyReason(e.target.value)}
                  className="w-full h-24 p-3 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-700"
                  placeholder="请输入处罚原因..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setPenaltyUser(null)}
                disabled={penaltyLoading}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handlePenalty}
                disabled={!penaltyReason.trim() || penaltyLoading}
                className={`px-4 py-2 rounded-lg text-white transition-colors disabled:bg-gray-300 ${
                  penaltyLevel === 2 ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                {penaltyLoading ? '提交中...' : '确认处罚'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V4.0.0：处罚历史弹窗 */}
      {historyUser && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setHistoryUser(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">处罚历史</h3>
              <button
                onClick={() => setHistoryUser(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
              {historyLoading ? (
                <p className="text-sm text-gray-500 text-center py-6">加载中...</p>
              ) : historyList.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">该用户暂无处罚记录</p>
              ) : (
                <div className="space-y-3">
                  {historyList.map((p) => (
                    <div key={p.id} className="p-3 rounded-lg bg-gray-50">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                          p.level === 2
                            ? 'bg-red-100 text-red-700 border-red-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {p.level === 2 ? '永久封禁' : `限制上传 ${p.days ?? '-'} 天`}
                        </span>
                        {p.expires_at && (
                          <span className="text-xs text-gray-500">到期：{new Date(p.expires_at).toLocaleString()}</span>
                        )}
                        <span className="ml-auto text-xs text-gray-400">
                          {new Date(p.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 mt-2">{p.reason}</p>
                      {p.created_by_name && (
                        <p className="text-xs text-gray-400 mt-1">操作人：{p.created_by_name}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setHistoryUser(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
