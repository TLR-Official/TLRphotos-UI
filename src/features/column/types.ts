export interface Article {
  id: string;
  title: string;
  excerpt: string;
  content_path: string;
  cover_image?: string;
  author: string;
  published_at: string;
  read_count: number;
  like_count: number;
  comment_count: number;
  tags: string[];
}

export interface Column {
  id: string;
  name: string;
  description: string;
  cover_image?: string;
  articles: Article[];
}
