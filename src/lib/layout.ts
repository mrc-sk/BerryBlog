import type { SiteConfig } from '../types';
import { html } from '../lib/utils';

export interface LayoutOpts {
  env: SiteConfig;
  title?: string;
  description?: string;
  path: string;
  body: string;
  canonical?: string;
  ogType?: string;
  noindex?: boolean;
  extraHead?: string;
  extraScript?: string;
}

export function siteOrigin(req: { url?: string }): string {
  return new URL(req.url || 'https://example.com').origin;
}

export function layout(o: LayoutOpts): string {
  const site = o.env;
  const fullTitle = o.title ? `${o.title} · ${site.siteName}` : `${site.siteName} · ${site.tagline || 'Blog'}`;
  const desc = o.description || site.tagline || '';
  const canonical = o.canonical || o.path;
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${html(fullTitle)}</title>
<meta name="description" content="${html(desc)}">
${o.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="canonical" href="${html(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${html(site.siteName)}" href="/rss.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${html(fullTitle)}">
<meta property="og:description" content="${html(desc)}">
<meta property="og:type" content="${html(o.ogType || 'website')}">
<meta property="og:url" content="${html(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
<link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/manifest.webmanifest">
<script src="/theme-init.js"></script>
${o.extraHead || ''}
</head>
<body data-path="${html(o.path)}">
<a class="skip-link" href="#main">跳到正文</a>
<button class="theme-toggle" id="themeToggle" aria-label="切换深浅色" title="切换深浅色">
  <svg class="ico-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  <svg class="ico-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
</button>

<div class="progress" id="progress"></div>

<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">
      <span class="brand-mark">${html(site.siteName.slice(0, 1).toUpperCase())}</span>
      <span class="brand-text">
        <strong>${html(site.siteName)}</strong>
        ${site.tagline ? `<em>${html(site.tagline)}</em>` : ''}
      </span>
    </a>
    <nav class="nav" aria-label="主导航">
      <a href="/" class="${isActive(o.path, '/')}">首页</a>
      <a href="/archive" class="${isActive(o.path, '/archive')}">归档</a>
      <a href="/tags" class="${isActive(o.path, '/tags')}">标签</a>
      <a href="/downloads" class="${isActive(o.path, '/downloads')}">下载</a>
      <a href="/about" class="${isActive(o.path, '/about')}">关于</a>
      <a href="/rss.xml" class="nav-rss" title="RSS 订阅">RSS</a>
      <button class="nav-search" id="navSearch" aria-label="搜索" title="搜索 (/)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      </button>
    </nav>
  </div>
</header>

<div class="search-panel" id="searchPanel" hidden>
  <form class="wrap" action="/search" method="get" role="search">
    <input type="search" name="q" placeholder="搜索文章标题或内容…" autocomplete="off" id="searchInput">
    <kbd>/</kbd>
  </form>
</div>

<main id="main">${o.body}</main>

<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-col">
      <strong>${html(site.siteName)}</strong>
      <p>${html(site.tagline || site.authorBio || '')}</p>
    </div>
    <div class="footer-col">
      <strong>导航</strong>
      <a href="/">首页</a> <a href="/archive">归档</a> <a href="/tags">标签</a> <a href="/downloads">下载</a> <a href="/about">关于</a> <a href="/rss.xml">RSS</a>
    </div>
    <div class="footer-col">
      <strong>联系</strong>
      ${site.githubUrl ? `<a href="${html(site.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ''}
      ${site.xUrl ? `<a href="${html(site.xUrl)}" target="_blank" rel="noopener noreferrer">X / Twitter</a>` : ''}
      ${site.email ? `<a href="mailto:${html(site.email)}">${html(site.email)}</a>` : ''}
      ${!site.githubUrl && !site.xUrl && !site.email ? '<span class="muted">暂未公开</span>' : ''}
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>© ${year} ${html(site.siteName)}</span>
    ${site.footerNote ? `<span class="muted">${html(site.footerNote)}</span>` : ''}
  </div>
</footer>

<script src="/dot-motion.js?v=2" defer></script>
<script src="/app.js" defer></script>
${o.extraScript ? `<script>${o.extraScript}</script>` : ''}
</body>
</html>`;
}

function isActive(path: string, target: string): string {
  return path === target || path.startsWith(target + '?') ? 'active' : '';
}

/** 分页组件 */
export function pager(
  current: number,
  pages: number,
  urlFn: (p: number) => string
): string {
  if (pages <= 1) return '';
  const items: string[] = [];
  const add = (p: number, label: string, cls = '') => {
    items.push(`<a href="${html(urlFn(p))}" class="page ${cls}">${label}</a>`);
  };
  add(current - 1, '上一页', current === 1 ? 'disabled' : '');

  const set = new Set<number>([1, pages, current, current - 1, current + 1]);
  const list = Array.from(set).filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  let last = 0;
  for (const p of list) {
    if (p - last > 1) items.push('<span class="page gap">…</span>');
    add(p, String(p), p === current ? 'active' : '');
    last = p;
  }
  add(current + 1, '下一页', current === pages ? 'disabled' : '');
  return `<nav class="pager" aria-label="分页">${items.join('')}</nav>`;
}

/** 文章卡片 */
export function postCard(p: {
  title: string;
  slug: string;
  summary: string;
  cover: string;
  published_at: string | null;
  views: number;
  word_count: number;
  tags?: { name: string; slug: string }[];
}, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    return `<article class="post-row">
      <time class="post-date" datetime="${html(p.published_at || '')}">${html((p.published_at || '').slice(0, 10))}</time>
      <a class="post-title" href="/p/${html(p.slug)}">${html(p.title)}</a>
      <span class="post-views">${p.views} 阅读</span>
    </article>`;
  }
  const tags = (p.tags || []).map((t) => `<a class="chip" href="/tag/${html(t.slug)}">#${html(t.name)}</a>`).join('');
  return `<article class="post-card">
    ${p.cover ? `<a class="post-cover img-wrap" data-img-load="1" href="/p/${html(p.slug)}"><dot-motion-loader class="img-ph" data-dot-motion-tag="dml-cover" aria-hidden="true"></dot-motion-loader><img src="${html(p.cover)}" alt="" loading="lazy"></a>` : ''}
    <div class="post-body">
      <h2 class="post-title"><a href="/p/${html(p.slug)}">${html(p.title)}</a></h2>
      <p class="post-summary">${html(p.summary)}</p>
      <div class="post-meta">
        <time datetime="${html(p.published_at || '')}">${html((p.published_at || '').slice(0, 10))}</time>
        <span>·</span><span>${p.word_count} 字</span>
        <span>·</span><span>${p.views} 阅读</span>
        <span class="post-tags">${tags}</span>
      </div>
    </div>
  </article>`;
}

export function emptyState(text: string, hint = ''): string {
  return `<div class="empty">
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 5h16v14H4z"/><path d="M4 8h16M8 12h8M8 15h5"/></svg>
    <p>${html(text)}</p>
    ${hint ? `<p class="muted">${html(hint)}</p>` : ''}
  </div>`;
}

export function pageHeader(title: string, sub = ''): string {
  return `<header class="page-head wrap">
    <h1>${html(title)}</h1>
    ${sub ? `<p>${html(sub)}</p>` : ''}
  </header>`;
}