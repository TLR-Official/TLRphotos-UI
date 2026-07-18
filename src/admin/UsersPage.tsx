import { useState, useEffect } from 'react';
import { Search, User, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { getUsers, toggleUser } from './api';
import type { User as AdminUser } from './types';

export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [page, keyword]);

  const fetchUsers = async () => {
    setLoading(true);
    const result = await getUsers(page, pageSize, keyword);
    if (result.success && result.data) {
      setUsers(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
  };

  const handleToggle = async (id: string, currentStatus: number) => {
    setActionLoading(id);
    const result = await toggleUser(id);
    if (result.success) {
      setUsers(users.map(u => u.id === id ? { ...u, is_active: currentStatus ? 0 : 1 } : u));
    }
    setActionLoading(null);
  };

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setPage(newPage);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">用户管理</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPage(1); }}
            placeholder="搜索用户名或邮箱..."
            className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-white text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">用户</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">邮箱</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">状态</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">注册时间</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-t border-slate-700">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm">
                          <User className="w-4 h-4" />
                        </div>
                        <span className="text-white">{user.username || user.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-sm ${
                        user.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {user.is_active ? '正常' : '禁用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{new Date(user.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(user.id, user.is_active)}
                        disabled={actionLoading === user.id}
                        className={`p-2 rounded-lg transition-colors ${
                          user.is_active
                            ? 'text-green-400 hover:text-green-300 hover:bg-green-500/10'
                            : 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
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
              <div className="text-center py-10 text-slate-400">暂无用户</div>
            )}
          </div>

          <div className="flex items-center justify-between mt-6">
            <p className="text-slate-400">共 {total} 条记录</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="p-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-slate-300 px-2">{page} / {Math.ceil(total / pageSize)}</span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= Math.ceil(total / pageSize)}
                className="p-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg transition-colors"
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