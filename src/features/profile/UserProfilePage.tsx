import { useParams, useNavigate } from 'react-router-dom';
import { getPublicUser, getUserPhotos } from '../../api/photos';
import { useTheme } from '../../shared/ThemeContext';
import { useState, useEffect } from 'react';
import type { PublicUser } from '../../api/photos';
import type { PhotoListItem } from '../gallery/types';
import { formatDate } from '../../shared/utils';

export function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!userId) {
      navigate('/gallery');
      return;
    }

    Promise.all([
      getPublicUser(userId),
      getUserPhotos(userId, currentPage),
    ]).then(([userResult, photosResult]) => {
      if (userResult.success && userResult.data) {
        setUser(userResult.data);
      }
      if (photosResult.success && photosResult.data) {
        setPhotos(photosResult.data.photos);
        setTotal(photosResult.data.total);
      }
      setIsLoading(false);
    });
  }, [userId, currentPage, navigate]);

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className={`w-8 h-8 border-4 border-t-transparent rounded-full animate-spin ${
          theme === 'dark' ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-blue-600'
        }`} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-4 theme-text-transition ${
            theme === 'dark' ? 'text-white' : 'text-gray-800'
          }`}>用户不存在</h1>
          <button
            onClick={() => navigate('/gallery')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回作品集
          </button>
        </div>
      </div>
    );
  }

  const handlePhotoClick = (photoId: string) => {
    navigate(`/photos/${photoId}`);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <main className="py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate('/gallery');
          }}
          className={`flex items-center gap-2 mb-6 transition-colors theme-text-transition ${
            theme === 'dark'
              ? 'text-slate-300 hover:text-white'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回作品集
        </button>

        <div className={`rounded-2xl shadow-xl overflow-hidden mb-8 theme-bg-transition ${
          theme === 'dark' ? 'glass' : 'bg-white'
        }`}>
          <div className="p-8">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className={`w-32 h-32 rounded-full overflow-hidden flex-shrink-0 ${
                user.avatar_url
                  ? ''
                  : 'bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center'
              }`}>
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url.startsWith('/') ? `/api${user.avatar_url}` : user.avatar_url}
                    alt={user.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 text-center md:text-left">
                <h1 className={`text-3xl font-bold mb-2 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>{user.username}</h1>
                {user.bio && (
                  <p className={`mb-4 ${
                    theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
                  }`}>{user.bio}</p>
                )}
                <div className="flex flex-wrap justify-center md:justify-start gap-4">
                  {user.location && (
                    <div className={`flex items-center gap-2 ${
                      theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
                    }`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {user.location}
                    </div>
                  )}
                  {user.website && (
                    <a
                      href={user.website.startsWith('http') ? user.website : `https://${user.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-2 ${
                        theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                      网站
                    </a>
                  )}
                  {user.created_at && (
                    <div className={`flex items-center gap-2 ${
                      theme === 'dark' ? 'text-slate-400' : 'text-gray-600'
                    }`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {formatDate(user.created_at)} 加入
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-xl shadow-lg p-6 mb-6 theme-bg-transition ${
          theme === 'dark' ? 'glass' : 'bg-white'
        }`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-xl font-bold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>作品 ({total})</h2>
          </div>
        </div>

        {photos.length === 0 ? (
          <div className={`rounded-xl shadow-lg p-12 text-center theme-bg-transition ${
            theme === 'dark' ? 'glass' : 'bg-white'
          }`}>
            <svg className={`w-16 h-16 mx-auto mb-4 ${
              theme === 'dark' ? 'text-slate-600' : 'text-gray-300'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>暂无作品</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => handlePhotoClick(photo.id)}
                  className={`relative rounded-xl overflow-hidden shadow-md cursor-pointer hover:shadow-xl transition-all duration-300 group ${
                    theme === 'dark' ? 'bg-slate-800' : 'bg-white'
                  }`}
                >
                  <img
                    src={photo.thumbnail_path}
                    alt={photo.title}
                    className="w-full aspect-square object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                    <p className="text-white text-sm font-medium truncate">{photo.title}</p>
                    {photo.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {photo.tags.slice(0, 2).map((tag: string) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 bg-white/20 text-white text-xs rounded-full"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage === 1
                      ? theme === 'dark'
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : theme === 'dark'
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
                  }`}
                >
                  上一页
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                      page === currentPage
                        ? theme === 'dark'
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-600 text-white'
                        : theme === 'dark'
                          ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    currentPage === totalPages
                      ? theme === 'dark'
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : theme === 'dark'
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
                  }`}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}