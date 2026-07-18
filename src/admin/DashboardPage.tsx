import { useState, useEffect } from 'react';
import { Image, Users, Clock, TrendingUp } from 'lucide-react';
import { getStats, getPhotoStats } from './api';
import type { SystemStats, AuditStats } from './types';

export function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [photoStats, setPhotoStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [statsResult, photoStatsResult] = await Promise.all([getStats(), getPhotoStats()]);
      if (statsResult.success && statsResult.data) setStats(statsResult.data);
      if (photoStatsResult.success && photoStatsResult.data) setPhotoStats(photoStatsResult.data);
      setLoading(false);
    };
    fetchData();
  }, []);

  const cards = [
    {
      icon: Users,
      label: '用户总数',
      value: stats?.userCount || 0,
      color: 'bg-blue-600',
    },
    {
      icon: Image,
      label: '照片总数',
      value: stats?.photoCount || 0,
      color: 'bg-green-600',
    },
    {
      icon: Clock,
      label: '待审核',
      value: photoStats?.pending || 0,
      color: 'bg-yellow-600',
    },
    {
      icon: TrendingUp,
      label: '今日上传',
      value: stats?.todayUploads || 0,
      color: 'bg-purple-600',
    },
  ];

  if (loading) {
    return <div className="text-white text-center py-10">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">仪表盘</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map(card => (
          <div key={card.label} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className={`${card.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}>
              <card.icon className="w-6 h-6 text-white" />
            </div>
            <p className="text-slate-400 text-sm">{card.label}</p>
            <p className="text-3xl font-bold text-white mt-2">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-4">审核统计</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-yellow-500/10 rounded-lg">
            <p className="text-2xl font-bold text-yellow-400">{photoStats?.pending || 0}</p>
            <p className="text-sm text-slate-400">待审核</p>
          </div>
          <div className="text-center p-4 bg-green-500/10 rounded-lg">
            <p className="text-2xl font-bold text-green-400">{photoStats?.approved || 0}</p>
            <p className="text-sm text-slate-400">已通过</p>
          </div>
          <div className="text-center p-4 bg-red-500/10 rounded-lg">
            <p className="text-2xl font-bold text-red-400">{photoStats?.rejected || 0}</p>
            <p className="text-sm text-slate-400">已拒绝</p>
          </div>
        </div>
      </div>
    </div>
  );
}