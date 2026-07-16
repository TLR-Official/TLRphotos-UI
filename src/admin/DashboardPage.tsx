import { useState, useEffect } from 'react';
import { Image, Users, CheckCircle, XCircle, TrendingUp } from 'lucide-react';
import { getStats } from './api';

export function DashboardPage() {
  const [stats, setStats] = useState<{
    totalPhotos: number;
    pendingPhotos: number;
    approvedPhotos: number;
    rejectedPhotos: number;
    totalUsers: number;
    totalAdmins: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const result = await getStats();
      if (result.success && result.data) {
        setStats({
          totalPhotos: result.data.photoCount || 0,
          pendingPhotos: result.data.pendingCount || 0,
          approvedPhotos: 0,
          rejectedPhotos: 0,
          totalUsers: result.data.userCount || 0,
          totalAdmins: result.data.adminCount || 0,
        });
      }
      setLoading(false);
    };
    fetchStats();
  }, []);

  const statCards = [
    {
      label: '总照片数',
      value: stats?.totalPhotos || 0,
      icon: Image,
      color: 'from-blue-600 to-blue-700',
      bgColor: 'bg-blue-500/10',
      textColor: 'text-blue-400',
    },
    {
      label: '待审核',
      value: stats?.pendingPhotos || 0,
      icon: TrendingUp,
      color: 'from-amber-500 to-amber-600',
      bgColor: 'bg-amber-500/10',
      textColor: 'text-amber-400',
    },
    {
      label: '已通过',
      value: stats?.approvedPhotos || 0,
      icon: CheckCircle,
      color: 'from-green-600 to-green-700',
      bgColor: 'bg-green-500/10',
      textColor: 'text-green-400',
    },
    {
      label: '已拒绝',
      value: stats?.rejectedPhotos || 0,
      icon: XCircle,
      color: 'from-red-600 to-red-700',
      bgColor: 'bg-red-500/10',
      textColor: 'text-red-400',
    },
    {
      label: '注册用户',
      value: stats?.totalUsers || 0,
      icon: Users,
      color: 'from-purple-600 to-purple-700',
      bgColor: 'bg-purple-500/10',
      textColor: 'text-purple-400',
    },
    {
      label: '管理员',
      value: stats?.totalAdmins || 0,
      icon: Users,
      color: 'from-cyan-600 to-cyan-700',
      bgColor: 'bg-cyan-500/10',
      textColor: 'text-cyan-400',
    },
  ];

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
          <h2 className="text-2xl font-bold text-white">仪表盘</h2>
          <p className="text-slate-400 mt-1">欢迎回来，查看系统概览</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`${card.bgColor} rounded-xl p-4 border border-slate-700/50 hover:border-slate-600 transition-all hover:shadow-lg hover:shadow-slate-800/50`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                {card.label === '待审核' && stats?.pendingPhotos && stats.pendingPhotos > 0 && (
                  <span className="px-2 py-0.5 bg-amber-500 text-white text-xs font-medium rounded-full animate-pulse">
                    {stats.pendingPhotos}
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold text-white">{card.value}</p>
              <p className={`text-sm ${card.textColor}`}>{card.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">审核状态分布</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm">待审核</span>
                <span className="text-amber-400 text-sm font-medium">{stats?.pendingPhotos || 0}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-600 rounded-full transition-all duration-500"
                  style={{ width: `${stats && stats.totalPhotos ? (stats.pendingPhotos / stats.totalPhotos) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm">已通过</span>
                <span className="text-green-400 text-sm font-medium">{stats?.approvedPhotos || 0}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-green-600 rounded-full transition-all duration-500"
                  style={{ width: `${stats && stats.totalPhotos ? (stats.approvedPhotos / stats.totalPhotos) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-300 text-sm">已拒绝</span>
                <span className="text-red-400 text-sm font-medium">{stats?.rejectedPhotos || 0}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-500 to-red-600 rounded-full transition-all duration-500"
                  style={{ width: `${stats && stats.totalPhotos ? (stats.rejectedPhotos / stats.totalPhotos) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">系统状态</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-slate-300 text-sm">服务运行正常</span>
              </div>
              <span className="text-green-400 text-xs">在线</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-slate-300 text-sm">数据库连接</span>
              </div>
              <span className="text-green-400 text-xs">正常</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-slate-300 text-sm">文件存储</span>
              </div>
              <span className="text-green-400 text-xs">可用</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-slate-300 text-sm">审核队列</span>
              </div>
              <span className="text-blue-400 text-xs">{stats?.pendingPhotos || 0} 张待审核</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}