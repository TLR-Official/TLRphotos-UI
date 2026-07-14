import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../shared/ThemeContext';
import { getPhotos, searchPhotos, getTags } from '../../api/photos';
import type { PhotoListItem } from './types';

type SortOption = 'created_at' | 'likes' | 'views';

const SearchIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const FilterIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
  </svg>
);

const ClockIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const FlameIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const EyeIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const ArrowUpDownIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
  </svg>
);

export function GalleryPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);

  const fetchPhotos = async () => {
    setIsLoading(true);
    try {
      let response;
      if (keyword || selectedTag || sortBy !== 'created_at' || sortOrder !== 'desc') {
        response = await searchPhotos({
          keyword,
          tag: selectedTag || undefined,
          sortBy,
          sortOrder,
        });
      } else {
        response = await getPhotos();
      }
      if (response.success && response.data) {
        setPhotos(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch photos:', error);
    }
    setIsLoading(false);
  };

  const fetchTags = async () => {
    try {
      const response = await getTags();
      if (response.success && response.data) {
        setTags(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchPhotos();
    }, 300);
    return () => clearTimeout(debounce);
  }, [keyword, selectedTag, sortBy, sortOrder]);

  const handleSortChange = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  const handlePhotoClick = (photoId: string) => {
    navigate(`/photo/${photoId}`);
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className={`mb-8 rounded-2xl p-6 ${theme === 'dark' ? 'glass-lg' : 'bg-white/80 backdrop-blur-md'} shadow-xl`}>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className={`flex-1 relative ${theme === 'dark' ? 'bg-slate-800/50' : 'bg-gray-100'} rounded-xl`}>
              <SearchIcon className={`absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`} />
              <input
                type="text"
                placeholder="搜索照片标题或描述..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className={`w-full rounded-xl border-none py-3 pl-12 pr-4 outline-none transition-all ${
                  theme === 'dark'
                    ? 'bg-slate-800/50 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500/50'
                    : 'bg-gray-100 text-gray-800 placeholder-gray-500 focus:ring-2 focus:ring-purple-500/50'
                }`}
              />
            </div>
            <div className={`flex items-center gap-2 rounded-xl p-1 ${theme === 'dark' ? 'bg-slate-800/50' : 'bg-gray-100'}`}>
              <FilterIcon className={`mr-2 h-4 w-4 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`} />
              <button
                onClick={() => {
                  setSelectedTag(null);
                  setKeyword('');
                }}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  !selectedTag && !keyword
                    ? theme === 'dark'
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-600 text-white'
                    : theme === 'dark'
                    ? 'text-slate-300 hover:bg-white/10'
                    : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                全部
              </button>
              {tags.slice(0, 5).map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    selectedTag === tag
                      ? theme === 'dark'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-600 text-white'
                      : theme === 'dark'
                      ? 'text-slate-300 hover:bg-white/10'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
              {tags.length > 5 && (
                <span className={`px-3 py-1.5 text-sm ${theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}>
                  +{tags.length - 5}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={`flex items-center justify-between mb-6 ${theme === 'dark' ? 'text-slate-300' : 'text-gray-700'}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium">
              共 {photos.length} 张照片
            </span>
            {selectedTag && (
              <span className={`px-2 py-0.5 text-sm rounded-full ${theme === 'dark' ? 'bg-purple-600/30 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                #{selectedTag}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ArrowUpDownIcon className="h-4 w-4 mr-2" />
            <button
              onClick={() => handleSortChange('created_at')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-all ${
                sortBy === 'created_at'
                  ? theme === 'dark'
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-600 text-white'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
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
                  ? theme === 'dark'
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-600 text-white'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
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
                  ? theme === 'dark'
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-600 text-white'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
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
            <div className={`animate-spin rounded-full h-12 w-12 border-4 ${theme === 'dark' ? 'border-purple-600 border-t-transparent' : 'border-purple-600 border-t-transparent'}`} />
          </div>
        ) : photos.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-16 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
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
                className={`break-inside-avoid rounded-xl overflow-hidden cursor-pointer group transition-all duration-300 hover:scale-[1.02] ${
                  theme === 'dark' ? 'glass-sm' : 'bg-white shadow-lg'
                }`}
              >
                <div className="relative aspect-auto">
                  <img
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    className="w-full h-auto object-cover"
                    loading="lazy"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  <div className={`absolute bottom-0 left-0 right-0 p-4 translate-y-full group-hover:translate-y-0 transition-transform duration-300`}>
                    <h3 className="text-white font-medium text-sm truncate mb-2">{photo.title}</h3>
                    <div className="flex flex-wrap gap-1">
                      {photo.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-2 py-0.5 text-xs bg-white/20 text-white rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className={`absolute top-3 right-3 text-xs font-medium text-white bg-black/50 rounded-full px-2 py-1`}>
                    #{photo.id}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
