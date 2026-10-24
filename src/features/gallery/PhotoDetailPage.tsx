/**
 * 照片详情页
 * 根据路由参数加载单张照片的完整信息，展示原图、上传者、拍摄参数、统计与描述等；
 * 当访问者为上传者本人时，提供两步确认式删除入口。
 * V4.0.0：被驳回且访问者为所有者时展示申诉状态卡，支持发起申诉（原因必填）。
 */
import { useParams, useNavigate } from 'react-router-dom';
import { getPhotoById, deletePhoto, likePhoto, unlikePhoto } from '../../api/photos';
import { createAppeal, getMyAppeals } from '../../api/appeals';
import type { MyAppeal } from '../../api/appeals';
import { useTheme } from '../../shared/ThemeContext';
import { useUser } from '../../shared/UserContext';
import { useState, useEffect } from 'react';
import { Heart, Eye, Download } from 'lucide-react';
import type { PhotoDetail } from './types';
import { formatDate } from '../../shared/utils';
import { CachedImage } from '../../components/CachedImage';
import { useHumanVerification } from '../../shared/useHumanVerification';
import { useIsMobile, useIsTouch } from '../../shared/useIsMobile';
import { CommentList } from '../comments/components/CommentList';
import { MobileZoomableImage } from './MobileZoomableImage';


/**
 * 照片详情页组件
 * 从 URL 参数读取照片 id，请求详情数据并渲染；支持所有者删除照片。
 * @returns 详情页 JSX，包含加载态、空态与详情主视图
 */
