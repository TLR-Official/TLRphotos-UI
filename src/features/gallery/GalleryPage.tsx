/**
 * 画廊列表页
 * 顶部渲染分区标签页导航（航空/铁路/汽车），左侧侧边栏提供关键词搜索 + 标签选择器，
 * 右侧为照片瀑布流网格与排序栏。点击单张照片跳转至详情页。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPhotos, searchPhotos } from '../../api/photos';
import { getTagCategories } from '../../api/tags';
import type { TagCategory } from '../../api/tags';
import { TagSelector } from '../../components/TagSelector';
import type { SelectedTag } from '../../components/TagSelector';
import type { PhotoListItem } from './types';
import { CachedImage } from '../../components/CachedImage';

/** 排序字段：上传时间 / 点赞数 / 浏览量 */
type SortOption = 'created_at' | 'likes' | 'views';

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
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([]);
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);

  /** 拉取分区列表，首次加载自动选中第一个分区 */
  useEffect(() => {
    getTagCategories().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        setCategories(res.data);
        setSelectedCategory(res.data[0].id);
      }
    });
  }, []);

  /**
   * 拉取照片列表
   * 当存在分区/搜索/标签/排序条件时调用搜索接口，否则调用默认列表接口。
   */
  const fetchPhotos = async () => {
    setIsLoading(true);
    try {
      // 已选标签的 objectName 列表，用逗号拼接传给 search 接口的 tag 参数
      const tagNames = selectedTags.map((t) => t.objectName).join(',');
      const hasAdvancedConditions =
        keyword || tagNames || sortBy !== 'created_at' || sortOrder !== 'desc';
      let response;
      if (hasAdvancedConditions) {
        response = await searchPhotos({
          keyword,
          tag: tagNames || undefined,
          category: selectedCategory || undefined,
          sortBy,
          sortOrder,
        });
      } else {
        response = await getPhotos(selectedCategory || undefined);
      }
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
  }, [keyword, selectedTags, sortBy, sortOrder, selectedCategory]);

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
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setSelectedTags([]);
                  }}
                  className={`px-6 py-3 font-medium transition-all border-b-2 ${
                    selectedCategory === cat.id
                      ? 'border-purple-600 text-purple-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="mr-2">{cat.icon}</span>
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="flex gap-6">
              {/* 左侧侧边栏：搜索框 + 标签选择器 */}
              <div className="w-72 flex-shrink-0">
                <div className="relative mb-4">
                  <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索标题或描述..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white text-gray-800 placeholder-gray-400 py-2.5 pl-10 pr-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                {selectedCategory && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 px-1">标签筛选</h3>
                    <TagSelector
                      categoryId={selectedCategory}
                      selectedTags={selectedTags}
                      onTagsChange={setSelectedTags}
                    />
                  </div>
                )}
              </div>

              {/* 右侧：排序栏 + 照片网格 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-6 text-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-medium">共 {photos.length} 张照片</span>
                    {selectedTags.length > 0 && (
                      <span className="px-2 py-0.5 text-sm rounded-full bg-purple-100 text-purple-700">
                        {selectedTags.length} 个标签
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUpDownIcon className="h-4 w-4 mr-2" />
                    <button
                      onClick={() => handleSortChange('created_at')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-all ${
                        sortBy === 'created_at'
                          ? 'bg-purple-600 text-white'
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
                          ? 'bg-purple-600 text-white'
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
                          ? 'bg-purple-600 text-white'
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
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-600 border-t-transparent" />
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
