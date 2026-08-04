/**
 * 上传页面
 * 引导用户完成单张照片上传：选择文件 → 填写信息（分类/标题/描述/标签/水印/EXIF）→ 提交。
 * 支持自动解析 EXIF、可拖动水印预览、安全声明校验，并通过进度条反馈上传过程。
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTheme } from '../../shared/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../shared/UserContext';
import { directUpload } from '../../api/photos';
import { getTagCategories, getCategoryTags } from '../../api/tags';
import exifr from 'exifr';

/** 上传流程步骤：选择文件 → 填写信息 → 上传中 → 完成 */
type Step = 'select' | 'fill' | 'uploading' | 'done';
/** 照片分类：航空 / 铁路 / 汽车 */
type Category = 'aviation' | 'railway' | 'automobile';

/** 从 EXIF 解析得到的拍摄参数集合 */
interface ExifData {
  camera_model?: string;
  focal_length?: string;
  iso?: number;
  shutter_speed?: string;
  aperture?: string;
  altitude?: number;
  location?: string;
  width?: number;
  height?: number;
}

/** 已选标签（含标签对象 id、名称及其属性键值对） */
interface SelectedTag {
  objectId: string;
  objectName: string;
  attributes: Record<string, string>;
}

/** 标签分类（航空/铁路/汽车等顶层分类） */
interface TagCategory {
  id: string;
  name: string;
  name_en: string;
  description: string;
  icon: string;
}

/** 标签属性定义（描述某标签下可填写的字段，如机型、航班号等） */
interface TagAttribute {
  id: string;
  object_id: string;
  key: string;
  key_en: string;
  label: string;
  type: 'text' | 'select' | 'number';
  options: string[];
}

/** 标签对象（隶属于某分类，可附带若干属性） */
interface TagObject {
  id: string;
  category_id: string;
  name: string;
  name_en: string;
  description: string;
  attributes: TagAttribute[];
}

/**
 * 上传页面组件
 * 通过多步骤状态机管理上传流程，并维护文件、表单、EXIF、水印等局部状态。
 * @returns 上传页 JSX，未登录时渲染登录引导
 */
