/**
 * 画廊列表页
 * 顶部渲染分区标签页导航（航空/铁路/汽车），下方为三层标签逐层下钻区（分区 → 标签对象 → 细分属性），
 * 左侧侧边栏提供关键词搜索与当前筛选摘要，右侧为照片瀑布流网格与排序栏。点击单张照片跳转至详情页。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchPhotos, getTagsWithCounts } from '../../api/photos';
import { getTagCategories, getCategoryTags } from '../../api/tags';
import type { TagCategory, TagObject } from '../../api/tags';
import type { PhotoListItem } from './types';
import { CachedImage } from '../../components/CachedImage';

/** 排序字段：上传时间 / 点赞数 / 浏览量 */
type SortOption = 'created_at' | 'likes' | 'views';

/** 第三层细分标签选择（属性键 + 选项值） */
interface AttrFilter {
  key: string;
  value: string;
}

/** 搜索图标 */
const SearchIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

/** 时钟图标（按时间排序） */
const ClockIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

/** 火焰图标（按热度排序） */
const FlameIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

/** 眼睛图标（按浏览量排序） */
const EyeIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

/** 上下箭头图标（排序切换） */
const ArrowUpDownIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
  </svg>
);

/**
 * 画廊列表页组件
 * 维护分区、已选标签、搜索关键词、排序字段与方向等筛选状态，
 * 通过防抖触发列表请求，分区切换时清空标签并重新加载。
 * @returns 画廊页 JSX
 */
