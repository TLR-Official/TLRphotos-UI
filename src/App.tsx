import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { PhotoCarousel } from './features/gallery/PhotoCarousel';
import { PhotoDetailPage } from './features/gallery/PhotoDetailPage';
import { GalleryPage } from './features/gallery/GalleryPage';
import { ColumnList } from './features/column/ColumnList';
import { ArticleDetailPage } from './features/column/ArticleDetailPage';
import { AuthPage } from './features/auth/AuthPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { UploadPage } from './features/upload/UploadPage';
import { Header } from './shared/Header';
import { Footer } from './shared/Footer';
import { MouseFollowBackground } from './shared/MouseFollowBackground';
import { ThemeProvider, useTheme } from './shared/ThemeContext';
import { PhotosProvider, usePhotos } from './shared/PhotosContext';
import { UserProvider } from './shared/UserContext';
import { useNavigate } from 'react-router-dom';
import type { PhotoListItem } from './features/gallery/types';

function App() {
  return (
    <ThemeProvider>
      <UserProvider>
        <PhotosProvider>
          <AppContent />
        </PhotosProvider>
      </UserProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const { theme } = useTheme();

  return (
    <div className={`relative min-h-screen theme-bg-transition ${
      theme === 'dark' ? 'page-dark' : 'page-light'
    }`}>
      <MouseFollowBackground />
      
      <Router>
        <div className="relative z-10 flex flex-col min-h-screen">
          <Header />
          
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePageContent />} />
              <Route path="/photos/:id" element={<PhotoDetailPage />} />
              <Route path="/articles/:id" element={<ArticleDetailPage />} />
              <Route path="/auth" element={<div className="px-4 py-8"><AuthPage /></div>} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
            </Routes>
          </main>
          
          <Footer />
        </div>
      </Router>
    </div>
  );
}

function HomePageContent() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { photos } = usePhotos();
  const isDark = theme === 'dark';
  const bottomPhotos = photos.slice(5, 9);

  const handlePhotoClick = (photoId: string) => {
    navigate(`/photos/${photoId}`);
  };

  return (
    <main className="px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <PhotoCarousel />
          </div>

          <div className="lg:col-span-4">
            <div className="h-full min-h-[500px]">
              <ColumnList />
            </div>
          </div>
        </div>

        <section className="mt-16">
          <h2 className={`text-xl font-semibold mb-8 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>精选作品</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {bottomPhotos.map((photo: PhotoListItem) => (
              <div
                key={photo.id}
                onClick={() => handlePhotoClick(photo.id)}
                className={`group cursor-pointer rounded-xl overflow-hidden shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl ${
                  isDark ? 'glass' : 'bg-white'
                }`}
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                </div>
                <div className="p-4">
                  <h3 className={`text-sm font-medium mb-2 truncate ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>
                    {photo.title}
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {photo.tags.slice(0, 2).map((tag: string) => (
                      <span
                        key={tag}
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          isDark
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
