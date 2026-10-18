/**
 * 照片审核详情页
 * 展示大图预览、完整元数据（EXIF + 用户填写）、上传者信息，
 * 并在底部提供通过/拒绝审核的操作按钮。
 * V4.0.0：approved 状态增加「召回」（窗口内静默 / 超窗需原因）、「确认热门」与「分配/转移」操作。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  X,
  MapPin,
  Camera,
  Aperture,
  Gauge,
  Maximize2,
  Tag,
  User,
  Image as ImageIcon,
  Hash,
  Eye,
  ThumbsUp,
  ShieldAlert,
  Gavel,
} from 'lucide-react';
import {
  getPhotoDetail,
  approvePhoto,
  rejectPhoto,
  getAdminToken,
  getAdminUsers,
  recallPhoto,
  confirmPhotoHot,
  assignPhoto,
} from './api';
import type { AdminPhotoDetail, AdminUser } from './types';
import { CachedImage } from '../components/CachedImage';
import { AuditToolkit } from './audit-tools';

/**
 * 照片审核详情页组件
 * @param id 照片 ID
 * @param currentAdmin 当前登录管理员（用于判断是否展示分配下拉：分配对象列表接口仅 super/zone_master 可访问）
 * @returns 加载态 / 详情页 JSX
 */
export function PhotoDetailPage({ id, currentAdmin }: { id: string; currentAdmin?: AdminUser | null }) {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<AdminPhotoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  // 管理员 Token：用于加载需要鉴权的未审核照片图片
  const adminToken = getAdminToken();

  // V4.0.0 操作状态
  // notice：底部操作栏上方的操作结果提示
  const [notice, setNotice] = useState('');
  // recallLoading：召回请求进行中；showRecallModal：超窗原因对话框
  const [recallLoading, setRecallLoading] = useState(false);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [recallReason, setRecallReason] = useState('');
  // hotLoading：确认热门请求进行中
  const [hotLoading, setHotLoading] = useState(false);
  // 分配：候选审核员列表与选中项（仅 super/zone_master 加载）
  const [assignees, setAssignees] = useState<AdminUser[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  // 是否可展示分配下拉：分配对象列表接口（GET /admin/users）仅 super/zone_master 可访问
  const canAssign = !currentAdmin || currentAdmin.role === 'super' || currentAdmin.role === 'zone_master';

  // 加载照片详情
  useEffect(() => {
    if (!id) return;
    fetchDetail();
  }, [id]);

  // 分配候选：照片进入 approved 状态时拉取管理员列表并过滤启用状态的 zone_auditor / zone_master
  const photoStatus = photo?.status;
  useEffect(() => {
    if (photoStatus === 'approved' && canAssign) {
      getAdminUsers().then((res) => {
        if (res.success && res.data) {
          setAssignees(res.data.filter((a) => a.is_active && (a.role === 'zone_auditor' || a.role === 'zone_master')));
        }
      }).catch(() => {});
    }
  }, [photoStatus, canAssign]);

  /** 拉取照片详情 */
  const fetchDetail = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    if (!id) return;
    const result = await getPhotoDetail(id);
    if (result.success && result.data) {
      setPhoto(result.data);
    } else if (!result.success && result.message && result.message.includes('分区')) {
      // 后端返回 403：当前管理员无权访问该照片所属分区
      setError('forbidden_zone');
    } else {
      setError(result.message || '加载失败');
    }
    setLoading(false);
  };

  /**
   * 展示操作结果提示（3 秒自动清空）
   * @param text 提示文本
   */
  const showNotice = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 3000);
  };

  /** 通过审核 */
  const handleApprove = async () => {
    if (!id) return;
    setActionLoading(true);
    const result = await approvePhoto(id);
    if (result.success) {
      navigate('/admin/photos');
    } else {
      setError(result.message || '操作失败');
    }
    setActionLoading(false);
  };

  /** 拒绝审核 */
  const handleReject = async () => {
    if (!id || !rejectReason.trim()) return;
    setActionLoading(true);
    const result = await rejectPhoto(id, rejectReason.trim());
    if (result.success) {
      navigate('/admin/photos');
    } else {
      setError(result.message || '操作失败');
    }
    setActionLoading(false);
  };

  /**
   * 召回已通过照片（V4.0.0）
   * 流程：先无 reason 调用 → 窗口内静默召回成功直接刷新；
   * 400 REASON_REQUIRED 弹出原因对话框由用户重发；400 HOT_NOT_RECALLABLE 提示热门不可召回。
   */
  const handleRecall = async (reason?: string) => {
    if (!id || recallLoading) return;
    setRecallLoading(true);
    const result = await recallPhoto(id, reason?.trim() || undefined);
    if (result.success) {
      setShowRecallModal(false);
      setRecallReason('');
      // 按后端响应区分：窗口内静默（不通知所有者）/ 超窗召回（已推送召回通知）
      showNotice(result.data?.silent ? '已召回至待审核（窗口内静默，未通知所有者）' : '已召回至待审核，已通知作品所有者');
      await fetchDetail();
    } else if (result.code === 'REASON_REQUIRED') {
      // 超窗召回：必须填写原因，弹出原因对话框等待用户重发
      setShowRecallModal(true);
      showNotice('已超出召回时限，请填写召回原因');
    } else {
      // 含 HOT_NOT_RECALLABLE（热门作品禁止召回）与无权限等场景
      setShowRecallModal(false);
      showNotice(result.message || '召回失败');
    }
    setRecallLoading(false);
  };

  /** 确认热门（V4.0.0）：二次确认后调用，成功后刷新详情展示已确认状态 */
  const handleConfirmHot = async () => {
    if (!id || hotLoading) return;
    if (!confirm('确认将该作品标记为热门？确认后将通知作品所有者，且该作品不可再被召回。')) return;
    setHotLoading(true);
    const result = await confirmPhotoHot(id);
    if (result.success) {
      showNotice(result.message || '已确认为热门作品');
      await fetchDetail();
    } else {
      showNotice(result.message || '操作失败');
    }
    setHotLoading(false);
  };

  /** 分配/转移审核任务（V4.0.0）：将照片指派给下拉选中的审核员 */
  const handleAssign = async () => {
    if (!id || !assigneeId || assignLoading) return;
    setAssignLoading(true);
    const result = await assignPhoto(id, assigneeId);
    if (result.success) {
      showNotice(result.message || '照片已分配');
    } else {
      showNotice(result.message || '分配失败');
    }
    setAssignLoading(false);
  };

  // 加载态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  // 分区权限被拒：展示专门的占位提示，不显示任何照片内容
  if (error === 'forbidden_zone') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 py-20 flex flex-col items-center justify-center text-center">
        <ShieldAlert className="w-20 h-20 text-gray-800 mb-6" />
        <p className="text-2xl font-bold text-black mb-8">该图片不是你所负责的分区</p>
        <button
          onClick={() => navigate('/admin/photos')}
          className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium transition-colors"
        >
          返回列表
        </button>
      </div>
    );
  }

  // 错误态
  if (error || !photo) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error || '照片不存在'}</p>
        <button
          onClick={() => navigate('/admin/photos')}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
        >
          返回列表
        </button>
      </div>
    );
  }

  // 确定要展示的主图：水印图 > 预览图 > 原图
  const mainImage =
    photo.watermarked_url || photo.preview_url || photo.original_url;

  return (
    <div className="max-w-6xl mx-auto">
      {/* 顶部：返回按钮 + 标题 + 状态徽章 */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/admin/photos')}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          返回列表
        </button>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800">{photo.title}</h1>
          {photo.is_hot_confirmed === 1 && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium border bg-violet-50 text-violet-700 border-violet-200">
              已确认热门
            </span>
          )}
          <StatusBadge status={photo.status} />
        </div>
      </div>

      {/* 主体：左侧图片 + 右侧信息 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：大图预览 + 审核工具集 */}
        <div className="lg:col-span-2">
          <AuditToolkit
            src={mainImage}
            alt={photo.title}
            authToken={adminToken || undefined}
            imageClassName="w-full max-h-[600px] object-contain bg-gray-50"
            footer={
              <>
                <div className="flex items-center gap-4">
                  {photo.width > 0 && photo.height > 0 && (
                    <span className="flex items-center gap-1">
                      <Maximize2 className="w-4 h-4" />
                      {photo.width} × {photo.height}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    {photo.views}
                  </span>
                  <span className="flex items-center gap-1">
                    <ThumbsUp className="w-4 h-4" />
                    {photo.likes}
                  </span>
                </div>
                {photo.watermark_config && (
                  <span className="flex items-center gap-1 text-blue-800">
                    <ImageIcon className="w-4 h-4" />
                    已添加水印
                  </span>
                )}
              </>
            }
          />

          {/* 缩略图选择 */}
          <div className="flex gap-3 mt-4">
            {photo.watermarked_url && (
              <ThumbButton
                src={photo.watermarked_url}
                active={mainImage === photo.watermarked_url}
                onClick={() =>
                  setPhoto({ ...photo, watermarked_url: photo.watermarked_url! })
                }
                label="水印图"
                authToken={adminToken || undefined}
              />
            )}
            {photo.preview_url && (
              <ThumbButton
                src={photo.preview_url}
                active={mainImage === photo.preview_url}
                onClick={() =>
                  setPhoto({ ...photo, preview_url: photo.preview_url! })
                }
                label="预览图"
                authToken={adminToken || undefined}
              />
            )}
            <ThumbButton
              src={photo.original_url}
              active={mainImage === photo.original_url}
              onClick={() =>
                setPhoto({ ...photo, original_url: photo.original_url })
              }
              label="原图"
              authToken={adminToken || undefined}
            />
          </div>
        </div>

        {/* 右侧：详细信息 */}
        <div className="space-y-4">
          {/* 上传者信息 */}
          <InfoCard title="上传者信息" icon={<User className="w-5 h-5" />}>
            <div className="flex items-center gap-3">
              {photo.uploader_avatar ? (
                <img
                  src={photo.uploader_avatar.startsWith('/') ? `/api${photo.uploader_avatar}` : photo.uploader_avatar}
                  alt={photo.uploader_name}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                  <User className="w-5 h-5" />
                </div>
              )}
              <div>
                <p className="font-medium text-gray-800">
                  {photo.uploader_name || '匿名用户'}
                </p>
                <p className="text-xs text-gray-500">
                  {new Date(photo.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
            {/* V4.1.0：跳转用户封禁管理页预选该上传者 */}
            {photo.user_id && (
              <button
                onClick={() => navigate(`/admin/bans?userId=${encodeURIComponent(photo.user_id!)}`)}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium transition-colors"
              >
                <Gavel className="w-4 h-4" />
                处罚该用户
              </button>
            )}
          </InfoCard>

          {/* 用户填写信息 */}
          <InfoCard title="用户填写信息" icon={<Hash className="w-5 h-5" />}>
            <div className="space-y-3 text-sm">
              <InfoRow label="标题" value={photo.title} />
              <InfoRow
                label="飞机注册号"
                value={photo.registration_number || '（未填写）'}
              />
              {photo.is_hot === 1 && (
                <p className="text-sm text-gray-600">用户热门意愿: 是</p>
              )}
              <InfoRow
                label="描述"
                value={photo.description || '（未填写）'}
                multiline
              />
              {photo.tags && photo.tags.length > 0 && (
                <div>
                  <span className="text-gray-500 text-xs block mb-1">标签</span>
                  <div className="flex flex-wrap gap-1">
                    {photo.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {photo.category && (
                <InfoRow label="分类" value={photo.category} />
              )}
            </div>
          </InfoCard>

          {/* EXIF 元数据 */}
          <InfoCard title="EXIF 元数据" icon={<Camera className="w-5 h-5" />}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow
                label="相机"
                value={photo.camera_model || '-'}
                icon={<Camera className="w-3 h-3" />}
              />
              <InfoRow
                label="设备"
                value={photo.vehicle || '-'}
                icon={<ImageIcon className="w-3 h-3" />}
              />
              <InfoRow
                label="焦距"
                value={photo.focal_length || '-'}
                icon={<Aperture className="w-3 h-3" />}
              />
              <InfoRow
                label="光圈"
                value={photo.aperture || '-'}
                icon={<Aperture className="w-3 h-3" />}
              />
              <InfoRow
                label="ISO"
                value={photo.iso ? String(photo.iso) : '-'}
                icon={<Gauge className="w-3 h-3" />}
              />
              <InfoRow
                label="快门"
                value={photo.shutter_speed || '-'}
                icon={<Gauge className="w-3 h-3" />}
              />
              <InfoRow
                label="位置"
                value={photo.location || '-'}
                icon={<MapPin className="w-3 h-3" />}
              />
            </div>
          </InfoCard>

          {/* 水印配置 */}
          {photo.watermark_config && (
            <InfoCard title="水印配置" icon={<ImageIcon className="w-5 h-5" />}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow
                  label="水印文字"
                  value={photo.watermark_config.text}
                />
                <InfoRow
                  label="位置"
                  value={`(${photo.watermark_config.x}, ${photo.watermark_config.y})`}
                />
                <InfoRow
                  label="大小"
                  value={String(photo.watermark_config.size)}
                />
                <InfoRow
                  label="透明度"
                  value={`${Math.round(photo.watermark_config.opacity * 100)}%`}
                />
              </div>
            </InfoCard>
          )}

          {/* 结构化标签 */}
          {photo.structured_tags && Object.keys(photo.structured_tags).length > 0 && (
            <InfoCard title="结构化标签" icon={<Tag className="w-5 h-5" />}>
              <div className="space-y-2 text-sm">
                {Object.entries(photo.structured_tags).map(([key, value]) => (
                  <InfoRow key={key} label={key} value={String(value)} />
                ))}
              </div>
            </InfoCard>
          )}

          {/* 驳回理由（仅 rejected 状态显示） */}
          {photo.status === 'rejected' && photo.rejection_reason && (
            <div className="rounded-xl p-4 bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-800 mb-1">驳回理由</p>
              <p className="text-sm text-red-600">{photo.rejection_reason}</p>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作栏：approved 状态的召回 / 确认热门 / 分配（V4.0.0） */}
      {photo.status === 'approved' && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
          {notice && (
            <p className="mb-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
              {notice}
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-gray-500 mr-auto">
              {photo.is_hot_confirmed === 1
                ? '该作品已确认为热门，不可召回'
                : '审核纠错：召回将使照片回到待审核队列'}
            </p>
            {/* 召回：窗口内静默；超窗弹出原因必填对话框 */}
            <button
              onClick={() => handleRecall()}
              disabled={recallLoading}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {recallLoading ? '召回中...' : '召回'}
            </button>
            {/* 确认热门：未确认时显示 */}
            {photo.is_hot_confirmed !== 1 && (
              <button
                onClick={handleConfirmHot}
                disabled={hotLoading}
                className="px-4 py-2 bg-violet-50 hover:bg-violet-100 border border-violet-200 disabled:opacity-50 text-violet-700 rounded-lg text-sm font-medium transition-colors"
              >
                {hotLoading ? '提交中...' : '确认热门'}
              </button>
            )}
            {/* 分配/转移：仅 super/zone_master 展示（分配对象列表接口权限） */}
            {canAssign && assignees.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                >
                  <option value="">分配/转移给审核员...</option>
                  {assignees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.username}（{a.role === 'zone_master' ? '总审核' : '审核员'} · {a.zone || '-'}）
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAssign}
                  disabled={!assigneeId || assignLoading}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg text-sm font-medium transition-colors"
                >
                  {assignLoading ? '分配中...' : '分配'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部操作栏 */}
      {photo.status === 'pending' && (
        <div className="sticky bottom-0 mt-8 py-4 bg-white border-t border-gray-200">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              请仔细查看照片内容和元数据后再进行审核操作
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectModal(true)}
                disabled={actionLoading}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                拒绝
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                通过
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拒绝弹窗 */}
      {showRejectModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            if (!actionLoading) setShowRejectModal(false);
          }}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-4">拒绝照片</h3>
            <p className="text-sm text-gray-600 mb-4">
              请填写拒绝理由，将告知上传者：
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full h-32 p-3 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="请输入拒绝原因..."
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowRejectModal(false)}
                disabled={actionLoading}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || actionLoading}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg transition-colors"
              >
                {actionLoading ? '提交中...' : '确认拒绝'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 超窗召回原因弹窗（V4.0.0）：400 REASON_REQUIRED 触发，原因必填后重发召回 */}
      {showRecallModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            if (!recallLoading) setShowRecallModal(false);
          }}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-2">填写召回原因</h3>
            <p className="text-sm text-gray-600 mb-4">
              已超出静默召回时限，召回将通知作品所有者，请填写召回原因：
            </p>
            <textarea
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
              className="w-full h-28 p-3 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-700"
              placeholder="请输入召回原因，例如：误判..."
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowRecallModal(false)}
                disabled={recallLoading}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleRecall(recallReason)}
                disabled={!recallReason.trim() || recallLoading}
                className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg transition-colors"
              >
                {recallLoading ? '提交中...' : '确认召回'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 状态徽章组件 */
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { text: string; className: string }> = {
    pending: {
      text: '待审核',
      className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    },
    approved: {
      text: '已通过',
      className: 'bg-green-100 text-green-700 border-green-200',
    },
    rejected: {
      text: '已拒绝',
      className: 'bg-red-100 text-red-700 border-red-200',
    },
  };
  const item = config[status] || config.pending;
  return (
    <span
      className={`px-3 py-1 rounded-full text-sm font-medium border ${item.className}`}
    >
      {item.text}
    </span>
  );
}

/** 信息卡片组件 */
function InfoCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-4 bg-gray-50 border border-gray-100">
      <h3 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

/** 信息行组件 */
function InfoRow({
  label,
  value,
  icon,
  multiline,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div className={multiline ? 'col-span-2' : ''}>
      <span className="text-gray-500 text-xs block mb-0.5 flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-gray-800 text-sm break-words">
        {value || '-'}
      </span>
    </div>
  );
}

/** 缩略图按钮组件 */
function ThumbButton({
  src,
  active,
  onClick,
  label,
  authToken,
}: {
  src: string;
  active: boolean;
  onClick: () => void;
  label: string;
  authToken?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
        active ? 'border-blue-700 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <CachedImage
        src={src}
        alt={label}
        authToken={authToken}
        cacheEnabled={false}
        className="w-full h-full object-cover"
      />
    </button>
  );
}