export function PhotoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user, token } = useUser();
  // V1.8.0：人机验证门（删除照片被 403 拦截时弹出）
  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification();
  // photo：详情数据，null 表示不存在或未加载
  const [photo, setPhoto] = useState<PhotoDetail | null>(null);
  // isLoading：首次加载标识，控制全屏 loading 占位
  const [isLoading, setIsLoading] = useState(true);
  // deleteConfirmStep：删除确认进度，0 未触发 / 1 第一次确认 / 2 第二次确认（执行删除）
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState('');

  // 点赞相关本地 state：用于在详情数据加载后维护可交互的 UI 状态
  // - isLiked：当前用户是否已点赞（基于后端 is_liked 字段初始化，本地乐观更新）
  // - likeCount / viewCount：本地缓存的最新统计数（点击后立即更新，服务器返回后校准）
  // - likeLoading：防止用户连续点击触发并发请求
  // - likeError：点赞失败/未登录的提示信息（3 秒后自动清空）
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [viewCount, setViewCount] = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);
  const [likeError, setLikeError] = useState('');
  // 下载状态：isDownloading 防重复点击，downloadError 失败提示（3 秒自动清空）
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  // 移动端能力探测：isMobile 驱动布局（与 md: 断点一致），isTouch 补充触屏手势场景
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  // 评论总数（由 CommentList onTotalChange 回填，用于移动端数据行展示）
  const [commentCount, setCommentCount] = useState<number | null>(null);

  // V4.0.0 申诉状态（仅所有者且照片被驳回时启用）：
  // - myAppeal：该照片的最新一条申诉记录（含状态与裁决答复）
  // - appealModalOpen / appealReason / appealLoading：发起申诉弹窗
  // - appealNotice：申诉操作提示（3 秒自动清空）
  const [myAppeal, setMyAppeal] = useState<MyAppeal | null>(null);
  const [appealModalOpen, setAppealModalOpen] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealNotice, setAppealNotice] = useState('');

  // 根据 id 拉取照片详情；cancelled 标志防止组件卸载后异步回调写入 state
  useEffect(() => {
    let cancelled = false;

    getPhotoById(id || '').then((result) => {
      if (cancelled) return;
      if (result.success && result.data) {
        setPhoto(result.data);
        // 初始化点赞/浏览本地状态（来自后端 is_liked / likes / views 字段）
        setIsLiked(!!result.data.is_liked);
        setLikeCount(result.data.likes);
        setViewCount(result.data.views);
      }
      setIsLoading(false);
    });

    // 清理函数：标记已卸载，避免 setState 到已卸载组件
    return () => {
      cancelled = true;
    };
  }, [id]);

  // V4.0.0：所有者查看被驳回照片时拉取本人申诉记录（后端按创建时间倒序，取该照片最新一条）
  const isRejectedOwner = !!(user && photo?.status === 'rejected' && photo.user_id === user.id);
  useEffect(() => {
    if (!isRejectedOwner || !id) {
      setMyAppeal(null);
      return;
    }
    let cancelled = false;
    getMyAppeals()
      .then((res) => {
        if (cancelled || !res.success || !res.data) return;
        setMyAppeal(res.data.find((a) => a.photo_id === id) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isRejectedOwner, id]);

  /**
   * 切换点赞状态：未登录引导登录，已登录调用 likePhoto/unlikePhoto
   * 采用乐观更新策略 — 本地 state 立即更新让 UI 即时响应；
   * 服务器返回后用权威值校准，失败则回滚到点击前的状态。
   */
  const handleToggleLike = async () => {
    if (!photo) return;

    // 未登录：显示引导提示（client.ts 在请求层也会拦截 401 跳 /auth，这里前置避免无效请求）
    if (!user || !token) {
      setLikeError('请先登录后点赞');
      setTimeout(() => setLikeError(''), 3000);
      return;
    }
    if (likeLoading) return; // 防连点

    setLikeLoading(true);
    // 乐观更新快照（用于失败回滚）
    const prevLiked = isLiked;
    const prevCount = likeCount;
    setIsLiked(!prevLiked);
    setLikeCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      const result = prevLiked
        ? await unlikePhoto(photo.id)
        : await likePhoto(photo.id);
      if (!result.success || !result.data) {
        // 回滚
        setIsLiked(prevLiked);
        setLikeCount(prevCount);
        setLikeError(result.message || '操作失败');
        setTimeout(() => setLikeError(''), 3000);
      } else {
        // 用服务器权威值校准（防止并发下乐观更新与真实值有偏差）
        setIsLiked(result.data.is_liked);
        setLikeCount(result.data.likes);
      }
    } catch (err) {
      setIsLiked(prevLiked);
      setLikeCount(prevCount);
      setLikeError(err instanceof Error ? err.message : '网络错误');
      setTimeout(() => setLikeError(''), 3000);
    } finally {
      setLikeLoading(false);
    }
  };

  /**
   * 执行删除请求
   * 成功后跳转回画廊列表；失败时显示错误信息并于 3 秒后重置确认状态。
   */
  const handleDelete = async () => {
    if (!id || !token || isDeleting) return;

    setIsDeleting(true);
    const result = await verificationGuard('photo_delete', () => deletePhoto(id, token));
    
    if (result.success) {
      navigate('/gallery');
    } else {
      setDeleteMessage(result.message || '删除失败');
      setTimeout(() => {
        setDeleteMessage('');
        setDeleteConfirmStep(0);
      }, 3000);
    }
    
    setIsDeleting(false);
  };

  /**
   * 推进删除确认步骤
   * 未达到第二次确认时累加步骤；达到后真正触发删除。
   */
  const handleDeleteConfirm = () => {
    if (deleteConfirmStep < 2) {
      setDeleteConfirmStep(deleteConfirmStep + 1);
    } else {
      handleDelete();
    }
  };

  // 仅当当前登录用户与照片上传者 id 一致时，判定为所有者
  const isOwner = user && photo && photo.user_id === user.id;
  // 是否可查看真实图片（与 CachedImage「审核中」占位逻辑一致）：已审核或携带凭证
  const viewable = !(photo?.status && photo.status !== 'approved' && !token);

  /**
   * 下载带水印原图
   * 通过在代理 URL 上追加 download=1 参数，触发后端设置 Content-Disposition: attachment，
   * 浏览器原生流式下载到磁盘，无需前端 fetch blob 全量加载到内存，速度最快。
   * 对未审核照片，所有者需带 token 才能下载（代理路由按 photoId + 状态鉴权）。
   */
  const handleDownload = () => {
    if (!photo) return;
    // 带水印原图优先；无水印图时回退到原图（标注无水印）
    const baseUrl = photo.watermarked_url || photo.original_url;
    if (!baseUrl) {
      setDownloadError('该照片暂无可下载的原图');
      setTimeout(() => setDownloadError(''), 3000);
      return;
    }
    if (isDownloading) return;

    setIsDownloading(true);
    // 拼接 download=1 参数：原 URL 已含 ?photoId=xxx，追加 &download=1
    const sep = baseUrl.includes('?') ? '&' : '?';
    const downloadUrl = `${baseUrl}${sep}download=1`;

    // 所有者下载未审核照片时需带 token：通过隐藏 iframe 触发带凭证的下载
    // 已审核照片为公开资源，无需 token
    if (token && photo.status && photo.status !== 'approved') {
      // 所有者下载未审核照片：用 fetch 带 Authorization 头获取 blob
      fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => {
          if (!res.ok) throw new Error('下载失败');
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${photo.title || photo.id}.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        })
        .catch(() => {
          setDownloadError('下载失败，请稍后重试');
          setTimeout(() => setDownloadError(''), 3000);
        })
        .finally(() => setIsDownloading(false));
    } else {
      // 已审核公开照片：浏览器直接导航触发下载（同源 + Content-Disposition，最快）
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${photo.title || photo.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 给浏览器一点时间发起下载请求后恢复按钮
      setTimeout(() => setIsDownloading(false), 1500);
    }
  };

  /**
   * 发起申诉（V4.0.0）：原因必填，POST /photos/:id/appeal。
   * 成功后刷新本人申诉状态；409 APPEAL_IN_PROGRESS 提示已有申诉处理中。
   */
  const handleSubmitAppeal = async () => {
    if (!id || appealLoading) return;
    const reason = appealReason.trim();
    if (!reason) return;

    setAppealLoading(true);
    const result = await createAppeal(id, reason);
    if (result.success) {
      setAppealModalOpen(false);
      setAppealReason('');
      // 刷新该照片最新申诉状态
      const listRes = await getMyAppeals();
      if (listRes.success && listRes.data) {
        setMyAppeal(listRes.data.find((a) => a.photo_id === id) ?? null);
      }
      setAppealNotice('申诉已提交，请等待管理员裁决');
    } else if (result.code === 'APPEAL_IN_PROGRESS') {
      setAppealModalOpen(false);
      setAppealReason('');
      setAppealNotice('该作品已有待处理的申诉，请耐心等待裁决');
    } else {
      setAppealNotice(result.message || '申诉提交失败');
    }
    setTimeout(() => setAppealNotice(''), 3000);
    setAppealLoading(false);
  };

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className={`w-8 h-8 border-4 border-t-transparent rounded-full animate-spin ${
          theme === 'dark' ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-blue-600'
        }`} />
      </div>
    );
  }

  if (!photo) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-4 theme-text-transition ${
            theme === 'dark' ? 'text-white' : 'text-gray-800'
          }`}>照片不存在</h1>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="py-8 px-4">
      {verificationModal}

      {/* V4.0.0：发起申诉弹窗（原因必填） */}
      {appealModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => !appealLoading && setAppealModalOpen(false)}
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
                onClick={() => setAppealModalOpen(false)}
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
      <div className="max-w-6xl mx-auto">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate('/gallery');
          }}
          className={`flex items-center gap-2 mb-6 transition-colors theme-text-transition ${
            theme === 'dark'
              ? 'text-slate-300 hover:text-white'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回作品集
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 flex justify-center items-start">
            <div className={`rounded-xl shadow-lg overflow-hidden theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              {/* 移动端/触屏：双击 + pinch 手势缩放容器；「审核中」占位图不挂手势（viewable=false） */}
              {(isMobile || isTouch) && viewable ? (
                <MobileZoomableImage
                  src={photo.watermarked_url || photo.preview_url || photo.original_url}
                  alt={photo.title}
                  status={photo.status}
                  authToken={token || undefined}
                />
              ) : (
                <CachedImage
                  src={photo.watermarked_url || photo.preview_url || photo.original_url}
                  alt={photo.title}
                  status={photo.status}
                  authToken={token || undefined}
                  className="block max-w-full h-auto"
                />
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div
              onClick={() => photo.uploader && navigate(`/users/${photo.uploader.id}`)}
              className={`rounded-xl shadow-lg p-4 theme-bg-transition ${
                theme === 'dark' ? 'glass' : 'bg-white'
              } ${photo.uploader ? 'cursor-pointer hover:shadow-xl transition-shadow' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full overflow-hidden flex-shrink-0 ${
                  photo.uploader?.avatar_url
                    ? ''
                    : 'bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center'
                }`}>
                  {photo.uploader?.avatar_url ? (
                    <img
                      src={photo.uploader.avatar_url.startsWith('/') ? `/api${photo.uploader.avatar_url}` : photo.uploader.avatar_url}
                      alt={photo.uploader.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className={`font-semibold ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>上传者</p>
                  <p className={`text-sm ${
                    photo.uploader
                      ? theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'
                      : theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}>{photo.uploader?.username || '匿名用户'}</p>
                </div>
              </div>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h1 className={`text-2xl font-bold mb-2 transition-colors ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>{photo.title}</h1>
              <p className={`text-sm theme-text-transition ${
                theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
              }`}>{formatDate(photo.created_at)}</p>
              {/* 移动端数据行：12px 灰色纯文本（无图标），桌面端由数据统计卡片承载 */}
              <p className="mt-2 text-xs text-gray-400 md:hidden">
                {commentCount === null ? '—' : commentCount} 评论 · {likeCount} 点赞 · {viewCount.toLocaleString()} 浏览
              </p>
            </div>

            {/* V4.0.0：所有者查看被驳回照片时的申诉状态卡 */}
            {isRejectedOwner && (
              <div className="rounded-xl shadow-lg p-6 bg-white">
                <h2 className="text-lg font-semibold mb-3 text-gray-900">审核申诉</h2>

                {/* 驳回理由与审核员编号（V4.1.2-beta.3：便于用户核对并作为申诉举证依据） */}
                <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <p className="text-sm text-red-700">
                    <span className="text-red-500">驳回理由：</span>
                    {photo.rejection_reason || '未填写驳回理由'}
                  </p>
                  <p className="text-xs text-red-500 mt-1">
                    审核员：{photo.reviewer?.name || '未知'}
                    {photo.reviewer?.reviewed_at && ` · ${formatDate(photo.reviewer.reviewed_at)}`}
                  </p>
                </div>

                {appealNotice && (
                  <p className="mb-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    {appealNotice}
                  </p>
                )}

                {myAppeal ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                          myAppeal.status === 'pending'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : myAppeal.status === 'approved'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}
                      >
                        {myAppeal.status === 'pending'
                          ? '申诉处理中'
                          : myAppeal.status === 'approved'
                            ? '申诉已通过'
                            : myAppeal.status === 'rejected'
                              ? '申诉未通过'
                              : '申诉已撤回'}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(myAppeal.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      <span className="text-gray-400">申诉理由：</span>
                      {myAppeal.reason}
                    </p>
                    {myAppeal.response && (
                      <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-gray-400">管理员答复：</span>
                        {myAppeal.response}
                      </p>
                    )}
                    {/* 仅非处理中状态可再次发起（撤回或被驳回后均可重新申诉） */}
                    {myAppeal.status !== 'pending' && (
                      <button
                        onClick={() => setAppealModalOpen(true)}
                        disabled={appealLoading}
                        className="mt-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        再次发起申诉
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">
                      您的作品未通过审核。如认为审核有误，可发起申诉，管理员将复核并答复。
                    </p>
                    <button
                      onClick={() => setAppealModalOpen(true)}
                      disabled={appealLoading}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      发起申诉
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>照片信息</h2>
              <div className="space-y-4">
                {photo.registration_number && (
                  <div className="flex justify-between items-center">
                    <span className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>注册号</span>
                    <span className={`font-medium text-sm font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{photo.registration_number}</span>
                  </div>
                )}
                <DetailRow label="拍摄工具" value={photo.vehicle} theme={theme} />
                <DetailRow label="相机型号" value={photo.camera_model} theme={theme} />
                <DetailRow label="拍摄地点" value={photo.location} theme={theme} />
              </div>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>拍摄参数</h2>
              <div className="grid grid-cols-2 gap-4">
                <DetailRow label="焦距" value={photo.focal_length} theme={theme} />
                <DetailRow label="ISO" value={photo.iso.toString()} theme={theme} />
                <DetailRow label="快门" value={photo.shutter_speed} theme={theme} />
                <DetailRow label="光圈" value={photo.aperture} theme={theme} />
              </div>
            </div>

            {/* 下载卡片：桌面端原位展示；移动端由底部固定下载栏承载（避免重复入口） */}
            <div className={`hidden md:block rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>下载</h2>
              {/* 下载带水印原图按钮：公开照片走浏览器原生下载（最快），未审核照片所有者带 token fetch */}
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                title={photo.watermarked_url ? '下载带水印原图' : '下载原图（无水印版）'}
                className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-bold shadow-md transition-all ${
                  isDownloading
                    ? 'opacity-50 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer hover:scale-[1.03] hover:shadow-lg active:scale-95'
                }`}
              >
                <Download className="w-6 h-6" strokeWidth={2.5} />
                {isDownloading ? '下载中...' : (photo.watermarked_url ? '下载带水印原图' : '下载原图')}
              </button>
              {downloadError && (
                <p className="mt-3 text-sm text-red-500 text-center">{downloadError}</p>
              )}
              {!photo.watermarked_url && (
                <p className="mt-2 text-xs text-center text-gray-400">该照片暂无水印版本，将下载原图</p>
              )}
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>数据统计</h2>
              <div className="flex gap-4 items-center flex-wrap">
                {/* 点赞按钮：可点击切换状态，Heart 图标红色填充=已点赞/描边=未点赞；移动端热区 ≥44px */}
                <button
                  onClick={handleToggleLike}
                  disabled={likeLoading}
                  aria-label={isLiked ? '取消点赞' : '点赞'}
                  title={user ? (isLiked ? '取消点赞' : '点赞') : '请先登录后点赞'}
                  className={`flex items-center gap-2 px-4 py-2 max-md:min-h-[44px] rounded-lg transition-all ${
                    isLiked
                      ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                      : theme === 'dark'
                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  } ${likeLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105'}`}
                >
                  <Heart
                    className={`w-5 h-5 transition-transform ${isLiked ? 'fill-current scale-110' : ''}`}
                    strokeWidth={2}
                  />
                  <span className="font-semibold text-lg">{likeCount}</span>
                </button>
                {/* 浏览数：纯展示，Eye 图标 + 数字；移动端浏览数并入标题卡数据行，此处隐藏 */}
                <div className={`hidden md:flex items-center gap-2 px-4 py-2 ${
                  theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
                }`}>
                  <Eye className="w-5 h-5" strokeWidth={2} />
                  <span className="font-semibold text-lg">{viewCount.toLocaleString()}</span>
                </div>
              </div>
              {likeError && (
                <p className="mt-3 text-sm text-red-500 text-center">{likeError}</p>
              )}
              {!user && (
                <p className="mt-2 text-xs text-center text-gray-400">
                  <button
                    onClick={() => navigate('/auth')}
                    className="text-blue-500 hover:underline"
                  >
                    登录
                  </button>
                  后即可点赞
                </p>
              )}
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>描述</h2>
              <p className={`leading-relaxed ${
                theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
              }`}>{photo.description}</p>
            </div>

            <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
              theme === 'dark' ? 'glass' : 'bg-white'
            }`}>
              <h2 className={`text-lg font-semibold mb-4 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>标签</h2>
              <div className="flex flex-wrap gap-2">
                {photo.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      theme === 'dark'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {isOwner && (
              <div className={`rounded-xl shadow-lg p-6 theme-bg-transition ${
                theme === 'dark' ? 'glass' : 'bg-white'
              }`}>
                {deleteConfirmStep > 0 ? (
                  <div className="space-y-4">
                    <p className={`text-center font-medium ${
                      theme === 'dark' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      {deleteConfirmStep === 1
                        ? '确定要删除这张照片吗？此操作无法撤销。'
                        : '再次确认：删除后将永久删除所有相关数据！'}
                    </p>
                    <div className="flex gap-4">
                      <button
                        onClick={() => setDeleteConfirmStep(0)}
                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                          theme === 'dark'
                            ? 'bg-white/10 text-slate-300 hover:bg-white/20'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        取消
                      </button>
                      <button
                        onClick={handleDeleteConfirm}
                        disabled={isDeleting}
                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                          isDeleting
                            ? 'opacity-50 cursor-not-allowed'
                            : theme === 'dark'
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : 'bg-red-500 text-white hover:bg-red-600'
                        }`}
                      >
                        {isDeleting ? '删除中...' : '确认删除'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmStep(1)}
                    disabled={isDeleting}
                    className={`w-full py-3 rounded-lg font-medium transition-colors ${
                      isDeleting
                        ? 'opacity-50 cursor-not-allowed'
                        : theme === 'dark'
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : 'bg-red-50 text-red-600 hover:bg-red-100'
                    }`}
                  >
                    删除照片
                  </button>
                )}
                {deleteMessage && (
                  <p className="mt-4 text-center text-sm text-red-500">{deleteMessage}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 通用三级评论区（subject_type=photo）；归档/热度/人机门均在 CommentList 内完成 */}
      <div className="mt-10 rounded-xl border border-gray-200 bg-white p-5 md:p-7">
        <CommentList
          subject={{ subjectType: 'photo', subjectId: id || '' }}
          title="作品评论"
          onTotalChange={setCommentCount}
        />
      </div>

      {/* 移动端：为底部固定下载栏预留空间，防止遮挡评论区底部内容 */}
      <div className="h-20 md:hidden" aria-hidden="true" />

      {/* 移动端底部固定下载栏：位于全局 MobileTabBar（56px + 安全区）正上方；
          下载逻辑与桌面端完全一致（公开照片原生导航下载 / 未审核所有者 fetch blob） */}
      <div
        className="fixed inset-x-0 z-40 border-t border-gray-200 bg-white px-4 py-2 md:hidden"
        style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
      >
        {downloadError && (
          <p className="mb-1 text-center text-xs text-red-500">{downloadError}</p>
        )}
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          title={photo.watermarked_url ? '下载带水印原图' : '下载原图（无水印版）'}
          className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold shadow-md transition-all ${
            isDownloading
              ? 'opacity-50 cursor-not-allowed bg-blue-600 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]'
          }`}
        >
          <Download className="w-5 h-5" strokeWidth={2.5} />
          {isDownloading ? '下载中...' : (photo.watermarked_url ? '下载带水印原图' : '下载原图')}
        </button>
      </div>
    </main>
  );
}

/**
 * 详情信息行
 * 用于在"照片信息""拍摄参数"等卡片中渲染单行键值对。
 * @param label 行标签文本
 * @param value 行值文本
 * @param theme 当前主题，用于适配深浅色样式
 */
function DetailRow({ label, value, theme }: { label: string; value: string; theme: 'dark' | 'light' }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${
        theme === 'dark' ? 'text-slate-400' : 'text-gray-500'
      }`}>{label}</span>
      <span className={`font-medium text-sm ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>{value}</span>
    </div>
  );
}