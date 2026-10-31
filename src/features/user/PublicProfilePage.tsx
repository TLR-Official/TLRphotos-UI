/**
 * @file 公开用户主页（V4.1.0）
 * @description
 *  路由 /users/:id 的公开主页：
 *   - 头部卡：头像 + 昵称 + 状态标签（地区/加入天数/作品数/浏览数）+ 活跃处罚徽章（三色体系）；
 *   - 处罚公示卡：仅存在活跃处罚时展示，每条含等级徽章 + 原因 + 期限；
 *   - 作品区：按分区（全部/航空/铁路/汽车…）Tab 展示 approved 作品卡片，加载更多分页；
 *   - 论坛发帖记录：纯灰文本列表（标题/板块/回复/点赞/时间），点击跳帖子详情；
 *   - is_self 额外展示待审核/未通过计数与「我的作品」入口。
 *  隐私红线：不渲染任何 email/IP 信息；未通过作品对他人不可见（后端契约保证）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getUserProfile, getUserPhotos, getUserThreads } from '../../api/users';
import type { UserProfile, UserPhotoItem, UserThreadItem, PublicPenalty } from '../../api/users';
import { getTagCategories } from '../../api/tags';
import type { TagCategory } from '../../api/tags';
import { getBoards } from '../../api/forum';
import { CachedImage } from '../../components/CachedImage';
import { formatDateOnly } from '../../shared/utils';
import { UserTitleBadge } from '../../shared/UserTitleBadge';

/** 每页作品条数（后端上限 50） */
const PHOTOS_PAGE_SIZE = 12;

/** 处罚等级徽章配置：L1 淡紫 / L2 淡蓝 / L3 深蓝实底（三色体系内取色） */
const PENALTY_LEVEL_BADGE: Record<number, { label: string; className: string }> = {
  1: { label: '警告', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  2: { label: '功能封禁', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  3: { label: '账号封禁', className: 'bg-blue-700 text-white border border-blue-700' },
};

/** 未知等级兜底徽章 */
const PENALTY_FALLBACK_BADGE = {
  label: '处罚',
  className: 'bg-gray-100 text-gray-700 border border-gray-200',
};

/** 状态标签：浅灰圆角小片 */
function InfoChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-600">
      {children}
    </span>
  );
}

/**
 * 处罚期限文案：L2/L3 有到期时间显示「至 YYYY-MM-DD」；其余无固定期限
 */
function penaltyTermText(p: PublicPenalty): string {
  if (p.level >= 2 && p.expires_at) {
    return `至 ${formatDateOnly(p.expires_at)}`;
  }
  return '无固定期限';
}

/**
 * 公开用户主页组件
 * @returns 主页 JSX，含加载态、用户不存在态与正常视图
 */
