/**
 * 管理后台仪表盘
 * 汇总系统总览统计（用户/照片/今日上传/待审核数）与照片审核分布，
 * 顶部以卡片形式展示关键指标，下方展示审核状态分布。
 */
import { useState, useEffect } from 'react';
import { Image, Users, Clock, TrendingUp } from 'lucide-react';
import { getStats, getPhotoStats } from './api';
import type { SystemStats, AuditStats } from './types';

/**
 * 仪表盘页面组件
 * @returns 加载态 / 仪表盘 JSX（卡片统计 + 审核分布）
 */
export function DashboardPage() {
  // 系统总览统计（用户数、照片数、今日上传数等）
  const [stats, setStats] = useState<SystemStats | null>(null);
  // 照片审核分布统计（待审核 / 已通过 / 已拒绝）
  const [photoStats, setPhotoStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);

  // 首次挂载并行拉取系统统计与审核统计，提升首屏加载速度
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

  // 顶部统计卡片配置：图标 / 标签 / 取值字段 / 主题色
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
    return <div className="text-gray-600 text-center py-10">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">仪表盘</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <div className={`${card.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}>
              <card.icon className="w-6 h-6 text-white" />
            </div>
            <p className="text-gray-500 text-sm">{card.label}</p>
            <p className="text-3xl font-bold text-gray-800 mt-2">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">审核统计</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-yellow-50 rounded-lg">
            <p className="text-2xl font-bold text-yellow-600">{photoStats?.pending || 0}</p>
            <p className="text-sm text-gray-500">待审核</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{photoStats?.approved || 0}</p>
            <p className="text-sm text-gray-500">已通过</p>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <p className="text-2xl font-bold text-red-600">{photoStats?.rejected || 0}</p>
            <p className="text-sm text-gray-500">已拒绝</p>
          </div>
        </div>
      </div>
    </div>
  );
}