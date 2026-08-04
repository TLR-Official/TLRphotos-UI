/**
 * 用户管理页
 * 分页展示普通用户列表，支持按用户名或邮箱搜索、启用/禁用指定用户。
 */
import { useState, useEffect } from 'react';
import { Search, User, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { getUsers, toggleUser } from './api';
import type { User as AdminUser } from './types';

/**
 * 用户管理页组件
 * @returns 加载态 / 用户表格 + 搜索框 + 分页 JSX
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
   * 切换分页（带边界校验）
   * @param newPage 目标页码
   */
  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setPage(newPage);
    }
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
                {users.map(user => (
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
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-sm ${
                        user.is_active ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                      }`}>
                        {user.is_active ? '正常' : '禁用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{new Date(user.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(user.id, user.is_active)}
                        disabled={actionLoading === user.id}
                        className={`p-2 rounded-lg transition-colors ${
                          user.is_active
                            ? 'text-green-600 hover:text-green-700 hover:bg-green-100'
                            : 'text-red-600 hover:text-red-700 hover:bg-red-100'
                        }`}
                      >
                        {user.is_active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}