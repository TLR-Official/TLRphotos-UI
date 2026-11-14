/**
 * 上传页面（V4.11 重构）
 * 分区驱动动态表单：选择分区后展开该分区专属字段与标签多选，消除「分区 + 机型」信息重复。
 * 流程：选择文件 → 填写信息 → 上传中 → 完成（上传成功页，不自动跳转详情）。
 * 标签清单由 src/shared/tagCatalog.ts 统一维护，桌面端为复选框、移动端为大按钮。
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useUser } from '../../shared/UserContext';
import { uploadPhotoViaPresigned } from './presignedUpload';
import { useHumanVerification } from '../../shared/useHumanVerification';
import { computeBandPreviewLayout } from '../../shared/watermarkBand';
import { AircraftInfoCard } from '../../shared/AircraftInfoCard';
import type { AircraftLookupResult } from '../../api/aircraft';
import {
  EMPTY_CATEGORY_FIELDS,
  TAG_CATALOG,
  UPLOAD_CATEGORIES,
  buildCategoryStructuredTags,
  isCategoryFormValid,
  toDateTimeLocal,
} from '../../shared/tagCatalog';
import type { CategoryFormFields, PhotoCategory } from '../../shared/tagCatalog';
import {
  REGISTRATION_NA,
  isRegistrationDraftValid,
  isRegistrationFilledValid,
  normalizeRegistrationInput,
} from '../../shared/registration';
import { TagPicker } from './TagPicker';
import { AirportLookupCard } from './AirportLookupCard';
import exifr from 'exifr';

/** 上传流程步骤：选择文件 → 填写信息 → 上传中 → 完成 */
type Step = 'select' | 'fill' | 'uploading' | 'done';

/** 从 EXIF 解析得到的拍摄参数集合 */
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

/**
 * 上传页面组件
 * 通过多步骤状态机管理上传流程，并维护文件、表单、EXIF、水印等局部状态。
 * @returns 上传页 JSX，未登录时渲染登录引导
 */
