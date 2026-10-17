/**
 * 关于我们页面
 * 展示团队介绍角色卡（创始人/技术/审核/航空审核，简介文案占位待站长补充）、
 * 站点数据卡（已开站天数 / 已入库作品数，来自公开接口 /about/stats）
 * 与「支持我们」占位卡。站点数据请求失败时展示重试按钮，不影响其余区块渲染。
 */
import { useCallback, useEffect, useState } from 'react';
import { getAboutStats } from '../../api/about';
import type { AboutStats } from '../../api/about';

/** 团队角色卡数据 */
interface TeamRole {
  name: string;        // 角色名
  description: string; // 角色简介（占位文案，待站长补充）
}

/** 团队角色卡列表：简介为占位文案，待站长提供后替换 */
const TEAM_ROLES: TeamRole[] = [
  { name: '创始人', description: '简介待站长补充。' },
  { name: '技术', description: '简介待站长补充。' },
  { name: '审核', description: '简介待站长补充。' },
  { name: '航空审核', description: '简介待站长补充。' },
];

/**
 * 关于我们页面组件
 * 站点数据首次挂载时请求一次；加载中显示占位文案，
 * 失败时显示错误信息与重试按钮（不抛异常、不白屏）。
 * @returns 页面 JSX
 */
export function AboutPage() {
  const [stats, setStats] = useState<AboutStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** 拉取站点数据：成功写入 stats，失败记录错误信息供重试按钮区域展示 */
  const loadStats = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const res = await getAboutStats();
    if (res.success && res.data) {
      setStats(res.data);
    } else {
      setErrorMessage(res.message || '站点数据加载失败，请稍后重试');
    }
    setIsLoading(false);
  }, []);

  // 首次挂载拉取站点数据
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return (
    <div className="px-4 py-8">
      <div className="max-w-5xl mx-auto">
        {/* 页头 */}
        <h1 className="text-2xl font-bold text-black">关于我们</h1>
        <p className="mt-2 text-gray-600">
          TLRphotos 是由交通摄影爱好者共同维护的作品社区，致力于收集与分享每一个值得记录的瞬间。
        </p>

        {/* 团队介绍 */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-black mb-4">团队介绍</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {TEAM_ROLES.map((role) => (
              <div
                key={role.name}
                className="bg-white border border-gray-200 rounded-xl p-5"
              >
                <h3 className="font-semibold text-black">{role.name}</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  {role.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 站点数据 */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-black mb-4">站点数据</h2>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            {isLoading ? (
              <p className="text-sm text-gray-600">正在加载站点数据...</p>
            ) : errorMessage ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-red-600">{errorMessage}</p>
                <button
                  onClick={loadStats}
                  className="px-4 py-2 rounded-full bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 transition-colors"
                >
                  重试
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-3xl font-bold text-blue-700">
                    {stats?.site_days ?? '--'}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">已开站天数</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-blue-700">
                    {stats?.approved_count ?? '--'}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">已入库作品</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 支持我们（占位卡） */}
        <section className="mt-10">
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-black">支持我们</h2>
            <p className="mt-2 text-sm text-gray-600">
              支持形式正在规划中（投票 / 捐赠，敬请期待）。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
