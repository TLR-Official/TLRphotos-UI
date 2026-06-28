import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PhotoListItem } from './types';
import { mockPhotos } from './mockData';

interface CarouselSlideProps {
  photo: PhotoListItem;
  isActive: boolean;
  onClick: () => void;
}

function CarouselSlide({ photo, isActive, onClick }: CarouselSlideProps) {
  return (
    <div
      onClick={onClick}
      className={`absolute inset-0 transition-all duration-500 ease-in-out cursor-pointer ${
        isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}
    >
      <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-2xl bg-gray-100">
        <img
          src={photo.thumbnail_path}
          alt={photo.title}
          className="h-full w-full object-cover"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6">
          <h2 className="text-2xl font-bold text-white mb-2">{photo.title}</h2>
          <div className="flex gap-2">
            {photo.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/20 px-3 py-1 text-sm text-white/90"
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

export function PhotoCarousel() {
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  const carouselPhotos = mockPhotos.slice(0, 5);

  useEffect(() => {
    if (!isAutoPlaying) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % carouselPhotos.length);
    }, 4000);

    return () => clearInterval(timer);
  }, [isAutoPlaying, carouselPhotos.length]);

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + carouselPhotos.length) % carouselPhotos.length);
    setIsAutoPlaying(false);
  }, [carouselPhotos.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % carouselPhotos.length);
    setIsAutoPlaying(false);
  }, [carouselPhotos.length]);

  const goToSlide = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsAutoPlaying(false);
  }, []);

  const handleSlideClick = useCallback((photo: PhotoListItem) => {
    navigate(`/photos/${photo.id}`);
  }, [navigate]);

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
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-white/80 hover:bg-white text-gray-800 rounded-full p-3 shadow-lg transition-all hover:scale-110"
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
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-white/80 hover:bg-white text-gray-800 rounded-full p-3 shadow-lg transition-all hover:scale-110"
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
            onClick={() => goToSlide(index)}
            className={`transition-all duration-300 ${
              index === currentIndex
                ? 'w-8 h-3 bg-gray-800 rounded-full'
                : 'w-3 h-3 bg-gray-300 rounded-full hover:bg-gray-400'
            }`}
          />
        ))}
      </div>

      <div className="flex justify-center mt-4">
        <button
          onClick={() => setIsAutoPlaying(!isAutoPlaying)}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-2"
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
