import { useNavigate } from 'react-router-dom';
import { getArticles, getColumn } from '../../api/articles';
import { useTheme } from '../../shared/ThemeContext';
import { useState, useEffect } from 'react';
import type { Article, Column } from './types';
import { formatShortDate } from '../../shared/utils';

export function ColumnList() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [articles, setArticles] = useState<Article[]>([]);
  const [column, setColumn] = useState<Column | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [articlesResult, columnResult] = await Promise.all([
          getArticles(),
          getColumn(),
        ]);
        
        if (isMounted) {
          if (articlesResult.success && articlesResult.data) {
            setArticles(articlesResult.data.slice(0, 5));
          } else {
            console.warn('Failed to load articles, using mock data');
          }
          
          if (columnResult.success && columnResult.data) {
            setColumn(columnResult.data);
          } else {
            console.warn('Failed to load column, using default');
          }
        }
      } catch (error) {
        console.error('ColumnList load error:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    
    return () => {
      isMounted = false;
    };
  }, []);

  const handleArticleClick = (articleId: string) => {
    navigate(`/articles/${articleId}`);
  };

  return (
    <div className={`h-full rounded-2xl shadow-lg overflow-hidden flex flex-col theme-bg-transition ${
      isDark ? 'glass' : 'bg-white'
    }`}>
      <div className="p-4 border-b border-white/10">
        <h3 className={`text-lg font-semibold mb-1 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>{column?.name || '专栏'}</h3>
        <p className={`text-sm ${
          isDark ? 'text-slate-400' : 'text-gray-500'
        }`}>{column?.description || ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 flex flex-col items-center justify-center">
            <div className={`w-6 h-6 border-3 border-t-transparent rounded-full animate-spin ${
              isDark ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-blue-600'
            }`} />
            <p className={`mt-3 text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>加载中...</p>
          </div>
        ) : articles.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center">
            <svg className={`w-10 h-10 mb-3 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>暂无文章</p>
          </div>
        ) : (
          <>
            {articles.map((article, index) => (
              <div
                key={article.id}
                onClick={() => handleArticleClick(article.id)}
                className={`p-4 cursor-pointer transition-all duration-300 hover:bg-white/5 border-b border-white/5 last:border-b-0 ${
                  index === 0 ? 'bg-white/5' : ''
                }`}
              >
                <div className="flex gap-3">
                  <div className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden ${
                    isDark ? 'bg-white/10' : 'bg-gray-100'
                  }`}>
                    {article.cover_image ? (
                      <img
                        src={article.cover_image}
                        alt={article.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${
                        isDark ? 'text-slate-500' : 'text-gray-400'
                      }`}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium mb-1 truncate ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {article.title}
                    </h4>
                    <p className={`text-xs truncate mb-2 ${
                      isDark ? 'text-slate-400' : 'text-gray-500'
                    }`}>
                      {article.excerpt}
                    </p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`${
                        isDark ? 'text-slate-500' : 'text-gray-400'
                      }`}>
                        {formatShortDate(article.published_at)}
                      </span>
                      <span className={`flex items-center gap-1 ${
                        isDark ? 'text-slate-500' : 'text-gray-400'
                      }`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        {article.read_count}
                      </span>
                      <span className={`flex items-center gap-1 ${
                        isDark ? 'text-slate-500' : 'text-gray-400'
                      }`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        {article.like_count}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="p-4 border-t border-white/10">
        <button
          onClick={() => navigate('/articles/article_001')}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80 ${
            isDark
              ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}
        >
          查看全部文章 →
        </button>
      </div>
    </div>
  );
}