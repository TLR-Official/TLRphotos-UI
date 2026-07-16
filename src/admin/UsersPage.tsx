import { useState, useEffect } from 'react';
import { Users, Search, Ban, Mail, Calendar } from 'lucide-react';
import { getUsers, toggleUser } from './api';
import type { User } from './types';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      const result = await getUsers();
      if (result.success && result.data) {
        setUsers(result.data);
      }
      setLoading(false);
    };
    fetchUsers();
  }, []);

  const handleToggleStatus = async (userId: string, currentStatus: number) => {
    const result = await toggleUser(userId);
    if (result.success) {
      setUsers(users.map(u => u.id === userId ? { ...u, is_active: currentStatus === 1 ? 0 : 1 } : u));
    }
  };

  const filteredUsers = users.filter(user =>
    (user.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const statusLabel = {
    1: '正常',
    0: '禁用',
  };

  const statusColor = {
    1: 'bg-green-500/10 text-green-400 hover:bg-green-500/20',
    0: 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">用户管理</h2>
          <p className="text-slate-400 mt-1">管理系统用户账户</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="搜索用户名或邮箱..."
        />
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">用户信息</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">邮箱</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">注册时间</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">状态</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                <td className="py-4 px-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-600 to-slate-500 flex items-center justify-center text-white font-semibold">
                      {(user.username || user.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-medium">{user.username || user.email}</p>
                      <p className="text-slate-400 text-sm">ID: {user.id.slice(0, 8)}...</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-6">
                  <span className="flex items-center gap-2 text-slate-300 text-sm">
                    <Mail className="w-4 h-4 text-slate-500" />
                    {user.email || '-'}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className="flex items-center gap-2 text-slate-300 text-sm">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    {user.created_at?.split('T')[0] || '-'}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${statusColor[user.is_active as keyof typeof statusColor]}`}>
                    <div className={`w-2 h-2 rounded-full ${user.is_active ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    {statusLabel[user.is_active as keyof typeof statusLabel]}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <button
                    onClick={() => handleToggleStatus(user.id, user.is_active)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${statusColor[user.is_active as keyof typeof statusColor]}`}
                  >
                    <Ban className="w-3 h-3" />
                    {user.is_active ? '禁用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div className="p-12 text-center">
            <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">暂无用户</p>
          </div>
        )}
      </div>
    </div>
  );
}