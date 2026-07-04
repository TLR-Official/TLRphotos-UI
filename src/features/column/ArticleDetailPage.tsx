import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import 'katex/dist/katex.min.css';
import { getArticleById, getArticleContent, getComments, createComment, likeArticle, unlikeArticle } from '../../api/articles';
import { Header } from '../../shared/Header';
import { Footer } from '../../shared/Footer';
import { TimeBasedBackground } from '../../shared/TimeBasedBackground';
import { useTheme } from '../../shared/ThemeContext';
import type { Article, Comment } from '../../api/articles';
import { formatDate, formatRelativeDate } from '../../shared/utils';

export function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    getArticleById(id || '').then((result) => {
      if (result.success && result.data) {
        setArticle(result.data);
        setLikeCount(result.data.like_count);
        setCommentCount(result.data.comment_count);

        getArticleContent(result.data.content_path, abortController.signal).then((contentResult) => {
          if (contentResult.success && contentResult.data) {
            setContent(contentResult.data);
          } else {
            setContent('# 文章加载失败\n\n无法加载文章内容，请稍后重试。');
          }
          setIsLoading(false);
        });

        getComments(result.data.id).then((commentsResult) => {
          if (commentsResult.success && commentsResult.data) {
            setComments(commentsResult.data);
          }
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      abortController.abort();
    };
  }, [id]);

  const handleLike = async () => {
    if (!article) return;
    if (isLiked) {
      const result = await unlikeArticle(article.id);
      if (result.success && result.data) {
        setLikeCount(result.data.like_count);
      } else {
        setLikeCount((prev) => prev - 1);
      }
      setIsLiked(false);
    } else {
      const result = await likeArticle(article.id);
      if (result.success && result.data) {
        setLikeCount(result.data.like_count);
      } else {
        setLikeCount((prev) => prev + 1);
      }
      setIsLiked(true);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmitting || !article) return;

    setIsSubmitting(true);
    const result = await createComment(article.id, newComment.trim());
    
    if (result.success && result.data) {
      const newCommentData = result.data;
      setComments((prev) => [newCommentData, ...prev]);
      setCommentCount((prev) => prev + 1);
      setNewComment('');
    }
    setIsSubmitting(false);
  };

  if (!article) {
    return (
      <div className={`min-h-screen flex items-center justify-center theme-bg-transition ${
        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
      }`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-4 theme-text-transition ${
            theme === 'dark' ? 'text-white' : 'text-gray-800'
          }`}>文章不存在</h1>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const isDark = theme === 'dark';

  return (
    <div className={`relative min-h-screen theme-bg-transition ${
      theme === 'dark' ? 'page-dark' : 'page-light'
    }`}>
      <TimeBasedBackground />

      <div className="relative z-10">
        <Header />

        <main className="py-8 px-4">
          <div className="max-w-4xl mx-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/');
              }}
              className={`flex items-center gap-2 mb-6 transition-colors theme-text-transition ${
                isDark
                  ? 'text-slate-300 hover:text-white'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回首页
            </button>

            <div className={`rounded-2xl shadow-lg p-6 md:p-8 mb-6 theme-bg-transition ${
              isDark ? 'glass' : 'bg-white'
            }`}>
              <div className="mb-6">
                <h1 className={`text-2xl md:text-3xl font-bold mb-4 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {article.title}
                </h1>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className={`${
                    isDark ? 'text-slate-400' : 'text-gray-600'
                  }`}>
                    作者：{article.author}
                  </span>
                  <span className={`${
                    isDark ? 'text-slate-400' : 'text-gray-600'
                  }`}>
                    发布于：{formatDate(article.published_at)}
                  </span>
                </div>
              </div>

              <div className="flex gap-8 mb-6">
                <div className="flex items-center gap-2 cursor-pointer hover:scale-105 transition-transform">
                  <svg className={`w-5 h-5 ${
                    isDark ? 'text-slate-400' : 'text-gray-500'
                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span className={`text-lg font-bold ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>
                    {article.read_count.toLocaleString()}
                  </span>
                  <span className={`text-sm ${
                    isDark ? 'text-slate-400' : 'text-gray-500'
                  }`}>阅读</span>
                </div>

                <div
                  onClick={handleLike}
                  className={`flex items-center gap-2 cursor-pointer hover:scale-105 transition-transform ${
                    isLiked ? 'text-red-500' : ''
                  }`}
                >
                  <svg className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  <span className={`text-lg font-bold ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>
                    {likeCount}
                  </span>
                  <span className={`text-sm ${
                    isDark ? 'text-slate-400' : 'text-gray-500'
                  }`}>点赞</span>
                </div>

                <div className="flex items-center gap-2 cursor-pointer hover:scale-105 transition-transform">
                  <svg className={`w-5 h-5 ${
                    isDark ? 'text-slate-400' : 'text-gray-500'
                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <span className={`text-lg font-bold ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>
                    {commentCount}
                  </span>
                  <span className={`text-sm ${
                    isDark ? 'text-slate-400' : 'text-gray-500'
                  }`}>评论</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {article.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
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

            <div className={`rounded-2xl shadow-lg p-6 md:p-8 theme-bg-transition ${
              isDark ? 'glass' : 'bg-white'
            }`}>
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className={`w-8 h-8 border-4 border-t-transparent rounded-full animate-spin ${
                    isDark ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-blue-600'
                  }`} />
                </div>
              ) : (
                <article className={`prose prose-lg max-w-none ${
                  isDark ? 'prose-invert' : ''
                }`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeSanitize]}
                    components={{
                      h1: ({ children }) => (
                        <h1 className={`text-2xl md:text-3xl font-bold mt-8 mb-4 ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}>
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className={`text-xl md:text-2xl font-semibold mt-6 mb-3 ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}>
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className={`text-lg font-medium mt-5 mb-2 ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}>
                          {children}
                        </h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className={`text-base font-medium mt-4 mb-2 ${
                          isDark ? 'text-slate-200' : 'text-gray-800'
                        }`}>
                          {children}
                        </h4>
                      ),
                      p: ({ children }) => (
                        <p className={`my-4 leading-relaxed ${
                          isDark ? 'text-slate-300' : 'text-gray-700'
                        }`}>
                          {children}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className={`my-4 list-disc list-inside space-y-2 ${
                          isDark ? 'text-slate-300' : 'text-gray-700'
                        }`}>
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className={`my-4 list-decimal list-inside space-y-2 ${
                          isDark ? 'text-slate-300' : 'text-gray-700'
                        }`}>
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className="leading-relaxed">{children}</li>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className={`my-4 pl-4 border-l-4 italic ${
                          isDark
                            ? 'border-blue-500/50 text-slate-400 bg-blue-500/5'
                            : 'border-blue-200 text-gray-600 bg-blue-50'
                        }`}>
                          {children}
                        </blockquote>
                      ),
                      code: ({ className, children }) => {
                        const isBlockCode = className?.includes('language-');
                        if (isBlockCode) {
                          return (
                            <pre className={`my-4 p-4 rounded-lg overflow-x-auto ${
                              isDark ? 'bg-gray-800' : 'bg-gray-100'
                            }`}>
                              <code className={`text-sm ${
                                isDark ? 'text-slate-200' : 'text-gray-800'
                              }`}>
                                {children}
                              </code>
                            </pre>
                          );
                        }
                        return (
                          <code className={`px-2 py-1 rounded text-sm ${
                            isDark ? 'bg-gray-800 text-slate-200' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {children}
                          </code>
                        );
                      },
                      table: ({ children }) => (
                        <div className="my-4 overflow-x-auto">
                          <table className={`w-full border-collapse ${
                            isDark ? 'text-slate-300' : 'text-gray-700'
                          }`}>
                            {children}
                          </table>
                        </div>
                      ),
                      th: ({ children }) => (
                        <th className={`px-4 py-2 border text-left font-medium ${
                          isDark
                            ? 'border-gray-700 bg-gray-800 text-white'
                            : 'border-gray-200 bg-gray-50 text-gray-900'
                        }`}>
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className={`px-4 py-2 border ${
                          isDark ? 'border-gray-700' : 'border-gray-200'
                        }`}>
                          {children}
                        </td>
                      ),
                      hr: () => (
                        <hr className={`my-8 border-0 h-px ${
                          isDark ? 'bg-gray-700' : 'bg-gray-200'
                        }`} />
                      ),
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-blue-500 hover:text-blue-600 underline ${
                            isDark ? 'hover:text-blue-400' : ''
                          }`}
                        >
                          {children}
                        </a>
                      ),
                      img: ({ src, alt }) => (
                        <img
                          src={src}
                          alt={alt}
                          className="my-4 rounded-lg max-w-full h-auto"
                        />
                      ),
                      strong: ({ children }) => (
                        <strong className={`font-bold ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}>
                          {children}
                        </strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic">{children}</em>
                      ),
                      del: ({ children }) => (
                        <del className="line-through">{children}</del>
                      ),
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </article>
              )}
            </div>

            <div className={`mt-6 flex gap-4 ${
              isDark ? 'text-slate-300' : 'text-gray-600'
            }`}>
              <button
                onClick={handleLike}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all hover:scale-105 ${
                  isDark
                    ? `${isLiked ? 'bg-red-500/20 text-red-400' : 'bg-white/10 hover:bg-white/20'}`
                    : `${isLiked ? 'bg-red-50 text-red-600' : 'bg-gray-100 hover:bg-gray-200'}`
                }`}
              >
                <svg className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {isLiked ? '已点赞' : '点赞'}
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all hover:scale-105 ${
                  isDark
                    ? 'bg-white/10 hover:bg-white/20'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                分享
              </button>
            </div>

            <div className={`mt-8 rounded-2xl shadow-lg p-6 theme-bg-transition ${
              isDark ? 'glass' : 'bg-white'
            }`}>
              <h3 className={`text-lg font-semibold mb-4 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}>
                评论 ({commentCount})
              </h3>

              <form onSubmit={handleSubmitComment} className="mb-6">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="写下你的评论..."
                    className={`flex-1 px-4 py-3 rounded-xl border outline-none transition-all ${
                      isDark
                        ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-blue-500/50'
                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !newComment.trim()}
                    className={`px-6 py-3 rounded-xl font-medium transition-all ${
                      isSubmitting || !newComment.trim()
                        ? isDark
                          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : isDark
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isSubmitting ? '发送中...' : '发送'}
                  </button>
                </div>
              </form>

              <div className="space-y-4">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={`p-4 rounded-xl ${
                      isDark ? 'bg-white/5' : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isDark ? 'bg-blue-500/30' : 'bg-blue-100'
                      }`}>
                        <svg className={`w-4 h-4 ${
                          isDark ? 'text-blue-400' : 'text-blue-600'
                        }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <div>
                        <span className={`font-medium text-sm ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}>
                          {comment.author}
                        </span>
                        <span className={`text-xs ml-2 ${
                          isDark ? 'text-slate-500' : 'text-gray-400'
                        }`}>
                          {formatRelativeDate(comment.created_at)}
                        </span>
                      </div>
                    </div>
                    <p className={`text-sm ${
                      isDark ? 'text-slate-300' : 'text-gray-700'
                    }`}>
                      {comment.content}
                    </p>
                  </div>
                ))}
              </div>

              {comments.length === 0 && (
                <div className={`text-center py-8 ${
                  isDark ? 'text-slate-500' : 'text-gray-400'
                }`}>
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <p>暂无评论，快来发表第一条评论吧！</p>
                </div>
              )}
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
