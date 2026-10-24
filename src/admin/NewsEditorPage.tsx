/**
 * 新闻编辑器页（V4.0.0，新建与编辑复用）
 * 标题输入 + Markdown 正文多行文本 + 配图区（图库选图弹窗 + 每张授权确认勾选 + 排序/移除）。
 * - 选图复用公开检索 GET /api/photos/search（关键字搜索，弹窗内分页），仅引用 photo_id，禁止本地上传；
 * - 每张配图必须勾选授权确认（承诺允许在不改变图片色彩与内容的前提下使用且显著署名），未全部勾选时提交禁用；
 * - PUT 为全删全插语义，每次提交传完整 images 数组；板块固定航空（后端白名单校验）。
 * 编辑态数据回填：GET /api/news/:id（公开详情，含配图代理 URL）+ GET /api/articles/:id/content（Markdown 正文）。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNews, updateNews } from './api';
import { getNewsDetail } from '../api/news';
import { getArticleContent } from '../api/articles';
import { searchPhotos } from '../api/photos';
import { MobileReadOnlyNotice } from './MobileReadOnlyNotice';
import type { PhotoListItem } from '../features/gallery/types';

/** 新闻固定板块 id（首批仅航空，与后端 NEWS_ALLOWED_BOARD_IDS 一致） */
const NEWS_BOARD_ID = 'aviation';

/** 选图弹窗每页数量（/photos/search 无服务端分页，弹窗内切片分页） */
const PICKER_PAGE_SIZE = 24;

/** 编辑器已选配图项 */
interface SelectedImage {
  photo_id: string;
  /** 照片标题（弹窗选择时携带，回填时来自详情接口） */
  title: string | null;
  /** 缩略图代理 URL */
  thumbnail_url: string;
  /** 授权确认：必须为 true 才可提交 */
  authorization_confirmed: boolean;
}

/**
 * 新闻编辑器页组件
 * @param props.newsId 编辑目标新闻 id；缺省为新建模式
 * @returns 编辑器表单 + 图库选图弹窗 JSX
 */
