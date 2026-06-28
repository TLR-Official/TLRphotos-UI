import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { PhotoCarousel } from './features/gallery/PhotoCarousel';
import { WaterfallGallery } from './features/gallery/WaterfallGallery';
import { PhotoDetailPage } from './features/gallery/PhotoDetailPage';
import { Header } from './shared/Header';
import { Footer } from './shared/Footer';
import { MouseFollowBackground } from './shared/MouseFollowBackground';

function HomePage() {
  return (
    <div className="relative min-h-screen page-dark">
      {/* 动态背景层 */}
      <MouseFollowBackground />

      {/* 内容层 */}
      <div className="relative z-10">
        <Header />

        <main>
          <section>
            <PhotoCarousel />
          </section>

          <section className="px-4 py-8">
            <WaterfallGallery />
          </section>
        </main>

        <Footer />
      </div>
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
