/**
 * @file MyWorksPage.tsx
 * @description 我的作品独立页面。
 *              展示当前登录用户上传的全部照片（已通过/待审核/未通过），
 *              顶部状态筛选，未通过照片显示驳回理由。
 *              数据来源：GET /api/auth/me/photos（getMyPhotos）。
 *              V1.10.3 新增，入口为 Header 头像下拉与个人中心快捷按钮。
 *              V4.0.0：未通过卡片增加申诉状态与「发起申诉/撤回申诉」入口
 *              （POST /api/photos/:id/appeal、DELETE /api/my-appeals/:id 仅 pending 可撤）。
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../shared/UserContext';
import { getMyPhotos } from '../../api/auth';
import type { MyPhoto } from '../../api/auth';
import { createAppeal, getMyAppeals, withdrawAppeal } from '../../api/appeals';
import type { MyAppeal, AppealStatus } from '../../api/appeals';
import { CachedImage } from '../../components/CachedImage';

type PhotoFilter = 'all' | 'pending' | 'approved' | 'rejected';

/** 申诉状态文案映射 */
const APPEAL_STATUS_LABEL: Record<AppealStatus, string> = {
  pending: '申诉处理中',
  approved: '申诉已通过',
  rejected: '申诉未通过',
  withdrawn: '申诉已撤回',
};