export function NewsEditorPage({ newsId }: { newsId?: string }) {
  const navigate = useNavigate();
  const isEdit = Boolean(newsId);

  // 表单状态
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<SelectedImage[]>([]);

  // 编辑态回填加载 / 保存中 / 提示
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  // 图库选图弹窗状态
  const [showPicker, setShowPicker] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<PhotoListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [pickerPage, setPickerPage] = useState(1);
  // 弹窗内临时勾选（确认后合并进 images，未确认授权前不可提交）
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  // 编辑态：拉取新闻详情回填标题/正文/配图（正文复用 articles content 端点）
  useEffect(() => {
    if (!newsId) return;
    let cancelled = false;
    (async () => {
      const detail = await getNewsDetail(newsId);
      if (cancelled) return;
      if (detail.success && detail.data) {
        setTitle(detail.data.title);
        setImages(
          detail.data.images.map((img) => ({
            photo_id: img.photo_id,
            title: img.title,
            thumbnail_url: img.preview_url || img.thumbnail_url || '',
            // 后端入库即已确认授权，回填时直接置 true
            authorization_confirmed: true,
          }))
        );
        const contentResult = await getArticleContent(newsId);
        if (!cancelled && contentResult.success && typeof contentResult.data === 'string') {
          setContent(contentResult.data);
        }
      } else {
        setNotice(detail.message || '加载新闻失败');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [newsId]);

  /** 执行图库检索：空关键字返回最新已审核照片 */
  const handleSearch = async () => {
    setSearching(true);
    const result = await searchPhotos({ keyword: keyword.trim() || undefined });
    if (result.success && result.data) {
      setResults(result.data);
      setSearched(true);
      setPickerPage(1);
    }
    setSearching(false);
  };

  /** 弹窗内切换某张照片的选中态 */
  const togglePickerSelected = (photoId: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  /** 确认添加：把弹窗勾选的照片追加进配图列表（按 photo_id 去重），授权默认未勾选 */
  const confirmPick = () => {
    setImages((prev) => {
      const existing = new Set(prev.map((img) => img.photo_id));
      const additions = results
        .filter((photo) => pickerSelected.has(photo.id) && !existing.has(photo.id))
        .map((photo) => ({
          photo_id: photo.id,
          title: photo.title || null,
          thumbnail_url: photo.thumbnail_path,
          authorization_confirmed: false,
        }));
      return [...prev, ...additions];
    });
    setPickerSelected(new Set());
    setShowPicker(false);
  };

  /** 切换某张配图的授权确认勾选 */
  const toggleAuthorization = (photoId: string) => {
    setImages((prev) =>
      prev.map((img) =>
        img.photo_id === photoId ? { ...img, authorization_confirmed: !img.authorization_confirmed } : img
      )
    );
  };

  /** 移除配图 */
  const removeImage = (photoId: string) => {
    setImages((prev) => prev.filter((img) => img.photo_id !== photoId));
  };

  /** 配图排序：与相邻项交换位置（首位为封面） */
  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // 提交校验：标题/正文/至少一张配图/全部勾选授权
  const allAuthorized = images.length > 0 && images.every((img) => img.authorization_confirmed);
  const canSubmit = Boolean(title.trim()) && Boolean(content.trim()) && allAuthorized && !saving;

  /** 提交新闻：新建 POST / 编辑 PUT（images 每次传完整数组，全删全插） */
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setNotice('');
    const payload = {
      title: title.trim(),
      content: content.trim(),
      board_id: NEWS_BOARD_ID,
      images: images.map((img) => ({ photo_id: img.photo_id, authorization_confirmed: true })),
    };
    const result = isEdit ? await updateNews(newsId!, payload) : await createNews(payload);
    setSaving(false);
    if (result.success) {
      navigate('/admin/news');
    } else {
      // 后端错误码（AUTHORIZATION_REQUIRED/IMAGES_REQUIRED/PHOTO_INVALID 等）直接展示
      setNotice(result.message || (isEdit ? '更新新闻失败' : '创建新闻失败'));
      setTimeout(() => setNotice(''), 4000);
    }
  };

  // 弹窗分页切片
  const pickerTotalPages = Math.max(1, Math.ceil(results.length / PICKER_PAGE_SIZE));
  const pickerPageItems = results.slice(
    (pickerPage - 1) * PICKER_PAGE_SIZE,
    pickerPage * PICKER_PAGE_SIZE
  );

  return (
    <div className="max-w-4xl">
      <MobileReadOnlyNotice />
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">{isEdit ? '编辑新闻' : '新建新闻'}</h2>
        <button
          onClick={() => navigate('/admin/news')}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          返回列表
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-500">加载中...</div>
      ) : (
        <div className="space-y-5">
          {/* 操作提示 */}
          {notice && (
            <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
              {notice}
            </p>
          )}

          {/* 板块（首批固定航空，只读说明） */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                航空
              </span>
              <span className="text-sm text-gray-500">新闻板块固定为航空（首批仅开放航空板块，后端白名单校验）</span>
            </div>
          </div>

          {/* 标题 */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <label className="block text-sm font-medium text-gray-800 mb-2">
              标题 <span className="text-red-500">*</span>
              <span className="ml-2 text-xs text-gray-400">{title.length}/200</span>
            </label>
            <input
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入新闻标题"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-gray-900"
            />
          </div>

          {/* 正文 */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <label className="block text-sm font-medium text-gray-800 mb-2">
              正文（Markdown） <span className="text-red-500">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="支持 Markdown 语法，正文不能为空"
              rows={12}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-gray-900 leading-relaxed resize-y"
            />
          </div>

          {/* 配图区 */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-800">
                配图 <span className="text-red-500">*</span>
                <span className="ml-2 text-xs text-gray-400">
                  共 {images.length} 张 · 已确认授权 {images.filter((img) => img.authorization_confirmed).length}/{images.length} · 首位为封面
                </span>
              </label>
              <button
                onClick={() => setShowPicker(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
              >
                从图库选图
              </button>
            </div>

            {images.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-300 rounded-lg">
                尚未选择配图，点击「从图库选图」从已审核作品中选取（禁止本地上传）
              </p>
            ) : (
              <div className="space-y-3">
                {images.map((img, index) => (
                  <div
                    key={img.photo_id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-200"
                  >
                    <img
                      src={img.thumbnail_url}
                      alt={img.title || '配图'}
                      className="w-20 h-20 object-cover rounded-lg bg-gray-100 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {index === 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-700 text-white flex-shrink-0">封面</span>
                        )}
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {img.title || img.photo_id}
                        </span>
                      </div>
                      {/* 授权确认勾选（每张必选，未全选提交禁用） */}
                      <label className="flex items-start gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={img.authorization_confirmed}
                          onChange={() => toggleAuthorization(img.photo_id)}
                          className="mt-0.5 w-4 h-4 accent-blue-700 flex-shrink-0"
                        />
                        <span className="text-xs text-gray-600 leading-relaxed">
                          授权确认：承诺允许在不改变图片色彩与内容的前提下使用且显著署名
                        </span>
                      </label>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <div className="flex gap-1">
                        <button
                          onClick={() => moveImage(index, -1)}
                          disabled={index === 0}
                          className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                        >
                          上移
                        </button>
                        <button
                          onClick={() => moveImage(index, 1)}
                          disabled={index === images.length - 1}
                          className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                        >
                          下移
                        </button>
                      </div>
                      <button
                        onClick={() => removeImage(img.photo_id)}
                        className="px-2 py-1 rounded text-xs bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 提交 */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {saving ? '保存中...' : isEdit ? '保存修改' : '发布新闻'}
            </button>
            {images.length === 0 && (
              <span className="text-xs text-gray-500">请至少选择一张配图</span>
            )}
            {images.length > 0 && !allAuthorized && (
              <span className="text-xs text-red-600">尚有配图未勾选授权确认，勾选全部后方可提交</span>
            )}
          </div>
        </div>
      )}

      {/* 图库选图弹窗 */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-4xl max-h-[85vh] flex flex-col">
            {/* 弹窗头：检索 */}
            <div className="px-5 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-gray-900">从图库选图</h3>
                <button
                  onClick={() => {
                    setShowPicker(false);
                    setPickerSelected(new Set());
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  关闭
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                  placeholder="按标题 / 描述 / 飞机注册号搜索已审核作品"
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-gray-900 text-sm"
                />
                <button
                  onClick={() => handleSearch()}
                  disabled={searching}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
                >
                  {searching ? '搜索中...' : '搜索'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                共 {results.length} 张可选用图 · 已勾选 {pickerSelected.size} 张 · 可多选，确认后仍需逐张勾选授权
              </p>
            </div>

            {/* 弹窗体：检索结果网格 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!searched && !searching ? (
                <div className="py-10 text-center text-sm text-gray-500">
                  输入关键字搜索，或直接点击「搜索」浏览最新已审核作品
                </div>
              ) : searching ? (
                <div className="py-10 text-center text-sm text-gray-500">搜索中...</div>
              ) : pickerPageItems.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-500">未找到匹配的已审核作品</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {pickerPageItems.map((photo) => {
                    const selected = pickerSelected.has(photo.id);
                    return (
                      <button
                        key={photo.id}
                        onClick={() => togglePickerSelected(photo.id)}
                        className={`relative rounded-lg overflow-hidden border text-left transition-colors ${
                          selected
                            ? 'border-blue-700 ring-2 ring-blue-200'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        <img
                          src={photo.thumbnail_path}
                          alt={photo.title}
                          className="w-full aspect-[4/3] object-cover bg-gray-100"
                        />
                        <div className="p-2">
                          <p className="text-xs font-medium text-gray-900 truncate">{photo.title}</p>
                          {photo.registration_number && (
                            <p className="text-[11px] text-gray-500 truncate mt-0.5">{photo.registration_number}</p>
                          )}
                        </div>
                        {selected && (
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-blue-700 text-white text-[11px] font-medium">
                            已选
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 弹窗脚：分页 + 确认 */}
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  disabled={pickerPage <= 1}
                  onClick={() => setPickerPage((p) => p - 1)}
                  className="px-3 py-1 rounded bg-gray-100 text-gray-600 text-sm disabled:opacity-40 transition-colors"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-500">{pickerPage} / {pickerTotalPages}</span>
                <button
                  disabled={pickerPage >= pickerTotalPages}
                  onClick={() => setPickerPage((p) => p + 1)}
                  className="px-3 py-1 rounded bg-gray-100 text-gray-600 text-sm disabled:opacity-40 transition-colors"
                >
                  下一页
                </button>
              </div>
              <button
                onClick={confirmPick}
                disabled={pickerSelected.size === 0}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                确认添加（{pickerSelected.size} 张）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
