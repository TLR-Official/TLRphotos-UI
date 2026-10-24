/**
 * @file 移动端上传页（/m/upload，Wave 2）
 * @description
 *  四步分步表单：选图 → 填信息 → 水印 → 确认提交。
 *  设计红线：白底黑字、accent=blue-700、无暗色无 emoji、单文件上传、
 *  注册号仅航空分区必填（V4.1.2-beta.2 前后端一致规则）、水印文案固定 TLRphotos、
 *  热区 ≥44px、通栏按钮 h-12。
 *  上传链路与桌面端 UploadPage 一致（POST /api/photos/upload 直传，服务端生成
 *  缩略图/水印并写入 OSS），以 XHR upload.onprogress 提供真实进度；
 *  403 HUMAN_VERIFICATION_REQUIRED 复用 useHumanVerification 验证门自动重试；
 *  元数据草稿存 localStorage（mobile_upload_draft，不含图片）。
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import exifr from 'exifr';
import { useUser } from '../../../shared/UserContext';
import { useHumanVerification } from '../../../shared/useHumanVerification';
import { MobileBackHeader } from '../../../shared/MobileBackHeader';
import { useTip } from '../../../shared/useTip';
import { TagSelector } from '../../../components/TagSelector';
import type { SelectedTag } from '../../../components/TagSelector';
import type { ApiResponse } from '../../../api/client';
import type { DirectUploadResponse, PhotoUploadMeta } from '../../../api/photos';
import { WatermarkEditor } from './WatermarkEditor';
import {
  watermarkPosToXY,
  WATERMARK_POS_LABELS,
  WATERMARK_SIZE_TIERS,
  DEFAULT_WATERMARK,
} from './watermark';
import type { WatermarkValue } from './watermark';
import { uploadPhotoWithProgress } from './uploadWithProgress';
import type { UploadHandle } from './uploadWithProgress';
import { NETWORK_ERROR_CODE, UPLOAD_ABORTED_CODE } from './uploadWithProgress';

/** 照片分区 */
type Category = 'aviation' | 'railway' | 'automobile';

/** 分区三选一卡片（id 与后端分类一致；label 按移动端 PRD 用词） */
const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'aviation', name: '航空' },
  { id: 'railway', name: '铁路' },
  { id: 'automobile', name: '公路' },
];

/** 分步标题 */
const STEPS = ['选图', '填信息', '水印', '确认'] as const;

/** 水印固定文案（用户不可改） */
const WATERMARK_TEXT = 'TLRphotos';

/** 本地草稿 key（仅存元数据，不存图片） */
const DRAFT_KEY = 'mobile_upload_draft';

/** 允许的图片 MIME 类型与大小上限（与桌面端一致：50MB） */
const VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 注册号格式：2-20 位字母/数字/连字符（首位不允许连字符），与后端一致 */
const REGISTRATION_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

/** 网络异常自动重试退避（1s / 2s / 4s，共 3 次） */
const RETRY_DELAYS = [1000, 2000, 4000];

/** 从 EXIF 解析得到的拍摄参数（静默采集，随元数据提交，与桌面端一致） */
interface ExifData {
  camera_model?: string;
  focal_length?: string;
  iso?: number;
  shutter_speed?: string;
  aperture?: string;
  location?: string;
  width?: number;
  height?: number;
}

/** localStorage 草稿结构（仅元数据） */
interface DraftPayload {
  title: string;
  description: string;
  category: Category | null;
  selectedTags: SelectedTag[];
  registrationNumber: string;
  isHot: boolean;
  safetyAgreement: boolean;
  licenseAgreement: boolean;
  watermark: WatermarkValue;
  savedAt: number;
}

