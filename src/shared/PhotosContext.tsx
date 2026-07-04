import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { getPhotos } from '../api/photos';
import type { PhotoListItem } from '../features/gallery/types';

interface PhotosContextType {
  photos: PhotoListItem[];
  isLoading: boolean;
  error: string | null;
  refreshPhotos: () => void;
}

const PhotosContext = createContext<PhotosContextType | undefined>(undefined);

export function PhotosProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getPhotos();
      if (result.success && result.data) {
        setPhotos(result.data);
      } else {
        console.warn('API request failed, falling back to mock data');
      }
    } catch (err) {
      console.error('Load photos error:', err);
      setError('加载照片数据失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  return (
    <PhotosContext.Provider value={{ photos, isLoading, error, refreshPhotos: loadPhotos }}>
      {children}
    </PhotosContext.Provider>
  );
}

export function usePhotos() {
  const context = useContext(PhotosContext);
  if (!context) {
    throw new Error('usePhotos must be used within PhotosProvider');
  }
  return context;
}