export function UploadPage() {
  const navigate = useNavigate();
  const { isAuthenticated, token, user } = useUser();
  // V1.8.0：人机验证门（上传被 403 拦截时弹出）
  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  // preview：本地 ObjectURL，用于即时预览未上传的图片
  const [preview, setPreview] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('');
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<PhotoCategory | null>(null);
  // V4.11：标签为定稿清单中的名称数组
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // V4.11：分区动态字段（拍摄时间 / 机型 / 车号 / 车型 / 线路 / 局段 / 车辆编号 / 拍摄地点）
  const [categoryFields, setCategoryFields] = useState<CategoryFormFields>(EMPTY_CATEGORY_FIELDS);
  const [exif, setExif] = useState<ExifData>({});
  const [safetyAgreement, setSafetyAgreement] = useState(false);
  // 版权协议同意（必选）：勾选后方可提交，作品入库后按 CC BY 4.0 公开展出
  const [licenseAgreement, setLicenseAgreement] = useState(false);
  // 飞机注册号（仅航空分区必填，输入时自动转大写，支持 N/A）
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [isHot, setIsHot] = useState(false);

  // 用户是否手动机型：识别结果不得覆盖用户输入（B4）
  const aircraftModelTouchedRef = useRef(false);

  const watermarkText = 'TLRphotos';
  // 水印位置/透明度/字号，初始居中
  // NOTE: watermarkSize 语义与后端强一致 = "以 1200px 长边的预览图为基准的字号"，
  // 预览显示时按实际渲染图像长边 scaleFactor = max(renderedW, renderedH) / 1200 线性缩放，
  // 确保用户在上传界面看到的文字比例 = 最终水印图上的文字比例（所见即所得）。
  const [watermarkX, setWatermarkX] = useState(50);
  const [watermarkY, setWatermarkY] = useState(50);
  const [watermarkOpacity, setWatermarkOpacity] = useState(60);
  const [watermarkSize, setWatermarkSize] = useState(32);
  // isDragging：标识水印文字是否处于拖动中
  const [isDragging, setIsDragging] = useState(false);
  // 实际渲染的预览图在屏幕上的矩形（经过 object-contain，可能比容器小），用于：
  //   - 字号 scaleFactor 计算（与后端 processImage 保持同一基准）
  //   - 位置百分比换算（0% = 真实图片左/上边，100% = 真实图片右/下边）
  const [renderedImageRect, setRenderedImageRect] = useState<{x:number;y:number;width:number;height:number} | null>(null);
  // 原图原始尺寸，用于还原后端预览图坐标（底部信息条比例换算的基准）
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);

  // 组件卸载或 preview 变更时释放上一个 ObjectURL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  /**
   * 测量实际渲染的预览图矩形（经过 object-contain 后图片在容器内的真位置），
   * 并保存到 state 供 scaleFactor 与坐标换算使用。与后端的 scaleFactor 公式完全同源。
   */
  const measureRenderedImage = useCallback(() => {
    const img = previewImgRef.current;
    const host = previewRef.current;
    if (!img || !host) return;
    // 浏览器原生对象定位 API：返回图片内容（object-contain 后）相对宿主 <img> 元素的矩形
    let imgBox: { left: number; top: number; width: number; height: number } | null = null;
    if (typeof (img as any).getBoundingClientRect === 'function') {
      const hostRect = host.getBoundingClientRect();
      const imgElRect = img.getBoundingClientRect(); // rect of the <img> box itself (fills host)
      // Use object-contain ratio math (since browser doesn't expose the painted rect directly):
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const boxW = imgElRect.width;
      const boxH = imgElRect.height;
      const ratio = Math.min(boxW / nw, boxH / nh);
      const drawnW = nw * ratio;
      const drawnH = nh * ratio;
      const drawnLeft = (boxW - drawnW) / 2 + (imgElRect.left - hostRect.left);
      const drawnTop = (boxH - drawnH) / 2 + (imgElRect.top - hostRect.top);
      imgBox = { left: drawnLeft, top: drawnTop, width: drawnW, height: drawnH };
    }
    if (imgBox && imgBox.width > 0 && imgBox.height > 0) {
      setRenderedImageRect({ x: imgBox.left, y: imgBox.top, width: imgBox.width, height: imgBox.height });
      setNaturalSize({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    }
  }, []);

  // 图片加载/容器尺寸/窗口变化 → 重新测量
  useEffect(() => {
    if (!preview) return;
    measureRenderedImage();
    const onResize = () => measureRenderedImage();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [preview, step, measureRenderedImage]);

  /** 与后端完全一致的预览字号线性缩放系数 */
  const previewFontScale = renderedImageRect
    ? Math.max(renderedImageRect.width, renderedImageRect.height) / 1200
    : 0;
  const displayFontSize = Math.max(1, Math.round(watermarkSize * (previewFontScale || 1)));

  // 底部信息条预览布局：比例与后端 imageService 完全同源（见 shared/watermarkBand.ts）
  const bandLayout = renderedImageRect && naturalSize
    ? computeBandPreviewLayout({
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        renderedWidth: renderedImageRect.width,
        siteName: watermarkText,
        ownerName: user?.username || 'TLRphotos 用户',
      })
    : null;

  const inputCls = `w-full px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500`;

  const labelCls = `block text-sm font-medium mb-1 text-gray-700`;

  /** 更新分区动态字段 */
  const updateCategoryField = (key: keyof CategoryFormFields, value: string) => {
    setCategoryFields((prev) => ({ ...prev, [key]: value }));
  };

  /** 切换分区：清空标签与分区专属字段，保留 EXIF 已解析的拍摄时间/地点 */
  const handleCategoryChange = (next: PhotoCategory) => {
    if (next === category) return;
    setCategory(next);
    setSelectedTags([]);
    setCategoryFields((prev) => ({
      ...EMPTY_CATEGORY_FIELDS,
      shootTime: prev.shootTime,
      location: prev.location,
    }));
    setRegistrationNumber('');
    aircraftModelTouchedRef.current = false;
  };

  /**
   * 处理文件选择
   * 校验类型与大小后生成预览，并尝试解析 EXIF 自动回填拍摄参数。
   * @param e 文件输入 change 事件
   */
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!validTypes.includes(selected.type)) {
      setError('仅支持 JPG、PNG、WebP、HEIC 格式');
      return;
    }
    if (selected.size > 50 * 1024 * 1024) {
      setError('文件大小不能超过 50MB');
      return;
    }

    setError('');
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setStep('fill');

    try {
      // 同时解析 TIFF/EXIF/GPS 三段信息以获取完整拍摄参数
      const exifData = await exifr.parse(selected, {
        tiff: true,
        exif: true,
        gps: true,
      });

      if (exifData) {
        const newExif: ExifData = {};
        if (exifData.Make || exifData.Model) {
          // 厂商与型号合并为完整相机型号字符串
          newExif.camera_model = [exifData.Make, exifData.Model].filter(Boolean).join(' ').trim();
        }
        if (exifData.FocalLength) {
          newExif.focal_length = `${exifData.FocalLength}mm`;
        }
        if (exifData.ISO) {
          newExif.iso = exifData.ISO;
        }
        if (exifData.ExposureTime) {
          const et = exifData.ExposureTime;
          // 快门速度：小于 1 秒时转换为分式表示（如 1/500s）
          newExif.shutter_speed = et < 1 ? `1/${Math.round(1 / et)}s` : `${et}s`;
        }
        if (exifData.FNumber) {
          newExif.aperture = `f/${exifData.FNumber}`;
        }
        if (exifData.GPSLatitude && exifData.GPSLongitude) {
          newExif.location = `${exifData.GPSLatitude.toFixed(4)}, ${exifData.GPSLongitude.toFixed(4)}`;
        }
        if (exifData.ImageWidth) newExif.width = exifData.ImageWidth;
        if (exifData.ImageHeight) newExif.height = exifData.ImageHeight;
        setExif(newExif);

        // V4.11：拍摄时间 / 地点预填（不覆盖用户已输入的值）
        const shotDate = exifData.DateTimeOriginal instanceof Date ? exifData.DateTimeOriginal : null;
        setCategoryFields((prev) => ({
          ...prev,
          shootTime: prev.shootTime || (shotDate ? toDateTimeLocal(shotDate) : ''),
          location: prev.location || newExif.location || '',
        }));
      }
    } catch {
    }
  }, []);

  /** 重置全部表单状态并回到文件选择步骤 */
  const handleReSelect = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview('');
    setTitle('');
    setDescription('');
    setCategory(null);
    setSelectedTags([]);
    setCategoryFields(EMPTY_CATEGORY_FIELDS);
    setExif({});
    setWatermarkX(50);
    setWatermarkY(50);
    setWatermarkOpacity(60);
    setWatermarkSize(32);
    setSafetyAgreement(false);
    setLicenseAgreement(false);
    setRegistrationNumber('');
    setIsHot(false);
    aircraftModelTouchedRef.current = false;
    setStep('select');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 飞机注册号校验：2-20 位字母/数字/连字符（首位不允许连字符）或 N/A。
  // 业务规则：仅「航空」分区必填，铁路/汽车分区不出现该字段。
  const isRegistrationRequired = category === 'aviation';
  const normalizedRegistration = normalizeRegistrationInput(registrationNumber);
  const isRegistrationNa = normalizedRegistration === REGISTRATION_NA;
  const isRegistrationValid = !isRegistrationRequired || isRegistrationFilledValid(registrationNumber);

  // V4.11：注册号识别命中后仅回填空白的「机型」，不覆盖用户手填值（B4）
  const handleAircraftHit = useCallback((info: AircraftLookupResult) => {
    if (aircraftModelTouchedRef.current || !info.aircraft_type) return;
    setCategoryFields((prev) =>
      prev.aircraftModel.trim() ? prev : { ...prev, aircraftModel: info.aircraft_type || '' },
    );
  }, []);

  // 分区字段是否满足必填
  const isCategoryFieldsValid = category ? isCategoryFormValid(category, categoryFields) : false;

  // 提交前置条件：标题、注册号、分区字段、标签、安全声明与版权协议
  const canSubmit = Boolean(
    title.trim() &&
      isRegistrationValid &&
      isCategoryFieldsValid &&
      category &&
      selectedTags.length > 0 &&
      safetyAgreement &&
      licenseAgreement,
  );

  /** 提交按钮禁用时的首个未满足条件提示 */
  const missingHint = (() => {
    if (!title.trim()) return '请填写标题';
    if (isRegistrationRequired && !isRegistrationValid) return '请填写有效的飞机注册号或选择「无注册号」';
    if (!category) return '请选择分区';
    if (category && !categoryFields.shootTime.trim()) return '请填写拍摄时间';
    if (category === 'aviation' && !categoryFields.aircraftModel.trim()) return '请填写机型（无机型可填 N/A）';
    if (category === 'aviation' && !categoryFields.location.trim()) return '请填写拍摄地点（未知可填 N/A）';
    if (category === 'railway' && !categoryFields.trainNumber.trim()) return '请填写车号';
    if (category === 'railway' && !categoryFields.trainModel.trim()) return '请填写车型';
    if (category === 'railway' && !categoryFields.trainLine.trim()) return '请填写拍摄线路';
    if (category === 'railway' && !categoryFields.trainBureau.trim()) return '请填写所属局段';
    if (category === 'automobile' && !categoryFields.vehicleNumber.trim()) return '请填写车辆编号';
    if (category === 'automobile' && !categoryFields.vehicleModel.trim()) return '请填写车型';
    if (category === 'automobile' && !categoryFields.location.trim()) return '请填写拍摄地点（未知可填 N/A）';
    if (selectedTags.length === 0) return '请至少选择一个标签';
    if (!safetyAgreement) return '请勾选安全声明';
    if (!licenseAgreement) return '请阅读并同意作品版权协议';
    return '';
  })();

  /** 水印拖动开始：阻止默认行为并进入拖动状态 */
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  /**
   * 水印拖动中：以「实际渲染的图片矩形」为坐标系，换算百分比（0-100）。
   * 与后端 processedWidth / processedHeight 百分比坐标 1:1 对齐。
   * @param e 鼠标移动事件
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    let rect = renderedImageRect;
    // 如果尚未测量（图片刚加载），兜底使用 previewRef 容器本身坐标
    if (!rect && previewRef.current) {
      const r = previewRef.current.getBoundingClientRect();
      rect = { x: 0, y: 0, width: r.width, height: r.height };
    }
    if (!rect) return;
    const mouseX = e.clientX - (previewRef.current?.getBoundingClientRect().left || 0);
    const mouseY = e.clientY - (previewRef.current?.getBoundingClientRect().top || 0);
    // 将鼠标相对容器的坐标 → 相对图片矩形的坐标，再 → 百分比
    const x = rect.width === 0 ? 0 : Math.max(0, Math.min(100, ((mouseX - rect.x) / rect.width) * 100));
    const y = rect.height === 0 ? 0 : Math.max(0, Math.min(100, ((mouseY - rect.y) / rect.height) * 100));
    setWatermarkX(x);
    setWatermarkY(y);
  }, [isDragging, renderedImageRect]);

  /** 水印拖动结束：退出拖动状态 */
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  /**
   * 提交上传
   * 组装标题/描述/标签/分区字段/EXIF/水印等元数据后调用直传接口；
   * 成功后停留在上传成功页，不自动跳转详情。
   */
  const handleSubmit = async () => {
    if (!file || !category) return;
    if (selectedTags.length === 0) {
      setError('请至少选择一个标签');
      return;
    }
    if (!canSubmit) return;

    setStep('uploading');
    setProgress(2);
    setUploadMsg('正在上传原图...');

    try {

      const structuredTags = buildCategoryStructuredTags(category, categoryFields);

      const uploadMeta: any = {
        title: title.trim(),
        description: description.trim(),
        tags: selectedTags,
        category,
        structured_tags: JSON.stringify(structuredTags),
        // 注册号仅航空分区提交（支持 N/A），避免切换分类后残留旧值
        registration_number: isRegistrationRequired ? normalizedRegistration : '',
        // 拍摄地点：航空 / 汽车取分区字段；铁路沿用 EXIF 坐标（若有）
        location:
          category === 'railway' ? exif.location || '' : categoryFields.location.trim(),
        is_hot: isHot ? 1 : 0,
        ...exif,
      };

      // 存在水印文字时附加水印配置（透明度由百分比转为 0~1 小数）
      if (watermarkText) {
        uploadMeta.watermarkText = watermarkText;
        uploadMeta.watermarkX = watermarkX;
        uploadMeta.watermarkY = watermarkY;
        uploadMeta.watermarkOpacity = watermarkOpacity / 100;
        uploadMeta.watermarkSize = watermarkSize;
      }

      // V4.13.0：OSS 预签名直传原图，服务端登记异步水印/压缩任务后立即返回
      const result = await verificationGuard('photo_upload', () =>
        uploadPhotoViaPresigned(file, uploadMeta, token || undefined, (percent) => setProgress(percent)).promise,
      );

      if (!result.success || !result.data) {
        setError(result.message || '上传失败');
        setStep('fill');
        return;
      }

      setProgress(100);
      setUploadMsg('上传成功！');
      // V4.11：硬性要求提交成功后停留在成功页，不自动跳转照片详情
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
      setStep('fill');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className={`p-8 rounded-2xl bg-white shadow-xl`}>
          <h2 className="text-xl font-semibold mb-4 text-gray-800">请先登录</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">上传图片需要登录账户</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      {verificationModal}
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-bold mb-2 text-gray-800`}>
            上传图片
          </h1>
          <p className="text-gray-600 dark:text-gray-400">分享您的精彩交通摄影作品</p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-100 text-red-600 rounded-lg text-sm">{error}</div>
        )}

        {step === 'done' && (
          <div className={`p-10 rounded-2xl bg-white shadow-xl text-center`}>
            <CheckCircle2 className="w-14 h-14 mx-auto text-green-600" />
            <h2 className="mt-4 text-2xl font-bold text-gray-900">上传成功！</h2>
            <p className="mt-2 text-sm text-gray-500">作品已提交，等待审核通过后公开展示</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2.5 rounded-lg bg-blue-700 text-white font-medium hover:bg-blue-800 transition-colors"
              >
                返回首页
              </button>
              <button
                onClick={() => navigate('/my-works')}
                className="px-6 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:border-blue-300 hover:text-blue-700 transition-colors"
              >
                我的作品
              </button>
              <button
                onClick={handleReSelect}
                className="px-6 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:border-blue-300 hover:text-blue-700 transition-colors"
              >
                继续上传
              </button>
            </div>
          </div>
        )}

        {step === 'select' && (
          <div className={`p-6 rounded-2xl bg-white shadow-xl`}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              className="border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto rounded-lg bg-gray-200 flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="font-medium text-gray-600">点击选择图片</p>
                <p className="text-xs text-gray-500">支持 JPG、PNG、WebP、HEIC，最大 50MB，每次仅上传一张</p>
              </div>
            </div>
          </div>
        )}

        {(step === 'fill' || step === 'uploading') && file && (
          <div className={`p-6 rounded-2xl bg-white shadow-xl`}>
            <div className="flex gap-6 mb-6">
              <div className="w-48 h-32 rounded-lg overflow-hidden flex-shrink-0 relative">
                <img src={preview} alt={file.name} className="w-full h-full object-cover" />
                {step === 'uploading' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                      <div className="text-white text-xs">{progress}%</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-gray-700">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                {step === 'uploading' && (
                  <p className="text-xs text-blue-500 mt-1">{uploadMsg}</p>
                )}
              </div>
            </div>

            {step === 'uploading' && (
              <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
                <div className="bg-blue-700 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className={labelCls}>选择分区 <span className="text-red-500">★</span></label>
                <div className="flex flex-wrap gap-3 mt-2">
                  {UPLOAD_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => handleCategoryChange(cat.id)}
                      disabled={step === 'uploading'}
                      className={`min-h-[44px] px-6 rounded-lg font-medium transition-all ${
                        category === cat.id
                          ? 'bg-blue-700 text-white shadow-lg'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>标题 <span className="text-red-500">★</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={step === 'uploading'} placeholder="如 dsc 5501 xxxx" className={inputCls} />
                <p className="mt-1 text-xs text-red-500">仅为格式示例，请谨慎填写</p>
              </div>

              {/* 分区驱动动态字段：选择分区后才展开 */}
              {category && (
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 space-y-3">
                  {/* 拍摄时间：三区通用必填 */}
                  <div>
                    <label className="text-xs text-gray-500">拍摄时间 <span className="text-red-500">★</span></label>
                    <input
                      type="datetime-local"
                      value={categoryFields.shootTime}
                      onChange={(e) => updateCategoryField('shootTime', e.target.value)}
                      disabled={step === 'uploading'}
                      className={`${inputCls} mt-1`}
                    />
                  </div>

                  {category === 'aviation' && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500">飞机注册号 <span className="text-red-500">★</span></label>
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="text"
                            value={registrationNumber}
                            onChange={(e) =>
                              setRegistrationNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, '').slice(0, 20))
                            }
                            readOnly={isRegistrationNa}
                            disabled={step === 'uploading'}
                            placeholder="如 B-1234"
                            maxLength={20}
                            className={inputCls}
                          />
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isRegistrationNa}
                              disabled={step === 'uploading'}
                              onChange={(e) => setRegistrationNumber(e.target.checked ? REGISTRATION_NA : '')}
                              className="h-4 w-4 accent-blue-700"
                            />
                            无注册号
                          </label>
                        </div>
                        {!isRegistrationNa && registrationNumber.trim() && !isRegistrationDraftValid(registrationNumber) && (
                          <p className="mt-1 text-xs text-red-500">请填写有效的飞机注册号（2-20 位字母/数字/连字符）</p>
                        )}
                        {/* 注册号合法后自动识别机型与航司（仅登录态查询，N/A 不查询） */}
                        {!isRegistrationNa && (
                          <AircraftInfoCard
                            registration={registrationNumber}
                            enabled={isAuthenticated && step !== 'uploading'}
                            onHit={handleAircraftHit}
                          />
                        )}
                      </div>

                      <div>
                        <label className="text-xs text-gray-500">机型 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.aircraftModel}
                          onChange={(e) => {
                            aircraftModelTouchedRef.current = true;
                            updateCategoryField('aircraftModel', e.target.value);
                          }}
                          disabled={step === 'uploading'}
                          placeholder="如 Airbus A320neo；无机型请填 N/A"
                          className={`${inputCls} mt-1`}
                        />
                      </div>

                      <div>
                        <label className="text-xs text-gray-500">拍摄地点 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.location}
                          onChange={(e) => updateCategoryField('location', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 深圳宝安国际机场（SZX）；未知请填 N/A"
                          className={`${inputCls} mt-1`}
                        />
                        <AirportLookupCard
                          value={categoryFields.location}
                          enabled={step !== 'uploading'}
                          onConfirm={(location) => updateCategoryField('location', location)}
                        />
                      </div>
                    </>
                  )}

                  {category === 'railway' && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500">车号 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.trainNumber}
                          onChange={(e) => updateCategoryField('trainNumber', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 HXD1-0001"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">车型 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.trainModel}
                          onChange={(e) => updateCategoryField('trainModel', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 和谐电1 / CR400AF"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">拍摄线路 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.trainLine}
                          onChange={(e) => updateCategoryField('trainLine', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 京广线"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">所属局段 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.trainBureau}
                          onChange={(e) => updateCategoryField('trainBureau', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 广铁集团广州机务段"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                    </>
                  )}

                  {category === 'automobile' && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500">车辆信息（编号） <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.vehicleNumber}
                          onChange={(e) => updateCategoryField('vehicleNumber', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 粤B·12345 或 自编号"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">车型 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.vehicleModel}
                          onChange={(e) => updateCategoryField('vehicleModel', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 比亚迪 K8"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">拍摄地点 <span className="text-red-500">★</span></label>
                        <input
                          type="text"
                          value={categoryFields.location}
                          onChange={(e) => updateCategoryField('location', e.target.value)}
                          disabled={step === 'uploading'}
                          placeholder="如 深圳市福田区；未知请填 N/A"
                          className={`${inputCls} mt-1`}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {category && (
                <div>
                  <label className={labelCls}>选择标签 <span className="text-red-500">★</span></label>
                  <TagPicker
                    tags={TAG_CATALOG[category]}
                    selected={selectedTags}
                    onChange={setSelectedTags}
                    disabled={step === 'uploading'}
                  />
                </div>
              )}

              <div>
                <label className={labelCls}>照片描述</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={step === 'uploading'} placeholder="请输入照片描述（可选）" rows={3} className={`${inputCls} resize-none`} />
              </div>

              <div>
                <label className={labelCls}>水印设置</label>
                <div className={`mt-3 p-4 rounded-lg bg-gray-50`}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <span className="text-xs text-gray-500">水印文字</span>
                      <div className={`${inputCls} mt-1 flex items-center`}>
                        <span className="font-medium">{watermarkText}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">字体大小: {watermarkSize}px（基准 1200px 长边图像）→ 预览显示 {displayFontSize}px</span>
                      <input type="range" min="12" max="72" value={watermarkSize} onChange={(e) => setWatermarkSize(Number(e.target.value))} className={`w-full mt-1 `} />
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">透明度: {watermarkOpacity}%</span>
                      <input type="range" min="10" max="100" value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(Number(e.target.value))} className={`w-full mt-1 `} />
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">预览（拖动文字调整位置）</span>
                    <div
                      ref={previewRef}
                      className="relative mt-2 rounded-lg overflow-hidden max-w-md"
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    >
                      <img
                        ref={previewImgRef}
                        src={preview}
                        alt="preview"
                        className="block w-full max-h-64 object-contain"
                        onLoad={measureRenderedImage}
                        onError={measureRenderedImage}
                      />
                      {/* 水印覆盖层：
                          定位基准 = 实际 object-contain 渲染后的图片矩形 (renderedImageRect)
                          字号 = watermarkSize * max(drawnW, drawnH) / 1200 — 与后端 sharp 绘制 100% 同源
                      */}
                      {renderedImageRect ? (
                        <div
                          ref={watermarkRef}
                          className="absolute cursor-move select-none pointer-events-auto"
                          style={{
                            left: renderedImageRect.x + (renderedImageRect.width * watermarkX) / 100,
                            top: renderedImageRect.y + (renderedImageRect.height * watermarkY) / 100,
                            transform: 'translate(-50%, -50%)',
                          }}
                          onMouseDown={handleMouseDown}
                        >
                          <span
                            className="text-white drop-shadow-md whitespace-nowrap"
                            style={{
                              fontSize: `${displayFontSize}px`,
                              opacity: watermarkOpacity / 100,
                              // 与后端 SVG <text stroke=black stroke-width=1> 视觉对齐
                              WebkitTextStroke: `${Math.max(0.5, displayFontSize * 0.03)}px rgba(0,0,0,${(watermarkOpacity / 100) * 0.5})`,
                              textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
                              fontWeight: 600,
                            }}
                          >
                            {watermarkText}
                          </span>
                        </div>
                      ) : null}
                      {/* 底部信息条预览：在图片下方额外扩展一块等宽纯黑区域（不遮挡画面），
                          条内两行白字居中，比例与后端 extend + composite 完全同源 */}
                      {renderedImageRect && bandLayout ? (
                        <div
                          className="relative select-none bg-black"
                          style={{
                            marginLeft: renderedImageRect.x,
                            width: renderedImageRect.width,
                            height: bandLayout.height,
                          }}
                        >
                          <span
                            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-white"
                            style={{
                              top: bandLayout.line1CenterY,
                              fontSize: `${bandLayout.line1FontSize}px`,
                              fontWeight: 600,
                            }}
                          >
                            {bandLayout.line1}
                          </span>
                          <span
                            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-white"
                            style={{
                              top: bandLayout.line2CenterY,
                              fontSize: `${bandLayout.line2FontSize}px`,
                              fontWeight: 400,
                            }}
                          >
                            {bandLayout.line2}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  拍摄参数
                  <span className="ml-2 text-xs text-green-500">（已自动读取）</span>
                </label>
                <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-lg bg-gray-50`}>
                  <div>
                    <span className="text-xs text-gray-500">相机型号</span>
                    <input type="text" value={exif.camera_model || ''} onChange={(e) => setExif({ ...exif, camera_model: e.target.value })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">焦距</span>
                    <input type="text" value={exif.focal_length || ''} onChange={(e) => setExif({ ...exif, focal_length: e.target.value })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">ISO</span>
                    <input type="number" value={exif.iso || ''} onChange={(e) => setExif({ ...exif, iso: Number(e.target.value) })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">快门速度</span>
                    <input type="text" value={exif.shutter_speed || ''} onChange={(e) => setExif({ ...exif, shutter_speed: e.target.value })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">光圈</span>
                    <input type="text" value={exif.aperture || ''} onChange={(e) => setExif({ ...exif, aperture: e.target.value })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                </div>
              </div>

              <div className={`flex items-start gap-3 p-4 rounded-lg bg-gray-50`}>
                <input
                  type="checkbox"
                  id="hot-recommendation"
                  checked={isHot}
                  onChange={(e) => setIsHot(e.target.checked)}
                  disabled={step === 'uploading'}
                  className="mt-1"
                />
                <label htmlFor="hot-recommendation" className={`text-sm flex-1 text-gray-700`}>
                  愿意将图片上传为热门图片
                  <span className="block mt-0.5 text-xs text-gray-500">勾选后，审核员将在审核时看到您的热门推荐意愿</span>
                </label>
              </div>

              <div className={`flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200`}>
                <input
                  type="checkbox"
                  id="safety-agreement"
                  checked={safetyAgreement}
                  onChange={(e) => setSafetyAgreement(e.target.checked)}
                  disabled={step === 'uploading'}
                  className="mt-1"
                />
                <label htmlFor="safety-agreement" className={`text-sm flex-1 text-gray-700`}>
                  <span className="text-red-500 font-medium">我确认本影像不涉及任何军事设施、装备或敏感区域</span>
                  <span className="text-red-500">★</span>
                </label>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
                <input
                  type="checkbox"
                  id="license-agreement"
                  checked={licenseAgreement}
                  onChange={(e) => setLicenseAgreement(e.target.checked)}
                  disabled={step === 'uploading'}
                  className="mt-1 accent-blue-700"
                />
                <label htmlFor="license-agreement" className="text-sm flex-1 text-gray-700">
                  我已阅读并同意
                  <Link
                    to="/about"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-1 text-blue-700 underline hover:text-blue-800"
                  >
                    《作品许可协议》
                  </Link>
                  ，理解作品经审核通过后将以 CC BY 4.0 协议公开展出，著作权仍归我所有
                  <span className="text-blue-700">*</span>
                </label>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={handleReSelect}
                  disabled={step === 'uploading'}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
                >
                  重新选择
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || step === 'uploading'}
                  className={`px-8 py-2 rounded-lg transition-colors font-medium ${
                    canSubmit && step !== 'uploading'
                      ? 'bg-blue-700 text-white hover:bg-blue-800'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {step === 'uploading' ? '上传中...' : '上传'}
                </button>
              </div>

              {!canSubmit && step === 'fill' && missingHint && (
                <p className="text-xs text-center text-gray-400">{missingHint}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