/** 读取本地草稿；无草稿或解析失败返回 null */
function loadDraft(): DraftPayload | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftPayload>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      category:
        parsed.category === 'aviation' || parsed.category === 'railway' || parsed.category === 'automobile'
          ? parsed.category
          : null,
      selectedTags: Array.isArray(parsed.selectedTags) ? parsed.selectedTags : [],
      registrationNumber: typeof parsed.registrationNumber === 'string' ? parsed.registrationNumber : '',
      isHot: parsed.isHot === true,
      safetyAgreement: parsed.safetyAgreement === true,
      licenseAgreement: parsed.licenseAgreement === true,
      watermark:
        parsed.watermark &&
        typeof parsed.watermark.posIndex === 'number' &&
        typeof parsed.watermark.size === 'number' &&
        typeof parsed.watermark.opacity === 'number'
          ? parsed.watermark
          : DEFAULT_WATERMARK,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** 草稿是否含有意义内容（决定是否提示「已恢复上次草稿」） */
function isDraftMeaningful(draft: DraftPayload | null): draft is DraftPayload {
  if (!draft) return false;
  return Boolean(
    draft.title.trim() ||
      draft.description.trim() ||
      draft.category ||
      draft.selectedTags.length > 0 ||
      draft.registrationNumber.trim() ||
      draft.isHot,
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 上传遮罩阶段 */
type UploadPhase = 'uploading' | 'retrying' | 'failed' | 'success';

/**
 * 移动端上传页组件
 * @returns 移动端四步上传流程 JSX；未登录时渲染登录引导
 */
export function MobileUploadPage() {
  const navigate = useNavigate();
  const { isAuthenticated, token, user } = useUser();
  // 人机验证门：上传被 403 拦截时弹窗，通过后自动重试
  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification();
  // 步骤提示条：最多显示 3 次，可手动「不再显示」
  const { visible: stepsTipVisible, dismiss: dismissStepsTip } = useTip('m_upload_steps', 3);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const registrationInputRef = useRef<HTMLInputElement>(null);
  const tagSectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<UploadHandle | null>(null);

  // 惰性读取草稿并直接作为各字段初始值（避免挂载期先写空草稿覆盖已有草稿）
  const [initialDraft] = useState<DraftPayload | null>(() => {
    const draft = loadDraft();
    return isDraftMeaningful(draft) ? draft : null;
  });

  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [draftRestored, setDraftRestored] = useState(initialDraft !== null);

  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const [description, setDescription] = useState(initialDraft?.description ?? '');
  const [category, setCategory] = useState<Category | null>(initialDraft?.category ?? null);
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>(initialDraft?.selectedTags ?? []);
  const [registrationNumber, setRegistrationNumber] = useState(initialDraft?.registrationNumber ?? '');
  const [isHot, setIsHot] = useState(initialDraft?.isHot ?? false);
  const [safetyAgreement, setSafetyAgreement] = useState(initialDraft?.safetyAgreement ?? false);
  // 版权协议同意（必选）：勾选后方可提交
  const [licenseAgreement, setLicenseAgreement] = useState(initialDraft?.licenseAgreement ?? false);
  const [watermark, setWatermark] = useState<WatermarkValue>(initialDraft?.watermark ?? DEFAULT_WATERMARK);
  const [exif, setExif] = useState<ExifData>({});
  const [hotSheetOpen, setHotSheetOpen] = useState(false);

  // 上传遮罩状态
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('uploading');
  const [retryInfo, setRetryInfo] = useState('');

  // 卸载或 preview 变更时释放上一个 ObjectURL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // 切换分区时清空已选标签（与桌面端一致）；首次挂载（草稿恢复）不清空
  const categoryMountedRef = useRef(true);
  useEffect(() => {
    if (categoryMountedRef.current) {
      categoryMountedRef.current = false;
      return;
    }
    setSelectedTags([]);
  }, [category]);

  // 元数据变化时写入草稿（仅元数据，不存图片）
  useEffect(() => {
    const payload: DraftPayload = {
      title,
      description,
      category,
      selectedTags,
      registrationNumber,
      isHot,
      safetyAgreement,
      licenseAgreement,
      watermark,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // 存储配额异常时静默忽略，不影响主流程
    }
  }, [title, description, category, selectedTags, registrationNumber, isHot, safetyAgreement, licenseAgreement, watermark]);

  /** 内容区滚动到顶部（步骤切换时调用） */
  const scrollToTop = () => {
    setTimeout(() => contentRef.current?.scrollTo({ top: 0 }), 0);
  };

  /**
   * 处理文件选择：校验类型与大小，生成预览并静默解析 EXIF
   */
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    // 清空 input value 以便重复选择同一文件
    e.target.value = '';
    if (!selected) return;

    if (!VALID_TYPES.includes(selected.type)) {
      setFileError('仅支持 JPG、PNG、WebP、HEIC 格式');
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setFileError('图片大小超过 50MB，请压缩后再上传');
      return;
    }

    setFileError('');
    setError('');
    setFile(selected);
    setPreview(URL.createObjectURL(selected));

    // 静默解析 EXIF（失败忽略，不阻断流程）
    try {
      const exifData = await exifr.parse(selected, { tiff: true, exif: true, gps: true });
      if (exifData) {
        const newExif: ExifData = {};
        if (exifData.Make || exifData.Model) {
          newExif.camera_model = [exifData.Make, exifData.Model].filter(Boolean).join(' ').trim();
        }
        if (exifData.FocalLength) newExif.focal_length = `${exifData.FocalLength}mm`;
        if (exifData.ISO) newExif.iso = exifData.ISO;
        if (exifData.ExposureTime) {
          const et = exifData.ExposureTime;
          newExif.shutter_speed = et < 1 ? `1/${Math.round(1 / et)}s` : `${et}s`;
        }
        if (exifData.FNumber) newExif.aperture = `f/${exifData.FNumber}`;
        if (exifData.GPSLatitude && exifData.GPSLongitude) {
          newExif.location = `${exifData.GPSLatitude.toFixed(4)}, ${exifData.GPSLongitude.toFixed(4)}`;
        }
        if (exifData.ImageWidth) newExif.width = exifData.ImageWidth;
        if (exifData.ImageHeight) newExif.height = exifData.ImageHeight;
        setExif(newExif);
      }
    } catch {
      // EXIF 解析失败静默忽略
    }
  }, []);

  // 注册号校验：仅航空分区必填；非航空分区留空即通过（V4.1.2-beta.2 规则）
  const isRegistrationRequired = category === 'aviation';
  const trimmedRegistration = registrationNumber.trim();
  const isRegistrationFormatValid = REGISTRATION_PATTERN.test(trimmedRegistration);
  const isRegistrationValid = !isRegistrationRequired || isRegistrationFormatValid;

  /** 步骤前进（携带各步校验，失败时给出具体错误并定位） */
  const goNext = () => {
    setError('');
    if (step === 1) {
      if (!file) {
        setFileError('请先选择一张图片');
        return;
      }
      setStep(2);
      scrollToTop();
      return;
    }
    if (step === 2) {
      if (!title.trim()) {
        setError('请填写标题');
        return;
      }
      if (!description.trim()) {
        setError('请填写照片描述');
        return;
      }
      if (!category) {
        setError('请选择分区');
        return;
      }
      if (selectedTags.length === 0) {
        setError('请至少选择一个标签');
        tagSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!isRegistrationValid) {
        setError('请填写有效的飞机注册号（2-20 位字母/数字/连字符）');
        registrationInputRef.current?.focus();
        return;
      }
      setStep(3);
      scrollToTop();
      return;
    }
    if (step === 3) {
      setStep(4);
      scrollToTop();
    }
  };

  /** 步骤后退 */
  const goPrev = () => {
    setError('');
    setStep((s) => Math.max(1, s - 1));
    scrollToTop();
  };

  /** 清除草稿并重置表单元数据 */
  const handleClearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // 忽略
    }
    setTitle('');
    setDescription('');
    setCategory(null);
    setSelectedTags([]);
    setRegistrationNumber('');
    setIsHot(false);
    setSafetyAgreement(false);
    setWatermark(DEFAULT_WATERMARK);
    setDraftRestored(false);
  };

  /** 执行上传（含人机验证门与网络异常指数退避自动重试） */
  const runUpload = useCallback(async () => {
    if (!file) return;
    setUploadPhase('uploading');
    setProgress(0);
    setRetryInfo('');

    // 组装元数据（与桌面端 UploadPage 相同的字段与扁平化规则）
    const tagsList = selectedTags.map((t) => t.objectName);
    const structuredTags: Record<string, string> = {};
    selectedTags.forEach((tag) => {
      Object.entries(tag.attributes).forEach(([key, value]) => {
        if (value) structuredTags[key] = value;
      });
    });
    const pos = watermarkPosToXY(watermark.posIndex);
    const meta: PhotoUploadMeta & Record<string, unknown> = {
      title: title.trim(),
      description: description.trim(),
      tags: tagsList,
      category,
      structured_tags: JSON.stringify(structuredTags),
      registration_number: isRegistrationRequired ? trimmedRegistration : '',
      is_hot: isHot ? 1 : 0,
      ...exif,
      watermarkText: WATERMARK_TEXT,
      watermarkX: pos.x,
      watermarkY: pos.y,
      watermarkOpacity: watermark.opacity,
      watermarkSize: watermark.size,
    };

    let result: ApiResponse<DirectUploadResponse> | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) {
        setUploadPhase('retrying');
        setRetryInfo(`网络异常，${RETRY_DELAYS[attempt - 1] / 1000} 秒后自动重试（第 ${attempt} 次）`);
        await sleep(RETRY_DELAYS[attempt - 1]);
        setUploadPhase('uploading');
        setProgress(0);
      }
      const op = () => {
        const handle = uploadPhotoWithProgress(file, meta, token || undefined, setProgress);
        uploadRef.current = handle;
        return handle.promise;
      };
      // 人机验证门：403 HUMAN_VERIFICATION_REQUIRED 时弹窗，通过后自动重试一次
      result = await verificationGuard('photo_upload', op);
      // 仅网络层错误进入退避重试；成功、业务错误、用户取消均立即跳出
      if (result.success || result.code !== NETWORK_ERROR_CODE) break;
    }
    uploadRef.current = null;

    if (result?.success && result.data) {
      setUploadPhase('success');
      setProgress(100);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // 忽略
      }
      setTimeout(() => navigate('/my-works'), 1200);
      return;
    }

    // 自动重试耗尽仍为网络错误：遮罩内展示人工重试入口
    if (result?.code === NETWORK_ERROR_CODE) {
      setUploadPhase('failed');
      setRetryInfo(result.message || '网络异常');
      return;
    }

    // 用户主动取消：静默关闭遮罩
    if (result?.code === UPLOAD_ABORTED_CODE) {
      setUploading(false);
      return;
    }

    // 业务错误：关闭遮罩并按错误码定位到对应表单项
    setUploading(false);
    const message = result?.message || '上传失败，请重试';
    if (result?.code === 'REGISTRATION_REQUIRED') {
      setStep(2);
      setError(message);
      scrollToTop();
      setTimeout(() => registrationInputRef.current?.focus(), 150);
      return;
    }
    if (result?.code === 'TAG_OBJECT_REQUIRED') {
      setStep(2);
      setError(message);
      scrollToTop();
      setTimeout(() => tagSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      return;
    }
    setError(message);
  }, [file, selectedTags, watermark, title, description, category, isRegistrationRequired, trimmedRegistration, isHot, exif, token, verificationGuard, navigate]);

  /** 提交入口：终步校验后进入上传遮罩 */
  const handleSubmit = () => {
    if (!file || uploading) return;
    if (!safetyAgreement) {
      setError('请勾选安全声明');
      return;
    }
    if (!licenseAgreement) {
      setError('请阅读并同意作品版权协议');
      return;
    }
    setError('');
    setUploading(true);
    void runUpload();
  };

  /** 取消当前上传 */
  const handleCancelUpload = () => {
    uploadRef.current?.abort();
  };

  const watermarkSizeLabel =
    WATERMARK_SIZE_TIERS.find((t) => t.size === watermark.size)?.label ?? '中';

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 z-[60] bg-white">
        <div className="mx-auto flex h-dvh max-w-md flex-col bg-white md:border-x md:border-gray-200">
          <MobileBackHeader title="上传作品" />
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 text-center">
              <h2 className="text-lg font-semibold text-gray-800">请先登录</h2>
              <p className="mt-2 text-sm text-gray-500">上传图片需要登录账户</p>
              <button
                type="button"
                onClick={() => navigate('/auth', { state: { from: '/m/upload' } })}
                className="mt-4 h-12 w-full rounded-xl bg-blue-700 font-medium text-white"
              >
                前往登录
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-white">
      <div className="mx-auto flex h-dvh max-w-md flex-col bg-white md:border-x md:border-gray-200">
        <MobileBackHeader title="上传作品" />
        {/* 桌面端直接访问 /m/upload 时的简易标题（MobileBackHeader 仅移动端渲染） */}
        <div className="hidden h-12 items-center justify-center border-b border-gray-200 md:flex">
          <h1 className="m-0 text-base font-medium text-black">上传作品</h1>
        </div>

        {/* 步骤提示条（最多显示 3 次） */}
        {stepsTipVisible && (
          <div className="flex items-center justify-between border-b border-gray-100 bg-blue-50 px-4 py-1 text-sm text-blue-700">
            <span>共 4 步：选图 → 信息 → 水印 → 提交</span>
            <button
              type="button"
              onClick={dismissStepsTip}
              className="flex min-h-[44px] items-center px-2 text-blue-700 underline"
            >
              不再显示
            </button>
          </div>
        )}

        {/* 步进条：4 圆点 + 连线，当前步 blue-700 */}
        <div className="flex items-start border-b border-gray-100 px-6 py-3">
          {STEPS.map((label, index) => {
            const n = index + 1;
            const active = n === step;
            const done = n < step;
            return (
              <Fragment key={label}>
                {index > 0 && (
                  <div className={`mx-1 mt-3.5 h-0.5 flex-1 ${done || active ? 'bg-blue-700' : 'bg-gray-200'}`} />
                )}
                <div className="flex w-10 flex-col items-center">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      active
                        ? 'bg-blue-700 text-white'
                        : done
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {n}
                  </div>
                  <span
                    className={`mt-1 text-[11px] leading-none ${
                      active ? 'font-medium text-blue-700' : 'text-gray-400'
                    }`}
                  >
                    {label}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>

        {/* 可滚内容区 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-4">
          {draftRestored && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-1 text-sm text-blue-700">
              <span>已恢复上次草稿</span>
              <button
                type="button"
                onClick={handleClearDraft}
                className="flex min-h-[44px] items-center px-2 text-blue-700 underline"
              >
                清除草稿
              </button>
            </div>
          )}

          {error && (
            <div className="mb-3 rounded-lg bg-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          {/* Step 1：选图（单文件） */}
          {step === 1 && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              {!file ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center"
                >
                  <svg
                    className="h-10 w-10 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="font-medium text-gray-600">点击选择图片</span>
                  <span className="text-xs text-gray-500">
                    支持 JPG、PNG、WebP、HEIC，最大 50MB，每次仅上传一张
                  </span>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    <img src={preview} alt={file.name} className="max-h-[40vh] w-full object-contain" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="ml-3 flex h-11 items-center rounded-lg border border-gray-300 px-4 text-sm text-gray-700"
                    >
                      重新选择
                    </button>
                  </div>
                </div>
              )}
              {fileError && <p className="text-sm text-red-600">{fileError}</p>}
            </div>
          )}

          {/* Step 2：填信息 */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  标题 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="请输入照片标题"
                  className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 text-gray-800 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  描述 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="请输入照片描述"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-800 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  分区 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {CATEGORIES.map((cat) => {
                    const selected = category === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setCategory(cat.id)}
                        className={`flex h-[72px] flex-1 items-center justify-center rounded-xl border text-base transition-colors ${
                          selected
                            ? 'border-blue-700 bg-blue-50 font-medium text-blue-700'
                            : 'border-gray-200 bg-gray-50 text-gray-700'
                        }`}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div ref={tagSectionRef}>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  标签 <span className="text-red-500">*</span>
                </label>
                {category ? (
                  <TagSelector
                    categoryId={category}
                    selectedTags={selectedTags}
                    onTagsChange={setSelectedTags}
                  />
                ) : (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 py-4 text-center text-sm text-gray-400">
                    请先选择分区
                  </div>
                )}
              </div>

              {/* 飞机注册号：仅航空分区展示并要求填写，其余分区完全不出现 */}
              {isRegistrationRequired && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    飞机注册号 <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={registrationInputRef}
                    type="text"
                    value={registrationNumber}
                    onChange={(e) =>
                      setRegistrationNumber(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20),
                      )
                    }
                    placeholder="如 B-1234"
                    maxLength={20}
                    autoCapitalize="characters"
                    className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 text-gray-800 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700"
                  />
                  <p className="mt-1 text-xs text-gray-400">如 B-1234 / G-DCDE，2~20 位字母数字或连字符</p>
                  {trimmedRegistration && !isRegistrationFormatValid && (
                    <p className="mt-1 text-xs text-red-500">
                      请填写有效的飞机注册号（2-20 位字母/数字/连字符）
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3">
                <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={isHot}
                    onChange={(e) => setIsHot(e.target.checked)}
                    className="h-5 w-5 accent-blue-700"
                  />
                  <span className="text-sm text-gray-700">愿意将图片上传为热门图片</span>
                </label>
                <button
                  type="button"
                  aria-label="热门推荐说明"
                  onClick={() => setHotSheetOpen(true)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-sm text-gray-500"
                >
                  ?
                </button>
              </div>
            </div>
          )}

          {/* Step 3：水印简化版 */}
          {step === 3 && preview && (
            <WatermarkEditor
              preview={preview}
              text={WATERMARK_TEXT}
              ownerName={user?.username || 'TLRphotos 用户'}
              value={watermark}
              onChange={setWatermark}
            />
          )}

          {/* Step 4：确认提交 */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex gap-3">
                  <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {preview && (
                      <img src={preview} alt="作品缩略图" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-gray-800">{title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {CATEGORIES.find((c) => c.id === category)?.name ?? ''}
                      {file ? ` · ${(file.size / 1024 / 1024).toFixed(2)} MB` : ''}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex">
                    <dt className="w-20 flex-shrink-0 text-gray-500">标签</dt>
                    <dd className="flex flex-1 flex-wrap gap-1">
                      {selectedTags.map((t) => (
                        <span key={t.objectId} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {t.objectName}
                        </span>
                      ))}
                    </dd>
                  </div>
                  {/* 注册号仅在航空分区展示（与第 2 步表单一致） */}
                  {isRegistrationRequired && (
                    <div className="flex">
                      <dt className="w-20 flex-shrink-0 text-gray-500">注册号</dt>
                      <dd className="flex-1 text-gray-800">{trimmedRegistration}</dd>
                    </div>
                  )}
                  <div className="flex">
                    <dt className="w-20 flex-shrink-0 text-gray-500">热门意愿</dt>
                    <dd className="flex-1 text-gray-800">{isHot ? '愿意' : '否'}</dd>
                  </div>
                  <div className="flex">
                    <dt className="w-20 flex-shrink-0 text-gray-500">水印</dt>
                    <dd className="flex-1 text-gray-800">
                      {WATERMARK_POS_LABELS[watermark.posIndex]} · {watermarkSizeLabel} · 透明度{' '}
                      {Math.round(watermark.opacity * 100)}%
                    </dd>
                  </div>
                </dl>
              </div>

              {/* 安全声明（与桌面端一致的强制勾选） */}
              <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                <input
                  type="checkbox"
                  checked={safetyAgreement}
                  onChange={(e) => setSafetyAgreement(e.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-blue-700"
                />
                <span className="flex-1 text-sm text-gray-700">
                  <span className="font-medium text-red-500">
                    我确认本影像不涉及任何军事设施、装备或敏感区域
                  </span>
                  <span className="text-red-500">*</span>
                </span>
              </label>

              {/* 版权协议同意（必选，与桌面端一致） */}
              <label className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
                <input
                  type="checkbox"
                  checked={licenseAgreement}
                  onChange={(e) => setLicenseAgreement(e.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-blue-700"
                />
                <span className="flex-1 text-sm text-gray-700">
                  我已阅读并同意
                  <Link
                    to="/about"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-1 text-blue-700 underline"
                  >
                    《作品许可协议》
                  </Link>
                  ，理解作品经审核通过后将以 CC BY 4.0 协议公开展出，著作权仍归我所有
                  <span className="text-blue-700">*</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* 底部通栏按钮（pb-safe 安全区适配） */}
        <div className="border-t border-gray-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={goPrev}
                className="h-12 flex-1 rounded-xl border border-gray-300 font-medium text-gray-700"
              >
                上一步
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                onClick={goNext}
                className="h-12 flex-1 rounded-xl bg-blue-700 font-medium text-white"
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={uploading}
                className="h-12 flex-1 rounded-xl bg-blue-700 font-medium text-white disabled:opacity-50"
              >
                提交
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 热门意愿说明 Bottom Sheet */}
      {hotSheetOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setHotSheetOpen(false)} />
          <div className="relative w-full max-w-md rounded-t-2xl bg-white px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <h3 className="text-base font-semibold text-gray-800">热门推荐意愿</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              勾选后，审核员将在审核时看到您的热门推荐意愿。该标记仅供审核参考，不代表作品一定会被推荐为热门。
            </p>
            <button
              type="button"
              onClick={() => setHotSheetOpen(false)}
              className="mt-4 h-12 w-full rounded-xl bg-blue-700 font-medium text-white"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 上传全屏进度遮罩 */}
      {uploading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center">
            {uploadPhase === 'success' ? (
              <>
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
                <p className="mt-3 font-medium text-gray-800">已提交，等待审核</p>
              </>
            ) : uploadPhase === 'failed' ? (
              <>
                <p className="font-medium text-gray-800">上传失败</p>
                <p className="mt-1 text-sm text-gray-500">{retryInfo || '网络异常'}</p>
                <button
                  type="button"
                  onClick={() => void runUpload()}
                  className="mt-4 h-12 w-full rounded-xl bg-blue-700 font-medium text-white"
                >
                  重试
                </button>
                <button
                  type="button"
                  onClick={() => setUploading(false)}
                  className="mt-2 h-12 w-full rounded-xl border border-gray-300 text-gray-700"
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-700" />
                <p className="mt-3 text-2xl font-semibold text-gray-800">{progress}%</p>
                <div className="mt-3 h-2 w-full rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-blue-700 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-gray-500">
                  {uploadPhase === 'retrying'
                    ? retryInfo
                    : progress >= 95
                      ? '服务器处理中，生成缩略图与水印...'
                      : '正在上传图片...'}
                </p>
                {uploadPhase === 'uploading' && (
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="mt-3 flex h-11 w-full items-center justify-center text-sm text-gray-500"
                  >
                    取消上传
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {verificationModal}
    </div>
  );
}