export function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  // 档案
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // 作品（分区 Tab + 加载更多）
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null); // null = 全部
  const [photos, setPhotos] = useState<UserPhotoItem[]>([]);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [photosPage, setPhotosPage] = useState(1);
  const [photosLoading, setPhotosLoading] = useState(false);

  // 论坛发帖记录
  const [threads, setThreads] = useState<UserThreadItem[]>([]);
  const [boardNames, setBoardNames] = useState<Record<string, string>>({});
  const [threadsLoading, setThreadsLoading] = useState(true);

  // 拉取档案：404 单独呈现友好态
  useEffect(() => {
    if (!userId) return;
    setIsLoading(true);
    setProfile(null);
    setProfileError('');
    getUserProfile(userId)
      .then((res) => {
        if (res.success && res.data) {
          setProfile(res.data);
        } else if (res.code === 'USER_NOT_FOUND') {
          setProfileError('用户不存在');
        } else {
          setProfileError(res.message || '加载失败，请稍后重试');
        }
      })
      .finally(() => setIsLoading(false));
  }, [userId]);

  // 分区列表（与画廊同源：tag_categories）
  useEffect(() => {
    getTagCategories().then((res) => {
      if (res.success && res.data) setCategories(res.data);
    });
  }, []);

  /** 拉取指定页公开作品：第一页覆盖列表，后续页追加 */
  const fetchPhotos = useCallback(
    async (targetPage: number) => {
      if (!userId) return;
      setPhotosLoading(true);
      const res = await getUserPhotos(userId, targetPage, PHOTOS_PAGE_SIZE, activeCategory ?? undefined);
      if (res.success && res.data) {
        setPhotos((prev) => (targetPage === 1 ? res.data!.items : [...prev, ...res.data!.items]));
        setPhotosTotal(res.data.total);
        setPhotosPage(targetPage);
      }
      setPhotosLoading(false);
    },
    [userId, activeCategory]
  );

  // 首次与分区切换时重置到第一页
  useEffect(() => {
    fetchPhotos(1);
  }, [fetchPhotos]);

  // 发帖记录（一次拉满 50 条，主页不做翻页）+ 板块名映射
  useEffect(() => {
    if (!userId) return;
    setThreadsLoading(true);
    getUserThreads(userId, 1, 50)
      .then((res) => {
        if (res.success && res.data) setThreads(res.data.items);
      })
      .finally(() => setThreadsLoading(false));
    getBoards().then((res) => {
      if (res.success && res.data) {
        const map: Record<string, string> = {};
        for (const b of res.data) map[b.id] = b.name;
        setBoardNames(map);
      }
    });
  }, [userId]);

  // 加载态
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // 用户不存在 / 加载失败态
  if (!profile) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            {profileError || '用户不存在'}
          </h1>
          <p className="text-gray-500 mb-6">该用户可能已被注销或链接有误</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-lg font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  // 头部处罚徽章：按活跃处罚等级去重展示
  const activeLevels = [...new Set(profile.public_penalties.map((p) => p.level))];
  const hasMorePhotos = photos.length < photosTotal;

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-8 max-md:py-4">
        {/* 头部卡 */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-8 max-md:p-5">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
            <div className="w-24 h-24 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url.startsWith('/') ? `/api${profile.avatar_url}` : profile.avatar_url}
                  alt={profile.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl font-bold text-white">
                  {profile.username.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex-1 text-center md:text-left min-w-0">
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                <h1 className="text-2xl font-bold text-gray-900">
                  {profile.username}
                  <UserTitleBadge title={profile.title} />
                </h1>
                {activeLevels.map((level) => {
                  const badge = PENALTY_LEVEL_BADGE[level] ?? PENALTY_FALLBACK_BADGE;
                  return (
                    <span
                      key={level}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  );
                })}
              </div>

              <div className="flex flex-wrap justify-center md:justify-start gap-2 mt-3">
                <InfoChip>地区 {profile.region}</InfoChip>
                <InfoChip>加入 {profile.joined_days} 天</InfoChip>
                <InfoChip>作品 {profile.approved_count} 部</InfoChip>
                <InfoChip>浏览 {profile.total_views} 次</InfoChip>
                {profile.is_self && (
                  <>
                    <InfoChip>待审核 {profile.pending_count ?? 0}</InfoChip>
                    <InfoChip>未通过 {profile.rejected_count ?? 0}</InfoChip>
                  </>
                )}
              </div>

              {profile.is_self && (
                <div className="mt-3">
                  <Link
                    to="/my-works"
                    className="text-sm text-blue-700 hover:text-blue-800 hover:underline"
                  >
                    查看我的作品 →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 处罚公示卡：仅存在活跃处罚时展示 */}
        {profile.public_penalties.length > 0 && (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">处罚公示</h2>
            <ul className="space-y-3">
              {profile.public_penalties.map((p, index) => {
                const badge = PENALTY_LEVEL_BADGE[p.level] ?? PENALTY_FALLBACK_BADGE;
                return (
                  <li key={`${p.created_at}-${index}`} className="flex items-start gap-3">
                    <span
                      className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="text-gray-800 break-words">{p.reason}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {penaltyTermText(p)} · {formatDateOnly(p.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 作品区：分区 Tab + 卡片网格（移动端 Tab 换行展示，避免横向滑动） */}
        <div className="mt-8">
          <div className="flex items-center gap-1 border-b border-gray-200 flex-wrap md:flex-nowrap md:overflow-x-auto">
            <button
              onClick={() => setActiveCategory(null)}
              className={`px-4 py-2 max-md:py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeCategory === null
                  ? 'border-blue-700 text-blue-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-2 max-md:py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                  activeCategory === cat.id
                    ? 'border-blue-700 text-blue-700 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {photos.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              {photosLoading ? '加载中...' : '暂无作品'}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-5">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => navigate(`/photos/${photo.id}`)}
                  className="group text-left rounded-xl overflow-hidden border border-gray-200 bg-white hover:shadow-md transition-shadow"
                >
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    className="w-full aspect-square object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="p-3">
                    <p className="text-sm font-medium text-gray-900 truncate">{photo.title}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {photo.likes} 赞 · {photo.views} 浏览
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {hasMorePhotos && (
            <div className="text-center mt-6">
              <button
                onClick={() => fetchPhotos(photosPage + 1)}
                disabled={photosLoading}
                className="px-6 py-2.5 max-md:h-12 max-md:w-full rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                {photosLoading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </div>

        {/* 论坛发帖记录：纯灰文本列表（去 AI 化规范，无图标装饰） */}
        <div className="mt-10">
          <h2 className="text-base font-semibold text-gray-900 mb-2">论坛发帖</h2>
          {threadsLoading ? (
            <div className="py-8 text-center text-gray-500 text-sm">加载中...</div>
          ) : threads.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">暂无发帖</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/forum/t/${t.id}`}
                    className="group flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 group-hover:text-blue-700 truncate">
                        {t.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {boardNames[t.board_id] ?? t.board_id}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-gray-400">
                      {t.reply_count} 回复 · {t.like_count} 点赞 · {formatDateOnly(t.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
