/**
 * 操作日志页
 * 分页展示管理员操作日志，按操作类型用不同颜色徽章区分（通过/拒绝/创建/删除/其他）。
 */
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLogs } from './api';
import type { AdminLog } from './types';

/**
 * 操作日志页组件
 * @returns 加载态 / 日志表格 + 分页 JSX
 */
export function LogsPage() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // page 变化时重新拉取日志
  useEffect(() => {
    fetchLogs();
  }, [page]);

  /** 拉取当前页日志列表 */
  const fetchLogs = async () => {
    setLoading(true);
    const result = await getLogs(page, pageSize);
    if (result.success && result.data) {
      setLogs(result.data);
      setTotal(result.pagination?.total || 0);
    }
    setLoading(false);
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

  /** 操作类型标识到中文标签的映射，未命中时回退为原始 action 字符串 */
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
      <h2 className="text-2xl font-bold text-gray-800 mb-6">操作日志</h2>

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">操作人</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">操作</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">目标</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">详情</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">IP</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-t border-gray-200">
                    <td className="px-4 py-3 text-gray-800">{log.admin_name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-sm ${
                        log.action.includes('approve') ? 'bg-green-50 text-green-600' :
                        log.action.includes('reject') || log.action.includes('delete') ? 'bg-red-50 text-red-600' :
                        log.action.includes('create') ? 'bg-blue-50 text-blue-600' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {actionLabel[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {log.target_type && log.target_id ? `${log.target_type}: ${log.target_id}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm max-w-xs truncate">
                      {log.details ? (
                        <span title={log.details}>{log.details}</span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{log.ip || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && (
              <div className="text-center py-10 text-gray-500">暂无操作日志</div>
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