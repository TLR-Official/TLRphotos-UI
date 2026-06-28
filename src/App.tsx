import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { PhotoCarousel } from './features/gallery/PhotoCarousel';
import { mockPhotos } from './features/gallery/mockData';
import { PhotoDetailPage } from './features/gallery/PhotoDetailPage';
import { Header } from './shared/Header';
import { Footer } from './shared/Footer';
import { useNavigate } from 'react-router-dom';

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main>
        <section className="bg-gray-100">
          <PhotoCarousel />
        </section>

        <section className="px-4 py-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">全部作品</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 max-w-[1600px] mx-auto">
            {mockPhotos.map((photo) => (
              <div
                key={photo.id}
                onClick={() => navigate(`/photos/${photo.id}`)}
                className="group relative aspect-square rounded-lg overflow-hidden shadow-md bg-gray-100 cursor-pointer"
              >
                <img
                  src={photo.thumbnail_path}
                  alt={photo.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{photo.title}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/photos/:id" element={<PhotoDetailPage />} />
      </Routes>
    </Router>
  );
}

export default App;
