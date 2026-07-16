import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLogs } from './api';
import type { AdminLog } from './types';

export function LogsPage() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, [page]);

  const fetchLogs = async () => {
    setLoading(true);
    const result = await getLogs(page, pageSize);
    if (result.success && result.data) {
      setLogs(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
  };

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setPage(newPage);
    }
  };

  const actionLabel: Record<string, string> = {
    login: '登录',
    create_admin: '创建管理员',
    update_admin: '更新管理员',
    delete_admin: '删除管理员',
    approve_photo: '审核通过',
    reject_photo: '审核拒绝',
    activate_user: '启用用户',
    deactivate_user: '禁用用户',
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">操作日志</h2>

      {loading ? (
        <div className="text-white text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">操作人</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">操作</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">目标</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">详情</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">IP</th>
                  <th className="text-left px-4 py-3 text-slate-300 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-t border-slate-700">
                    <td className="px-4 py-3 text-white">{log.admin_name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-sm ${
                        log.action.includes('approve') ? 'bg-green-500/20 text-green-400' :
                        log.action.includes('reject') || log.action.includes('delete') ? 'bg-red-500/20 text-red-400' :
                        log.action.includes('create') ? 'bg-blue-500/20 text-blue-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        {actionLabel[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {log.target_type && log.target_id ? `${log.target_type}: ${log.target_id}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-sm max-w-xs truncate">
                      {log.details ? (
                        <span title={log.details}>{log.details}</span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{log.ip || '-'}</td>
                    <td className="px-4 py-3 text-slate-300">{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && (
              <div className="text-center py-10 text-slate-400">暂无操作日志</div>
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