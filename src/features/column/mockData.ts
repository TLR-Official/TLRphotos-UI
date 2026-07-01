import type { Article, Column } from './types';

export const mockArticles: Article[] = [
  {
    id: 'article_001',
    title: 'Markdown 和 LaTeX 测试文章',
    excerpt: '本文包含了 Markdown 的所有主要语法和 LaTeX 的常用数学公式，用于验证渲染效果的完整性和正确性。',
    content_path: './articles/test-markdown-latex.md',
    cover_image: 'https://picsum.photos/seed/article1/400/300',
    author: 'TLR工作室',
    published_at: '2024-07-01T10:00:00Z',
    read_count: 1234,
    like_count: 89,
    comment_count: 23,
    tags: ['技术', 'Markdown', 'LaTeX'],
  },
  {
    id: 'article_002',
    title: '航拍摄影技巧入门',
    excerpt: '从设备选择到拍摄技巧，全面介绍航拍摄影的基础知识，帮助你拍出专业级的航拍作品。',
    content_path: './articles/test-markdown-latex.md',
    cover_image: 'https://picsum.photos/seed/article2/400/300',
    author: 'TLR工作室',
    published_at: '2024-06-25T14:30:00Z',
    read_count: 2345,
    like_count: 156,
    comment_count: 45,
    tags: ['摄影', '航拍', '技巧'],
  },
  {
    id: 'article_003',
    title: '无人机飞行安全指南',
    excerpt: '详细介绍无人机飞行的安全注意事项和法律法规，确保你的飞行既安全又合法。',
    content_path: './articles/test-markdown-latex.md',
    cover_image: 'https://picsum.photos/seed/article3/400/300',
    author: 'TLR工作室',
    published_at: '2024-06-20T09:15:00Z',
    read_count: 1876,
    like_count: 123,
    comment_count: 32,
    tags: ['安全', '无人机', '法规'],
  },
  {
    id: 'article_004',
    title: '后期修图技巧分享',
    excerpt: '掌握航拍照片的后期处理技巧，让你的作品更加出色，展现独特的视觉效果。',
    content_path: './articles/test-markdown-latex.md',
    cover_image: 'https://picsum.photos/seed/article4/400/300',
    author: 'TLR工作室',
    published_at: '2024-06-15T16:45:00Z',
    read_count: 3456,
    like_count: 234,
    comment_count: 67,
    tags: ['后期', '修图', '技巧'],
  },
  {
    id: 'article_005',
    title: '优秀航拍作品赏析',
    excerpt: '精选国内外优秀航拍作品，分析其构图、光线和色彩运用，提升你的审美水平。',
    content_path: './articles/test-markdown-latex.md',
    cover_image: 'https://picsum.photos/seed/article5/400/300',
    author: 'TLR工作室',
    published_at: '2024-06-10T11:20:00Z',
    read_count: 4567,
    like_count: 345,
    comment_count: 89,
    tags: ['赏析', '作品', '灵感'],
  },
];

export const mockColumn: Column = {
  id: 'column_001',
  name: '航拍技术专栏',
  description: '探索航拍世界，分享专业技巧，记录精彩瞬间',
  cover_image: 'https://picsum.photos/seed/column/600/400',
  articles: mockArticles,
};

export function getArticleById(id: string): Article | undefined {
  return mockArticles.find((article) => article.id === id);
}
