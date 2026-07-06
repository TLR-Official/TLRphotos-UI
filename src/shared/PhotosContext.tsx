import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { getPhotos } from '../api/photos';
import type { PhotoListItem } from '../features/gallery/types';

interface PhotosContextType {
  photos: PhotoListItem[];
  isLoading: boolean;
  refreshPhotos: () => void;
}

const PhotosContext = createContext<PhotosContextType | undefined>(undefined);

export function PhotosProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    const result = await getPhotos();
    if (result.success && result.data) {
      setPhotos(result.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  return (
    <PhotosContext.Provider value={{ photos, isLoading, refreshPhotos: loadPhotos }}>
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
