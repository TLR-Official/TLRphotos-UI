/**
 * 管理后台仪表盘
 * 汇总系统总览统计（用户/照片/今日上传/待审核数）与照片审核分布，
 * 顶部以卡片形式展示关键指标，下方展示审核状态分布。
 *
 * V1.5.0 改造：
 * - fetchData 加 error state + retry 按钮（原 API 失败 silently 显示 0）
 * - zone_master/zone_auditor 显示"当前分区：xxx"提示
 * - 顶部 30s 轮询 /dashboard/health 显示告警条
 */
import { useState, useEffect } from 'react';
import { Image, Users, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import { getStats, getPhotoStats, getDashboardHealth } from './api';
import type { SystemStats, AuditStats } from './types';

export function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [photoStats, setPhotoStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  // V1.5.0：error state（原 fetchData 无 error 处理，API 失败 silently 显示 0）
  const [error, setError] = useState<string | null>(null);
  // V1.5.0：健康检查告警（30s 轮询）
  const [healthIssues, setHealthIssues] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const [statsResult, photoStatsResult] = await Promise.all([getStats(), getPhotoStats()]);

    // 任一失败显示错误提示，但保留已成功的部分数据
    // V1.5.0：getStats/getPhotoStats 返回类型未声明 message 字段（仅在失败时附带），通过类型断言访问
    const statsMsg = (statsResult as { message?: string }).message;
    const photoStatsMsg = (photoStatsResult as { message?: string }).message;
    if (!statsResult.success && !photoStatsResult.success) {
      setError('数据加载失败：' + (statsMsg || photoStatsMsg || '网络错误，请检查登录状态'));
    } else if (!statsResult.success) {
      setError('系统统计加载失败：' + (statsMsg || '未知错误'));
    } else if (!photoStatsResult.success) {
      setError('审核统计加载失败：' + (photoStatsMsg || '未知错误'));
    }

    if (statsResult.success && statsResult.data) setStats(statsResult.data);
    if (photoStatsResult.success && photoStatsResult.data) setPhotoStats(photoStatsResult.data);
    setLoading(false);
  };

  // 首次挂载拉取数据
  useEffect(() => {
    fetchData();
  }, []);

  // V1.5.0：30s 轮询健康检查，异常时显示告警条
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const result = await getDashboardHealth();
        if (result.success && result.data && !result.data.healthy) {
          setHealthIssues(result.data.issues);
        } else {
          setHealthIssues([]);
        }
      } catch {
        // 健康检查接口本身失败时不打扰用户（已通过主数据 error 提示）
      }
    };
    checkHealth();
    const id = setInterval(checkHealth, 30000); // 30s
    return () => clearInterval(id);
  }, []);

  // 顶部统计卡片配置：图标 / 标签 / 取值字段 / 主题色
  const cards = [
    { icon: Users, label: '用户总数', value: stats?.userCount ?? 0, color: 'bg-blue-600' },
    { icon: Image, label: '照片总数', value: stats?.photoCount ?? 0, color: 'bg-green-600' },
    { icon: Clock, label: '待审核', value: photoStats?.pending ?? 0, color: 'bg-yellow-600' },
    { icon: TrendingUp, label: '今日上传', value: stats?.todayUploads ?? 0, color: 'bg-purple-600' },
  ];

  if (loading) {
    return <div className="text-gray-600 text-center py-10">加载中...</div>;
  }

  // V1.5.0：zone 提示（zone_master/zone_auditor 显示当前分区名）
  const zoneName = stats?.zoneName ?? photoStats?.zoneName ?? null;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-3">仪表盘</h2>
      {zoneName && (
        <p className="text-sm text-gray-500 mb-4">
          当前分区：<span className="font-semibold text-gray-700">{zoneName}</span>
        </p>
      )}

      {/* V1.5.0：健康检查告警条 */}
      {healthIssues.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-300 rounded-lg flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-800 font-semibold">系统健康检查异常</p>
              <ul className="text-yellow-700 text-sm mt-1 list-disc list-inside">
                {healthIssues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* V1.5.0：API 失败错误条 + 重试按钮 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={fetchData}
            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 flex-shrink-0"
          >
            重试
          </button>
        </div>
      )}

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
            <p className="text-2xl font-bold text-yellow-600">{photoStats?.pending ?? 0}</p>
            <p className="text-sm text-gray-500">待审核</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{photoStats?.approved ?? 0}</p>
            <p className="text-sm text-gray-500">已通过</p>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <p className="text-2xl font-bold text-red-600">{photoStats?.rejected ?? 0}</p>
            <p className="text-sm text-gray-500">已拒绝</p>
          </div>
        </div>
      </div>
    </div>
  );
}
