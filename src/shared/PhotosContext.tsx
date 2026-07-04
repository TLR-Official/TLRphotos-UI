import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { PhotoListItem } from '../features/gallery/types';
import { mockPhotos } from '../features/gallery/mockData';

interface PhotosContextType {
  photos: PhotoListItem[];
  isLoading: boolean;
  error: string | null;
  refreshPhotos: () => void;
}

const PhotosContext = createContext<PhotosContextType | undefined>(undefined);

export function PhotosProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<PhotoListItem[]>(mockPhotos);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPhotos = useCallback(() => {
    setIsLoading(true);
    setError(null);
    
    setTimeout(() => {
      setPhotos(mockPhotos);
      setIsLoading(false);
    }, 300);
  }, []);

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
