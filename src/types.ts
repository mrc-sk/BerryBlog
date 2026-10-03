export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_TAGLINE: string;
  AUTHOR_NAME: string;
  AUTHOR_BIO: string;
  AUTHOR_AVATAR: string;
  GITHUB_URL: string;
  X_URL: string;
  EMAIL: string;
  COMMENT_ENABLED: string;
  ITEMS_PER_PAGE: string;
}

export interface Post {
  id: number;
  slug: string;
  title: string;
  summary: string;
  content: string;
  html: string;
  cover: string;
  status: 'draft' | 'published';
  is_top: number;
  views: number;
  word_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface Download {
  id: number;
  title: string;
  summary: string;
  platform: string;
  version: string;
  size: string;
  url: string;
  is_featured: number;
  sort_order: number;
  downloads: number;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  post_id: number;
  parent_id: number | null;
  author: string;
  email: string;
  url: string;
  body: string;
  status: 'pending' | 'approved' | 'spam';
  created_at: string;
}

export interface SessionUser {
  id: number;
  username: string;
  token: string;
}

export interface SiteConfig {
  siteName: string;
  tagline: string;
  authorName: string;
  authorBio: string;
  authorAvatar: string;
  githubUrl: string;
  xUrl: string;
  email: string;
  commentEnabled: boolean;
  itemsPerPage: number;
  about: string;
  footerNote: string;
}