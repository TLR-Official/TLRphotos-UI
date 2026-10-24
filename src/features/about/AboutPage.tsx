/**
 * 关于我们页面
 * 展示团队介绍角色卡（创始人/技术/审核/航空审核，简介文案占位待站长补充）、
 * 站点数据卡（已开站天数 / 已入库作品数，来自公开接口 /about/stats）、
 * 作品许可协议说明（CC BY 4.0 站内化：适用范围/使用权利/署名义务/水印与原图）
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
              <div className="grid grid-cols-2 gap-6 max-md:gap-4">
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

        {/* 作品许可协议：CC BY 4.0 站内化说明 */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-black mb-4">作品许可协议</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <p className="text-sm text-gray-600 leading-relaxed">
              经审核通过并在本站公开展出的摄影作品，采用
              <a
                href="https://creativecommons.org/licenses/by/4.0/deed.zh-hans"
                target="_blank"
                rel="license noopener noreferrer"
                className="mx-1 font-medium text-blue-700 hover:text-blue-800"
              >
                知识共享署名 4.0 国际许可协议（CC BY 4.0）
              </a>
              授权。著作权仍归各作品作者所有，本协议仅授权他人按下列条件使用作品。
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-black">适用范围</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  仅限航空、铁路、公路三个分区内经审核入库的摄影作品。论坛帖子、评论区、新闻与专栏文章等文字内容不在此列，转载或引用前请先联系作者与站方。
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-black">你可以自由使用</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  以任何媒介复制、传播作品；对作品进行裁剪、调色、合成等改编再创作，并可将其用于商业用途——以上均无需另行申请授权。
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-black">使用时须注明</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  署名原作者，建议格式「作品标题 · 作者名 · 来源 TLRphotos」；附上本协议链接；若对作品做过修改，需一并说明。同时不得附加任何额外法律或技术限制，也不得以署名方式暗示作者或本站为你背书。
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-black">关于水印与原图</h3>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  站内提供的规范下载文件为带 TLRphotos 水印的版本，水印与版权信息不得裁切、遮挡或抹除。如需无水印原始文件，请直接联系作者本人取得另行授权。
                </p>
              </div>
            </div>

            <p className="mt-5 text-xs text-gray-400">
              协议全文：
              <a
                href="https://creativecommons.org/licenses/by/4.0/deed.zh-hans"
                target="_blank"
                rel="license noopener noreferrer"
                className="text-blue-700 hover:text-blue-800"
              >
                中文版本
              </a>
              {' · '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/legalcode"
                target="_blank"
                rel="license noopener noreferrer"
                className="text-blue-700 hover:text-blue-800"
              >
                官方英文法律文本
              </a>
            </p>
          </div>
        </section>

        {/* 支持我们（占位卡） */}
        <section className="mt-10">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
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