export function MyWorksPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, token } = useUser();

  const [myPhotos, setMyPhotos] = useState<MyPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>('all');

  // V4.0.0 申诉状态：photoId → 最新申诉记录映射（仅含被驳回照片相关）
  const [appealMap, setAppealMap] = useState<Record<string, MyAppeal>>({});
  // 发起申诉弹窗状态：目标照片 id 与理由输入
  const [appealPhotoId, setAppealPhotoId] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealNotice, setAppealNotice] = useState('');

  /** 拉取本人申诉列表并构建 photoId → 最新申诉 的映射 */
  const fetchAppeals = () => {
    if (!user?.id) return;
    getMyAppeals()
      .then((res) => {
        if (res.success && res.data) {
          const map: Record<string, MyAppeal> = {};
          // 后端按创建时间倒序，先到先得即保留最新一条
          for (const appeal of res.data) {
            if (!map[appeal.photo_id]) map[appeal.photo_id] = appeal;
          }
          setAppealMap(map);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    const statusParam = photoFilter === 'all' ? undefined : photoFilter;
    getMyPhotos(statusParam, 1, 50)
      .then((res) => {
        if (res.success && res.data) {
          setMyPhotos(res.data.photos);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id, photoFilter]);

  // 登录后拉取一次申诉列表（未通过卡片展示申诉状态）
  useEffect(() => {
    fetchAppeals();
  }, [user?.id]);

  /** 展示申诉操作提示（3 秒自动清空） */
  const showAppealNotice = (text: string) => {
    setAppealNotice(text);
    setTimeout(() => setAppealNotice(''), 3000);
  };

  /** 提交申诉：原因必填；409 APPEAL_IN_PROGRESS 提示已有申诉处理中 */
  const handleSubmitAppeal = async () => {
    if (!appealPhotoId || appealLoading) return;
    const reason = appealReason.trim();
    if (!reason) return;
    setAppealLoading(true);
    const result = await createAppeal(appealPhotoId, reason);
    if (result.success) {
      setAppealPhotoId(null);
      setAppealReason('');
      fetchAppeals();
      showAppealNotice('申诉已提交，请等待管理员裁决');
    } else if (result.code === 'APPEAL_IN_PROGRESS') {
      setAppealPhotoId(null);
      setAppealReason('');
      showAppealNotice('该作品已有待处理的申诉，请耐心等待裁决');
    } else {
      showAppealNotice(result.message || '申诉提交失败');
    }
    setAppealLoading(false);
  };

  /** 撤回待处理申诉（仅 pending 可撤，撤回后可重新发起） */
  const handleWithdrawAppeal = async (appeal: MyAppeal) => {
    if (appealLoading) return;
    if (!confirm('确定撤回该申诉吗？撤回后可重新发起。')) return;
    setAppealLoading(true);
    const result = await withdrawAppeal(appeal.id);
    if (result.success) {
      fetchAppeals();
      showAppealNotice('申诉已撤回');
    } else {
      showAppealNotice(result.message || '撤回失败');
    }
    setAppealLoading(false);
  };

  // 未登录引导
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">我的作品</h1>
          <p className="text-gray-500 mb-6">登录后即可查看您上传的所有照片</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-3 rounded-lg font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">我的作品</h1>
          <p className="text-sm text-gray-500 mt-1">
            共 {myPhotos.length} 张，包含已通过、待审核与未通过的全部照片
          </p>
        </div>

        {/* 状态筛选 */}
        <div className="flex gap-2 flex-wrap mb-6">
          {([
            { key: 'all', label: '全部' },
            { key: 'pending', label: '待审核' },
            { key: 'approved', label: '已通过' },
            { key: 'rejected', label: '未通过' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPhotoFilter(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                photoFilter === key
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* V4.0.0：申诉操作提示（3 秒自动清空） */}
        {appealNotice && (
          <p className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            {appealNotice}
          </p>
        )}

        {/* 加载状态 */}
        {loading && (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        )}

        {/* 空态 */}
        {!loading && myPhotos.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {photoFilter === 'all' ? '暂无照片，快去上传一些吧！' : '此状态下没有照片'}
          </div>
        )}

        {/* 照片网格 */}
        {!loading && myPhotos.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myPhotos.map((photo) => (
              <div
                key={photo.id}
                onClick={() => navigate(`/photos/${photo.id}`)}
                className={`rounded-xl overflow-hidden border transition-all cursor-pointer hover:shadow-md ${
                  photo.status === 'pending'
                    ? 'border-yellow-300 bg-yellow-50'
                    : photo.status === 'rejected'
                    ? 'border-red-300 bg-red-50'
                    : 'border-green-200 bg-white'
                }`}
              >
                {/* 缩略图 */}
                <div className="relative aspect-video bg-gray-100">
                  <CachedImage
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    status={photo.status}
                    authToken={token || undefined}
                    cacheEnabled={photo.status === 'approved'}
                    className="w-full h-full object-cover"
                  />
                  {/* 状态徽章 */}
                  <span
                    className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium text-white ${
                      photo.status === 'pending'
                        ? 'bg-yellow-500'
                        : photo.status === 'rejected'
                        ? 'bg-red-500'
                        : 'bg-green-500'
                    }`}
                  >
                    {photo.status === 'pending'
                      ? '待审核'
                      : photo.status === 'rejected'
                      ? '未通过'
                      : '已通过'}
                  </span>
                </div>

                {/* 照片信息 */}
                <div className="p-3">
                  <h4 className="font-medium text-sm text-gray-800 truncate">
                    {photo.title}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(photo.created_at).toLocaleDateString('zh-CN')}
                  </p>

                  {/* 驳回理由与审核员编号（V4.1.2-beta.3：便于追责与申诉举证） */}
                  {photo.status === 'rejected' && photo.rejection_reason && (
                    <div className="mt-2 p-2 rounded-lg bg-red-100 border border-red-200">
                      <p className="text-xs font-medium text-red-700 mb-0.5">驳回理由：</p>
                      <p className="text-xs text-red-600">{photo.rejection_reason}</p>
                      {photo.reviewer_name && (
                        <p className="text-xs text-red-500 mt-1">审核员：{photo.reviewer_name}</p>
                      )}
                    </div>
                  )}

                  {/* V4.0.0：未通过照片的申诉状态与操作入口 */}
                  {photo.status === 'rejected' && (() => {
                    const appeal = appealMap[photo.id];
                    return (
                      <div className="mt-2">
                        {appeal && (
                          <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                                appeal.status === 'pending'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : appeal.status === 'approved'
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : 'bg-gray-100 text-gray-600 border-gray-200'
                              }`}
                            >
                              {APPEAL_STATUS_LABEL[appeal.status]}
                            </span>
                            {appeal.response && (
                              <span className="text-xs text-gray-500 truncate max-w-[180px]" title={appeal.response}>
                                答复：{appeal.response}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2">
                          {/* 无进行中申诉时可发起（含撤回/被驳回后重新申诉） */}
                          {(!appeal || appeal.status !== 'pending') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAppealPhotoId(photo.id);
                                setAppealReason('');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors"
                            >
                              {appeal ? '再次申诉' : '发起申诉'}
                            </button>
                          )}
                          {/* 仅 pending 可撤回 */}
                          {appeal && appeal.status === 'pending' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWithdrawAppeal(appeal);
                              }}
                              disabled={appealLoading}
                              className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium transition-colors"
                            >
                              撤回申诉
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 标签 */}
                  {photo.tags && photo.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {photo.tags.slice(0, 3).map((tag, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* V4.0.0：发起申诉弹窗（原因必填） */}
        {appealPhotoId && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => !appealLoading && setAppealPhotoId(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-2">发起申诉</h3>
              <p className="text-sm text-gray-600 mb-4">
                请说明您认为审核有误的理由，管理员将复核并以站内通知答复裁决结果。
              </p>
              <textarea
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                className="w-full h-28 p-3 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="请输入申诉理由（必填）..."
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setAppealPhotoId(null)}
                  disabled={appealLoading}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmitAppeal}
                  disabled={!appealReason.trim() || appealLoading}
                  className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg transition-colors"
                >
                  {appealLoading ? '提交中...' : '提交申诉'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
 