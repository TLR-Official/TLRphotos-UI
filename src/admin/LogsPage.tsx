import { useState, useEffect } from 'react';
import { FileText, Search, Clock, User, MousePointerClick } from 'lucide-react';
import { getLogs } from './api';
import type { AdminLog } from './types';

export function LogsPage() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      const result = await getLogs();
      if (result.success && result.data) {
        setLogs(result.data);
      }
      setLoading(false);
    };
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log =>
    log.admin_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.target_type && log.target_type.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (log.details && log.details.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const actionLabel: Record<string, string> = {
    login: '登录系统',
    logout: '退出登录',
    create_admin: '创建管理员',
    update_admin: '编辑管理员',
    delete_admin: '删除管理员',
    approve_photo: '通过照片审核',
    reject_photo: '拒绝照片审核',
    toggle_user_status: '切换用户状态',
  };

  const actionColor: Record<string, string> = {
    login: 'text-green-400',
    logout: 'text-slate-400',
    create_admin: 'text-blue-400',
    update_admin: 'text-blue-400',
    delete_admin: 'text-red-400',
    approve_photo: 'text-green-400',
    reject_photo: 'text-red-400',
    toggle_user_status: 'text-amber-400',
  };

  const targetTypeLabel: Record<string, string> = {
    admin: '管理员',
    photo: '照片',
    user: '用户',
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
          <h2 className="text-2xl font-bold text-white">操作日志</h2>
          <p className="text-slate-400 mt-1">查看系统操作记录</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="搜索管理员、操作类型或详情..."
        />
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">时间</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">管理员</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">操作</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">目标</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">详情</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map(log => (
              <tr key={log.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                <td className="py-4 px-6">
                  <span className="flex items-center gap-2 text-slate-300 text-sm">
                    <Clock className="w-4 h-4 text-slate-500" />
                    {log.created_at?.replace('T', ' ').slice(0, 19) || '-'}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className="flex items-center gap-2 text-slate-300 text-sm">
                    <User className="w-4 h-4 text-slate-500" />
                    {log.admin_name}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className={`flex items-center gap-2 font-medium text-sm ${actionColor[log.action] || 'text-slate-400'}`}>
                    <MousePointerClick className="w-4 h-4" />
                    {actionLabel[log.action] || log.action}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className="text-slate-300 text-sm">
                    {log.target_type ? `${targetTypeLabel[log.target_type] || log.target_type}` : '-'}
                    {log.target_id && ` #${log.target_id.slice(0, 8)}...`}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className="text-slate-400 text-sm max-w-xs truncate">
                    {log.details || '-'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredLogs.length === 0 && (
          <div className="p-12 text-center">
            <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">暂无操作日志</p>
          </div>
        )}
      </div>
    </div>
  );
}