export function GalleryPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // 第二层标签对象（如「飞行器」）与第三层细分标签（属性键值），逐层下钻浏览
  const [tagObjects, setTagObjects] = useState<TagObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<TagObject | null>(null);
  const [selectedAttr, setSelectedAttr] = useState<AttrFilter | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);
  // 热门标签 chips 行
  const [hotTags, setHotTags] = useState<{ name: string; count: number }[]>([]);
  const [hotTag, setHotTag] = useState<string | null>(null);

  /** 拉取分区列表，首次加载自动选中第一个分区 */
  useEffect(() => {
    getTagCategories().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        setCategories(res.data);
        setSelectedCategory(res.data[0].id);
      }
    });
  }, []);

  /** 分区切换时重置下钻层级，并拉取该分区下的第二层标签对象 */
  useEffect(() => {
    setSelectedObject(null);
    setSelectedAttr(null);
    if (!selectedCategory) {
      setTagObjects([]);
      return;
    }
    getCategoryTags(selectedCategory).then((res) => {
      setTagObjects(res.success && res.data ? res.data.objects : []);
    });
  }, [selectedCategory]);

  /** 拉取热门标签列表（按数量降序），取前 12 个 */
  useEffect(() => {
    getTagsWithCounts().then((res) => {
      if (res.success && res.data) {
        setHotTags(res.data.slice(0, 12));
      }
    });
  }, []);

  /**
   * 拉取照片列表
   * 统一走搜索接口：分区 / 第二层标签 / 第三层属性 / 关键词 / 排序条件均作为查询参数，
   * 未选择任何下钻层级时即为分区全量浏览。
   */
  const fetchPhotos = async () => {
    setIsLoading(true);
    try {
      // 第二层标签对象名与热门标签 chip 合并（去重）后逗号拼接，后端按 AND 匹配
      const tagNames = [...new Set([selectedObject?.name, hotTag].filter(Boolean) as string[])].join(',');
      const response = await searchPhotos({
        keyword,
        tag: tagNames || undefined,
        tag_key: selectedAttr?.key,
        tag_value: selectedAttr?.value,
        category: selectedCategory || undefined,
        sortBy,
        sortOrder,
      });
      if (response.success && response.data) {
        setPhotos(response.data);
      } else {
        setPhotos([]);
      }
    } catch (error) {
      console.error('Failed to fetch photos:', error);
      setPhotos([]);
    }
    setIsLoading(false);
  };

  // 分区/筛选/排序条件变化时，延迟 300ms 再请求，避免频繁触发
  useEffect(() => {
    if (!selectedCategory) return;
    const debounce = setTimeout(() => {
      fetchPhotos();
    }, 300);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, selectedObject, selectedAttr, sortBy, sortOrder, selectedCategory, hotTag]);

  /**
   * 切换排序字段或方向
   * 点击相同字段时翻转方向；点击不同字段时切换并重置为降序。
   */
  const handleSortChange = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  /** 跳转到指定照片详情页 */
  const handlePhotoClick = (photoId: string) => {
    navigate(`/photos/${photoId}`);
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* 分区标签页导航栏 */}
        {categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <SearchIcon className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg">暂无分区数据</p>
            <p className="text-sm mt-2">请稍后再试</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-6 border-b border-gray-200">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-6 py-3 font-medium transition-all border-b-2 ${
                    selectedCategory === cat.id
                      ? 'border-blue-700 text-blue-800'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="mr-2">{cat.icon}</span>
                  {cat.name}
                </button>
              ))}
            </div>

            {/* 三层标签逐层下钻：面包屑 + 第二层对象 chips + 第三层细分标签 chips */}
            {selectedCategory && (
              <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                {/* 面包屑：每一层均可点击返回，清除更深层的筛选 */}
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  <button
                    onClick={() => {
                      setSelectedObject(null);
                      setSelectedAttr(null);
                    }}
                    className={`px-1 rounded transition-colors ${
                      selectedObject
                        ? 'text-blue-700 hover:underline'
                        : 'text-gray-800 font-medium'
                    }`}
                  >
                    {categories.find((c) => c.id === selectedCategory)?.name || '全部分区'}
                  </button>
                  {selectedObject && (
                    <>
                      <span className="text-gray-400">›</span>
                      <button
                        onClick={() => setSelectedAttr(null)}
                        className={`px-1 rounded transition-colors ${
                          selectedAttr ? 'text-blue-700 hover:underline' : 'text-gray-800 font-medium'
                        }`}
                      >
                        {selectedObject.name}
                      </button>
                    </>
                  )}
                  {selectedAttr && (
                    <>
                      <span className="text-gray-400">›</span>
                      <span className="px-1 text-gray-800 font-medium">{selectedAttr.value}</span>
                    </>
                  )}
                  {(selectedObject || selectedAttr || hotTag) && (
                    <button
                      onClick={() => {
                        setSelectedObject(null);
                        setSelectedAttr(null);
                        setHotTag(null);
                      }}
                      className="ml-2 text-xs text-gray-500 hover:text-blue-700"
                    >
                      清除筛选
                    </button>
                  )}
                </div>

                {/* 第二层：点击标签对象即筛选该对象下已审核照片 */}
                {tagObjects.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-sm text-gray-500">标签:</span>
                    {tagObjects.map((obj) => {
                      const selected = selectedObject?.id === obj.id;
                      return (
                        <button
                          key={obj.id}
                          onClick={() => {
                            setSelectedObject(selected ? null : obj);
                            setSelectedAttr(null);
                          }}
                          className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                            selected
                              ? 'bg-blue-700 border-blue-700 text-white'
                              : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-50'
                          }`}
                        >
                          {obj.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 第三层：已选对象的可选项属性（如 机型类型：宽体机/窄体机），点击直接筛选 */}
                {selectedObject &&
                  selectedObject.attributes
                    .filter((attr) => attr.type === 'select' && attr.options.length > 0)
                    .map((attr) => (
                      <div key={attr.id} className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="text-xs text-gray-500">{attr.label || attr.key}:</span>
                        {attr.options.map((option) => {
                          const selected =
                            selectedAttr?.key === attr.key && selectedAttr?.value === option;
                          return (
                            <button
                              key={option}
                              onClick={() =>
                                setSelectedAttr(selected ? null : { key: attr.key, value: option })
                              }
                              className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                                selected
                                  ? 'bg-blue-700 border-blue-700 text-white'
                                  : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-800'
                              }`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    ))}

                <p className="mt-3 text-xs text-gray-400">
                  点击标签逐层下钻，查询该层已审核图片；点击面包屑可返回上一层。
                </p>
              </div>
            )}

            {/* 热门标签 chips 行：点击切换 tag 筛选，为空时整行隐藏 */}
            {hotTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="text-sm text-gray-500">热门标签:</span>
                {hotTags.map((t) => {
                  const selected = hotTag === t.name;
                  return (
                    <button
                      key={t.name}
                      onClick={() => setHotTag(selected ? null : t.name)}
                      className={`px-3 py-1 text-sm rounded-full border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-blue-700 border-blue-700 text-white'
                          : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                      }`}
                    >
                      {t.name} ({t.count})
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-6">
              {/* 左侧侧边栏：关键词搜索 + 当前筛选摘要 */}
              <div className="w-72 flex-shrink-0">
                <div className="relative mb-4">
                  <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索标题、描述或飞机注册号"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white text-gray-800 placeholder-gray-400 py-2.5 pl-10 pr-3 outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
                  />
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-3 text-sm text-gray-600">
                  <h3 className="font-medium text-gray-700 mb-2">当前筛选</h3>
                  <p className="text-xs leading-6">
                    分区：{categories.find((c) => c.id === selectedCategory)?.name || '-'}
                    <br />
                    标签：{selectedObject?.name || '未选择（点击上方标签下钻）'}
                    {selectedAttr && (
                      <>
                        <br />
                        细分：{selectedAttr.key} · {selectedAttr.value}
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* 右侧：排序栏 + 照片网格 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-6 text-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-medium">共 {photos.length} 张照片</span>
                    {selectedObject && (
                      <span className="px-2 py-0.5 text-sm rounded-full bg-blue-50 text-blue-800">
                        {selectedObject.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUpDownIcon className="h-4 w-4 mr-2" />
                    <button
                      onClick={() => handleSortChange('created_at')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-all ${
                        sortBy === 'created_at'
                          ? 'bg-blue-700 text-white'
                          : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <ClockIcon className="h-4 w-4" />
                      时间
                      {sortBy === 'created_at' && (
                        <span className="text-xs">{sortOrder === 'desc' ? '↓' : '↑'}</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleSortChange('likes')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-all ${
                        sortBy === 'likes'
                          ? 'bg-blue-700 text-white'
                          : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <FlameIcon className="h-4 w-4" />
                      热度
                      {sortBy === 'likes' && (
                        <span className="text-xs">{sortOrder === 'desc' ? '↓' : '↑'}</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleSortChange('views')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-all ${
                        sortBy === 'views'
                          ? 'bg-blue-700 text-white'
                          : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <EyeIcon className="h-4 w-4" />
                      浏览
                      {sortBy === 'views' && (
                        <span className="text-xs">{sortOrder === 'desc' ? '↓' : '↑'}</span>
                      )}
                    </button>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-700 border-t-transparent" />
                  </div>
                ) : photos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                    <SearchIcon className="h-16 w-16 mb-4 opacity-50" />
                    <p className="text-lg">没有找到相关照片</p>
                    <p className="text-sm mt-2">尝试调整搜索关键词或标签筛选</p>
                  </div>
                ) : (
                  <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                    {photos.map((photo) => (
                      <div
                        key={photo.id}
                        onClick={() => handlePhotoClick(photo.id)}
                        className="break-inside-avoid rounded-xl overflow-hidden cursor-pointer group transition-all duration-300 hover:scale-[1.02] bg-white shadow-lg"
                      >
                        <div className="relative aspect-auto">
                          <CachedImage
                            src={photo.thumbnail_path}
                            alt={photo.title}
                            className="w-full h-auto object-cover"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                          <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                            <h3 className="text-white font-medium text-sm truncate mb-2">{photo.title}</h3>
                            <div className="flex flex-wrap gap-1">
                              {photo.tags.slice(0, 3).map((tag) => (
                                <span key={tag} className="px-2 py-0.5 text-xs bg-white/20 text-white rounded-full">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="absolute top-3 right-3 text-xs font-medium text-white bg-black/50 rounded-full px-2 py-1">
                            #{photo.id}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
