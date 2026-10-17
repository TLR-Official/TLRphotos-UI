/**
 * @file 新闻详情页（V4.0.0）
 * @description
 *  公开新闻详情（/news/:id 路由）：
 *   - 标题/作者/日期 + Markdown 正文（react-markdown 渲染，白底黑字浅色样式）；
 *   - 配图展示（后端代理 URL，点击新窗口打开，从简）；
 *   - 页脚显著版权行：直接展示后端拼好的 copyright_notice
 *     （`@{作者名} ©TLRphotos {年} 版权所有`）。
 *  正文复用既有 GET /api/articles/:id/content 端点读取 Markdown 文件。
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { getNewsDetail } from '../../api/news';
import { getArticleContent } from '../../api/articles';
import type { NewsDetail } from '../../api/news';
import { CachedImage } from '../../components/CachedImage';

/**
 * 格式化新闻日期为中文日期（不含时分秒）
 * @param iso ISO 时间字符串
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * 新闻详情页组件
 * @returns 详情页 JSX，含不存在态、加载态与完整视图
 */
export function NewsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<NewsDetail | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  // 新闻不存在或加载失败
  const [notFound, setNotFound] = useState(false);

  // 拉取新闻详情后，再读取 Markdown 正文
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      const result = await getNewsDetail(id || '');
      if (cancelled) return;
      if (result.success && result.data) {
        setDetail(result.data);
        const contentResult = await getArticleContent(id || '');
        if (cancelled) return;
        setContent(
          contentResult.success && typeof contentResult.data === 'string'
            ? contentResult.data
            : '正文加载失败，请稍后重试。'
        );
      } else {
        setNotFound(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 新闻不存在态
  if (notFound) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">新闻不存在</h1>
          <button
            onClick={() => navigate('/news')}
            className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            返回新闻列表
          </button>
        </div>
      </div>
    );
  }

  // 首屏加载态
  if (loading || !detail) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-gray-500">
        加载中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* 面包屑返回 */}
        <button
          onClick={() => navigate('/news')}
          className="flex items-center gap-1.5 mb-6 text-sm text-gray-600 hover:text-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回新闻列表
        </button>

        {/* 标题与元信息 */}
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug">{detail.title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
          <span>作者：{detail.author_name}</span>
          <span>{formatDate(detail.created_at)}</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">航空</span>
        </div>

        {/* Markdown 正文 */}
        <article className="prose prose-lg max-w-none mt-8">
          <ReactMarkdown
            rehypePlugins={[rehypeSanitize]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-2xl font-bold mt-8 mb-4 text-gray-900">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-900">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg font-medium mt-5 mb-2 text-gray-900">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="my-4 leading-relaxed text-gray-700">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="my-4 list-disc list-inside space-y-2 text-gray-700">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-4 list-decimal list-inside space-y-2 text-gray-700">{children}</ol>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-4 pl-4 border-l-4 border-blue-200 text-gray-600 bg-blue-50 rounded-r-lg">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:text-blue-800 underline"
                >
                  {children}
                </a>
              ),
              img: ({ src, alt }) => (
                <img src={src} alt={alt} className="my-4 rounded-lg max-w-full h-auto" />
              ),
              strong: ({ children }) => (
                <strong className="font-bold text-gray-900">{children}</strong>
              ),
              hr: () => <hr className="my-8 border-0 h-px bg-gray-200" />,
            }}
          >
            {content}
          </ReactMarkdown>
        </article>

        {/* 配图展示（点击新窗口打开原图代理 URL） */}
        {detail.images.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-gray-900 mb-4">新闻配图（{detail.images.length} 张）</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {detail.images.map((img) => {
                const url = img.preview_url || img.thumbnail_url;
                if (!url) return null;
                return (
                  <a
                    key={img.photo_id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl overflow-hidden border border-gray-200 bg-gray-50 hover:border-blue-300 transition-colors"
                    title={img.title || '查看大图'}
                  >
                    <CachedImage
                      src={url}
                      alt={img.title || '新闻配图'}
                      className="w-full aspect-[4/3] object-cover"
                    />
                    {img.title && (
                      <p className="px-3 py-2 text-xs text-gray-600 truncate">{img.title}</p>
                    )}
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* 页脚显著版权行（后端拼好：@作者名 ©TLRphotos {年} 版权所有） */}
        <div className="mt-10 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-sm font-bold text-blue-800 text-center tracking-wide">
            {detail.copyright_notice}
          </p>
        </div>
      </div>
    </div>
  );
}
