/**
 * 照片轮播图组件
 * 从全局 PhotosContext 取前 5 张照片作为首页轮播图，支持自动播放、左右切换、指示点跳转，
 * 点击单张幻灯片跳转至对应照片详情页。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PhotoListItem } from './types';
import { usePhotos } from '../../shared/PhotosContext';
import { useTheme } from '../../shared/ThemeContext';
import { CachedImage } from '../../components/CachedImage';

/** 轮播图单张幻灯片 props */
interface CarouselSlideProps {
  photo: PhotoListItem;
  isActive: boolean;
  onClick: () => void;
  theme: 'dark' | 'light';
}

/**
 * 单张轮播幻灯片
 * 通过 isActive 控制透明度与缩放实现淡入淡出过渡；底部叠加标题与标签。
 */
function CarouselSlide({ photo, isActive, onClick }: Omit<CarouselSlideProps, 'theme'>) {
  return (
    <div
      onClick={onClick}
      className={`absolute inset-0 transition-all duration-500 ease-in-out cursor-pointer ${
        isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
      }`}
    >
      <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-xl">
        <CachedImage
          src={photo.thumbnail_path}
          alt={photo.title}
          className="h-full w-full object-cover"
        />
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          <h2 className="text-2xl font-bold text-white mb-2 drop-shadow-lg" style={{ color: 'white' }}>{photo.title}</h2>
          <div className="flex gap-2">
            {photo.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-3 py-1 text-sm bg-white/20 backdrop-blur-md text-white/90 border border-white/30"
                style={{ color: 'rgba(255,255,255,0.9)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 照片轮播图组件
 * @returns 轮播图 JSX，加载中或无数据时显示占位
 */
export function PhotoCarousel() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { photos, isLoading } = usePhotos();
  // currentIndex：当前激活的幻灯片索引
  const [currentIndex, setCurrentIndex] = useState(0);
  // isAutoPlaying：是否处于自动播放状态，用户手动操作后暂停
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  const isDark = theme === 'dark';
  // 仅取前 5 张作为轮播图
  const carouselPhotos = photos.slice(0, 5);

  // 照片数量减少时（如刷新数据）钳制当前索引到有效范围
  useEffect(() => {
    if (currentIndex >= carouselPhotos.length && carouselPhotos.length > 0) {
      setCurrentIndex(carouselPhotos.length - 1);
    }
  }, [carouselPhotos.length, currentIndex]);

  // 自动播放定时器：每 4 秒切换下一张；卸载或暂停时清理
  useEffect(() => {
    if (!isAutoPlaying || carouselPhotos.length === 0) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % carouselPhotos.length);
    }, 4000);

    return () => clearInterval(timer);
  }, [isAutoPlaying, carouselPhotos.length]);

  /** 切换到上一张并暂停自动播放 */
  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + carouselPhotos.length) % carouselPhotos.length);
    setIsAutoPlaying(false);
  }, [carouselPhotos.length]);

  /** 切换到下一张并暂停自动播放 */
  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % carouselPhotos.length);
    setIsAutoPlaying(false);
  }, [carouselPhotos.length]);

  /** 跳转到指定索引并暂停自动播放 */
  const goToSlide = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsAutoPlaying(false);
  }, []);

  /** 点击幻灯片跳转到对应照片详情页 */
  const handleSlideClick = useCallback((photo: PhotoListItem) => {
    navigate(`/photos/${photo.id}`);
  }, [navigate]);

  if (isLoading || carouselPhotos.length === 0) {
    return (
      <div className="relative w-full px-4 py-8">
        <div className="relative mx-auto max-w-[1200px] h-[400px] md:h-[500px] flex items-center justify-center">
          <div className={`w-8 h-8 border-4 border-t-transparent rounded-full animate-spin ${
            isDark ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-blue-600'
          }`} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full px-4 py-8">
      <div className="relative mx-auto max-w-[1200px] h-[400px] md:h-[500px]">
        {carouselPhotos.map((photo, index) => (
          <CarouselSlide
            key={photo.id}
            photo={photo}
            isActive={index === currentIndex}
            onClick={() => handleSlideClick(photo)}
          />
        ))}

        <button
          onClick={(e) => {
            e.stopPropagation();
            goToPrev();
          }}
          className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full p-3 transition-all hover:scale-110 ${
            isDark
              ? 'glass-sm hover:bg-white/10 text-white'
              : 'bg-white/80 hover:bg-white text-gray-800 shadow-lg'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            goToNext();
          }}
          className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full p-3 transition-all hover:scale-110 ${
            isDark
              ? 'glass-sm hover:bg-white/10 text-white'
              : 'bg-white/80 hover:bg-white text-gray-800 shadow-lg'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="flex justify-center gap-3 mt-6">
        {carouselPhotos.map((_, index) => (
          <button
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              goToSlide(index);
            }}
            className={`transition-all duration-300 rounded-full ${
              index === currentIndex
                ? `${isDark ? 'w-8 h-3 bg-white/70' : 'w-8 h-3 bg-gray-800/70'}`
                : `${isDark ? 'w-3 h-3 bg-white/20 hover:bg-white/40' : 'w-3 h-3 bg-gray-400/30 hover:bg-gray-400/50'}`
            }`}
          />
        ))}
      </div>

      <div className="flex justify-center mt-4">
        <button
          onClick={() => setIsAutoPlaying(!isAutoPlaying)}
          className={`text-sm flex items-center gap-2 transition-colors ${
            isDark
              ? 'text-slate-400 hover:text-slate-200'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {isAutoPlaying ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
              自动播放中
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              点击恢复自动播放
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default PhotoCarousel;