export function UploadPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { isAuthenticated, token } = useUser();
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
  const [category, setCategory] = useState<Category | null>(null);
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([]);
  const [exif, setExif] = useState<ExifData>({});
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [categoryTags, setCategoryTags] = useState<TagObject[]>([]);
  const [safetyAgreement, setSafetyAgreement] = useState(false);

  const watermarkText = 'TLRphotos';
  // 水印位置/透明度/字号，初始居中
  const [watermarkX, setWatermarkX] = useState(50);
  const [watermarkY, setWatermarkY] = useState(50);
  const [watermarkOpacity, setWatermarkOpacity] = useState(60);
  const [watermarkSize, setWatermarkSize] = useState(32);
  // isDragging：标识水印文字是否处于拖动中
  const [isDragging, setIsDragging] = useState(false);

  // 首次挂载拉取标签分类列表（航空/铁路/汽车）
  useEffect(() => {
    getTagCategories().then((res) => {
      if (res.success && res.data) {
        setCategories(res.data);
      }
    });
  }, []);

  // 切换分类时拉取该分类下的标签对象，并清空已选标签
  useEffect(() => {
    if (category) {
      getCategoryTags(category).then((res) => {
        if (res.success && res.data) {
          setCategoryTags(res.data.objects);
        }
      });
      setSelectedTags([]);
    }
  }, [category]);

  // 组件卸载或 preview 变更时释放上一个 ObjectURL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const inputCls = `w-full px-4 py-2 rounded-lg border ${
    theme === 'dark'
      ? 'border-gray-600 bg-slate-700 text-white'
      : 'border-gray-300 bg-white text-gray-800'
  } focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500`;

  const labelCls = `block text-sm font-medium mb-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`;

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
        if (exifData.GPSAltitude) {
          newExif.altitude = Math.round(exifData.GPSAltitude);
        }
        if (exifData.ImageWidth) newExif.width = exifData.ImageWidth;
        if (exifData.ImageHeight) newExif.height = exifData.ImageHeight;
        setExif(newExif);
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
    setExif({});
    setWatermarkX(50);
    setWatermarkY(50);
    setWatermarkOpacity(60);
    setWatermarkSize(32);
    setSafetyAgreement(false);
    setStep('select');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * 切换标签选中状态
   * 已选则移除，未选则追加（初始属性为空对象）。
   * @param objectId 标签对象 id
   * @param objectName 标签对象名称
   */
  const handleTagToggle = (objectId: string, objectName: string) => {
    setSelectedTags((prev) => {
      const existing = prev.find((t) => t.objectId === objectId);
      if (existing) {
        return prev.filter((t) => t.objectId !== objectId);
      }
      return [...prev, { objectId, objectName, attributes: {} }];
    });
  };

  /**
   * 更新某标签下指定属性的值
   * @param objectId 标签对象 id
   * @param attrKey 属性键名
   * @param value 属性值
   */
  const handleAttributeChange = (objectId: string, attrKey: string, value: string) => {
    setSelectedTags((prev) =>
      prev.map((tag) =>
        tag.objectId === objectId ? { ...tag, attributes: { ...tag.attributes, [attrKey]: value } } : tag
      )
    );
  };

  // 提交前置条件：标题非空、已选分类、已勾选安全声明
  const canSubmit = title.trim() && category && safetyAgreement;

  /** 水印拖动开始：阻止默认行为并进入拖动状态 */
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  /**
   * 水印拖动中：根据鼠标位置换算为预览区百分比坐标，并钳制在 0~100 范围内
   * @param e 鼠标移动事件
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !previewRef.current) return;

    const rect = previewRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setWatermarkX(Math.max(0, Math.min(100, x)));
    setWatermarkY(Math.max(0, Math.min(100, y)));
  }, [isDragging]);

  /** 水印拖动结束：退出拖动状态 */
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  /**
   * 提交上传
   * 组装标题/描述/标签/结构化属性/EXIF/水印等元数据后调用直传接口；
   * 成功后延迟跳转到新照片详情页，失败回退到填写步骤并显示错误。
   */
  const handleSubmit = async () => {
    if (!file || !canSubmit) return;

    setStep('uploading');
    setProgress(10);
    setUploadMsg('正在处理图片...');

    try {
      setProgress(30);
      setUploadMsg('正在生成缩略图和水印...');

      // 标签对象名列表，作为简单标签集合提交
      const tagsList = selectedTags.map((t) => t.objectName);

      // 将所有已选标签的属性扁平化为单一对象（同 key 后写覆盖前写）
      const structuredTags: Record<string, any> = {};
      selectedTags.forEach((tag) => {
        Object.entries(tag.attributes).forEach(([key, value]) => {
          if (value) {
            structuredTags[key] = value;
          }
        });
      });

      const uploadMeta: any = {
        title: title.trim(),
        description: description.trim(),
        tags: tagsList,
        category: category,
        structured_tags: JSON.stringify(structuredTags),
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

      const result = await directUpload(file, uploadMeta, token || undefined);

      if (!result.success || !result.data) {
        setError(result.message || '上传失败');
        setStep('fill');
        return;
      }

      setProgress(100);
      setUploadMsg('上传成功！');
      // 延迟 1 秒跳转，让用户看到完成态
      setTimeout(() => {
        navigate(`/photos/${result.data!.photoId}`);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
      setStep('fill');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className={`p-8 rounded-2xl ${theme === 'dark' ? 'bg-slate-800' : 'bg-white'} shadow-xl`}>
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">请先登录</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">上传图片需要登录账户</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
            上传图片
          </h1>
          <p className="text-gray-600 dark:text-gray-400">分享您的精彩交通摄影作品</p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-100 text-red-600 rounded-lg text-sm">{error}</div>
        )}

        {step === 'select' && (
          <div className={`p-6 rounded-2xl ${theme === 'dark' ? 'bg-slate-800/95' : 'bg-white'} shadow-xl`}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              className="border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-blue-400"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="space-y-4">
                <div className="w-20 h-20 mx-auto rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="font-medium text-gray-600 dark:text-gray-300">点击选择图片</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">支持 JPG、PNG、WebP、HEIC，最大 50MB，每次仅上传一张</p>
              </div>
            </div>
          </div>
        )}

        {(step === 'fill' || step === 'uploading') && file && (
          <div className={`p-6 rounded-2xl ${theme === 'dark' ? 'bg-slate-800/95' : 'bg-white'} shadow-xl`}>
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
                <p className="text-sm font-medium truncate text-gray-700 dark:text-gray-200">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                {step === 'uploading' && (
                  <p className="text-xs text-blue-500 mt-1">{uploadMsg}</p>
                )}
              </div>
            </div>

            {step === 'uploading' && (
              <div className="w-full bg-gray-200 rounded-full h-2 mb-6 dark:bg-gray-700">
                <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className={labelCls}>选择分类 <span className="text-red-500">*</span></label>
                <div className="flex gap-3 mt-2">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategory(cat.id as Category)}
                      disabled={step === 'uploading'}
                      className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                        category === cat.id
                          ? 'bg-blue-500 text-white shadow-lg'
                          : theme === 'dark'
                          ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <span>{cat.icon}</span>
                      <span>{cat.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>标题 <span className="text-red-500">*</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={step === 'uploading'} placeholder="请输入照片标题" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>照片描述</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={step === 'uploading'} placeholder="请输入照片描述（可选）" rows={3} className={`${inputCls} resize-none`} />
              </div>

              {category && (
                <div>
                  <label className={labelCls}>选择标签</label>
                  <div className="mt-2 space-y-3">
                    {categoryTags.map((obj) => {
                      const isSelected = selectedTags.some((t) => t.objectId === obj.id);
                      return (
                        <div
                          key={obj.id}
                          className={`rounded-lg border p-3 cursor-pointer transition-all ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                              : theme === 'dark'
                              ? 'border-gray-600 bg-slate-700/50 hover:border-gray-500'
                              : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                          }`}
                          onClick={() => handleTagToggle(obj.id, obj.name)}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`font-medium ${isSelected ? 'text-blue-600 dark:text-blue-400' : theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                              {obj.name}
                            </span>
                            <span className={`text-sm px-2 py-1 rounded ${
                              isSelected
                                ? 'bg-blue-500 text-white'
                                : theme === 'dark'
                                ? 'bg-slate-600 text-gray-400'
                                : 'bg-gray-200 text-gray-600'
                            }`}>
                              {isSelected ? '已选择' : '点击选择'}
                            </span>
                          </div>
                          {obj.description && (
                            <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
                              {obj.description}
                            </p>
                          )}
                          {isSelected && obj.attributes.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {obj.attributes.map((attr) => {
                                const currentValue = selectedTags.find((t) => t.objectId === obj.id)?.attributes[attr.key] || '';
                                return (
                                  <div key={attr.id}>
                                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{attr.label}</span>
                                    {attr.type === 'select' ? (
                                      <select
                                        value={currentValue}
                                        onChange={(e) => handleAttributeChange(obj.id, attr.key, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        className={`${inputCls} mt-1`}
                                      >
                                        <option value="">请选择</option>
                                        {attr.options.map((opt) => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type={attr.type}
                                        value={currentValue}
                                        onChange={(e) => handleAttributeChange(obj.id, attr.key, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        placeholder={`请输入${attr.label}`}
                                        className={`${inputCls} mt-1`}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls}>水印设置</label>
                <div className={`mt-3 p-4 rounded-lg ${theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <span className="text-xs text-gray-500">水印文字</span>
                      <div className={`${inputCls} mt-1 flex items-center`}>
                        <span className="font-medium">{watermarkText}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">字体大小: {watermarkSize}px</span>
                      <input type="range" min="12" max="72" value={watermarkSize} onChange={(e) => setWatermarkSize(Number(e.target.value))} className={`w-full mt-1 ${theme === 'dark' ? 'accent-blue-500' : ''}`} />
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">透明度: {watermarkOpacity}%</span>
                      <input type="range" min="10" max="100" value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(Number(e.target.value))} className={`w-full mt-1 ${theme === 'dark' ? 'accent-blue-500' : ''}`} />
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
                      <img src={preview} alt="preview" className="w-full max-h-64 object-contain" />
                      <div
                        ref={watermarkRef}
                        className="absolute cursor-move select-none pointer-events-auto"
                        style={{
                          left: `${watermarkX}%`,
                          top: `${watermarkY}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                        onMouseDown={handleMouseDown}
                      >
                        <span
                          className="text-white drop-shadow-md"
                          style={{
                            fontSize: `${watermarkSize}px`,
                            opacity: watermarkOpacity / 100,
                            textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
                          }}
                        >
                          {watermarkText}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  拍摄参数
                  <span className="ml-2 text-xs text-green-500">（已自动读取）</span>
                </label>
                <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-lg ${theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
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
                  <div>
                    <span className="text-xs text-gray-500">海拔</span>
                    <input type="number" value={exif.altitude || ''} onChange={(e) => setExif({ ...exif, altitude: Number(e.target.value) })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <span className="text-xs text-gray-500">拍摄位置</span>
                    <input type="text" value={exif.location || ''} onChange={(e) => setExif({ ...exif, location: e.target.value })} disabled={step === 'uploading'} className={`${inputCls} mt-1`} />
                  </div>
                </div>
              </div>

              <div className={`flex items-start gap-3 p-4 rounded-lg ${theme === 'dark' ? 'bg-red-900/20 border border-red-700/50' : 'bg-red-50 border border-red-200'}`}>
                <input
                  type="checkbox"
                  id="safety-agreement"
                  checked={safetyAgreement}
                  onChange={(e) => setSafetyAgreement(e.target.checked)}
                  disabled={step === 'uploading'}
                  className="mt-1"
                />
                <label htmlFor="safety-agreement" className={`text-sm flex-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  <span className="text-red-500 font-medium">我确认本影像不涉及任何军事设施、装备或敏感区域</span>
                  <span className="text-red-500">*</span>
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
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {step === 'uploading' ? '上传中...' : '上传'}
                </button>
              </div>

              {!canSubmit && step === 'fill' && (
                <p className="text-xs text-center text-gray-400">
                  {!title.trim() && '请填写标题'}
                  {title.trim() && !category && '请选择分类'}
                  {title.trim() && category && !safetyAgreement && '请勾选安全声明'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
