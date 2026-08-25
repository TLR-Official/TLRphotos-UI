/**
 * 用户管理页
 * 分页展示普通用户列表，支持按用户名或邮箱搜索、启用/禁用、封禁/解封、
 * 精细化功能权限控制（上传/查看/下载/点赞）。所有操作有 loading 态防重复点击。
 */
import { useState, useEffect } from 'react';
import { Search, User, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight, Ban, ShieldCheck, Settings, X } from 'lucide-react';
import { getUsers, toggleUser, banUser, unbanUser, updateUserPermissions } from './api';
import type { User as AdminUser } from './types';

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
    const result = await banUser(user.id);
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
    const result = await unbanUser(user.id);
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
    const result = await updateUserPermissions(permUser.id, { [field]: newValue });
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
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">用户管理</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPage(1); }}
            placeholder="搜索用户名或邮箱..."
            className="pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
    </div>
  );
}
