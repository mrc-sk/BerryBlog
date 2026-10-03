import { Hono } from 'hono';
import type { Env } from '../types';
import {
  archiveGroups,
  allTags,
  countPublished,
  getNeighbours,
  getPostBySlug,
  getPublishedPosts,
  getSiteConfig,
  incrementViews,
  listDownloads,
  recordDownload,
} from '../lib/db';
import { emptyState, layout, pageHeader, pager, postCard, siteOrigin } from '../lib/layout';
import { excerpt, fmtDate, getClientIp, html, pageUrl, paginate, slugify } from '../lib/utils';
import { ipHash, timingSafeEqual } from '../lib/crypto';
import { checkCsrf, csrfCookie, ensureCsrfToken, rateLimit, readCookie } from '../lib/auth';

export const publicRoutes = new Hono<{ Bindings: Env; Variables: { csrf: string } }>();

/* 为每个请求准备 CSRF token（评论表单用），并种下 cookie */
publicRoutes.use('*', async (c, next) => {
  const token = ensureCsrfToken(c.req.raw);
  c.set('csrf', token);
  if (!c.req.raw.headers.get('cookie')?.includes('nb_csrf=')) {
    c.header('Set-Cookie', csrfCookie(token), { append: true });
  }
  await next();
});

/* ------------------------------------------------------------- 首页 */
publicRoutes.get('/', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const page = parseInt(c.req.query('page') || '1', 10) || 1;
  const total = await countPublished(env);
  const pg = paginate(total, page, site.itemsPerPage);
  const posts = await getPublishedPosts(env, { limit: pg.perPage, offset: pg.offset });
  const [tags, archives, hot] = await Promise.all([allTags(env), archiveGroups(env), popularPostsLite(env)]);

  const body = `
  <section class="hero wrap">
    <div class="hero-main">
      <h1 class="hero-title">${html(site.siteName)}</h1>
      <p class="hero-sub">${html(site.tagline)}</p>
      <p class="hero-bio">${html(site.authorBio)}</p>
      <div class="hero-stats">
        <span><strong>${total}</strong> 篇文章</span>
        <span><strong>${tags.length}</strong> 个标签</span>
        <a class="btn-primary" href="/rss.xml">订阅 RSS</a>
      </div>
    </div>
  </section>

  <div class="wrap layout-grid">
    <div class="content-col">
      ${posts.length ? posts.map((p) => postCard(p)).join('') : emptyState('还没有文章', '去后台写第一篇吧')}
      ${pager(pg.current, pg.pages, (p) => pageUrl(p, '/'))}
    </div>
    <aside class="side-col">
      <section class="widget">
        <h3>归档</h3>
        <ul class="widget-list">
          ${archives.slice(0, 8).map((a) => `<li><a href="/archive/${html(a.key)}">${html(a.label)}</a><span>${a.count}</span></li>`).join('') || '<li class="muted">暂无</li>'}
          ${archives.length > 8 ? `<li><a href="/archive">全部归档 →</a></li>` : ''}
        </ul>
      </section>
      <section class="widget">
        <h3>标签</h3>
        <div class="chips">${tags.slice(0, 20).map((t) => `<a class="chip" href="/tag/${html(t.slug)}">#${html(t.name)} <i>${t.count ?? 0}</i></a>`).join('') || '<span class="muted">暂无</span>'}</div>
      </section>
      ${
        hot.length
          ? `<section class="widget"><h3>热门</h3><ul class="widget-list">${hot
              .map((p) => `<li><a href="/p/${html(p.slug)}">${html(p.title)}</a><span>${p.views}</span></li>`)
              .join('')}</ul></section>`
          : ''
      }
    </aside>
  </div>`;

  return c.html(
    layout({ env: site, path: '/', body, description: site.tagline, canonical: '/' })
  );
});

async function popularPostsLite(env: Env) {
  const { popularPosts } = await import('../lib/db');
  return popularPosts(env, 5);
}

/* --------------------------------------------------------- 文章详情 */
publicRoutes.get('/p/:slug', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const slug = c.req.param('slug');
  const post = await getPostBySlug(env, slug, false);

  if (!post) {
    return c.html(
      layout({
        env: site,
        path: `/p/${slug}`,
        title: '文章不存在',
        noindex: true,
        body: `${pageHeader('四百零四！', '找不到喵~')}${emptyState('我们瞎了', '不存在或者已私密，或者是个草稿~')}`,
      }),
      404
    );
  }

  // 访问计数（同一小时内同一篇只计一次）
  // 注意：Cookie 的 Path 必须是 ASCII，中文 slug 要先 encodeURIComponent
  if (!readCookie(c.req.raw, `v${post.id}`)) {
    await incrementViews(env, post.id);
    const safePath = `/p/${encodeURIComponent(slug)}`;
    c.header('Set-Cookie', `v${post.id}=1; Path=${safePath}; Max-Age=3600; SameSite=Lax`, { append: true });
  }

  const { prev, next } = await getNeighbours(env, post);
  const comments = await getApprovedComments(env, post.id);

  const og = siteOrigin(c.req);
  const body = `
  <div class="wrap article-wrap">
    <nav class="crumbs"><a href="/">首页</a> ${post.tags?.[0] ? `<span>/</span> <a href="/tag/${html(post.tags[0].slug)}">${html(post.tags[0].name)}</a>` : ''} <span>/</span> <span>正文</span></nav>
    <article class="article">
      <header class="article-head">
        <h1>${html(post.title)}</h1>
        <div class="post-meta">
          <time datetime="${html(post.published_at || '')}">${fmtDate(post.published_at)}</time>
          <span>·</span><span>${post.word_count} 字</span>
          <span>·</span><span>${post.views} 阅读</span>
        </div>
        ${
          post.tags?.length
            ? `<div class="chips article-tags">${post.tags.map((t) => `<a class="chip" href="/tag/${html(t.slug)}">#${html(t.name)}</a>`).join('')}</div>`
            : ''
        }
      </header>
      ${post.cover ? `<figure class="article-cover"><img src="${html(post.cover)}" alt=""></figure>` : ''}
      <div class="prose" id="postBody">${post.html}</div>
      <footer class="article-foot">
        <div class="chips">
          ${(post.tags || []).map((t) => `<a class="chip" href="/tag/${html(t.slug)}">#${html(t.name)}</a>`).join('')}
        </div>
        <div class="prevnext">
          ${prev ? `<a class="pn" href="/p/${html(prev.slug)}"><span>← 上一篇</span><strong>${html(prev.title)}</strong></a>` : '<span></span>'}
          ${next ? `<a class="pn right" href="/p/${html(next.slug)}"><span>下一篇 →</span><strong>${html(next.title)}</strong></a>` : '<span></span>'}
        </div>
      </footer>
    </article>

    ${site.commentEnabled ? renderComments(c, post.id, comments, c.get('csrf')) : ''}
  </div>`;

  return c.html(
    layout({
      env: site,
      path: `/p/${slug}`,
      title: post.title,
      description: post.summary || excerpt(post.content),
      ogType: 'article',
      canonical: `${og}/p/${slug}`,
      body,
      extraHead: `<meta property="og:image" content="${html(post.cover || `${og}/og.svg`)}">`,
    })
  );
});

/* ------------------------------------------------------------- 归档 */
publicRoutes.get('/archive', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const groups = await archiveGroups(env);
  const counts = groups.reduce((s, g) => s + g.count, 0);

  const body = `${pageHeader('归档', `共 ${counts} 篇文章`)}
  <div class="wrap">
    <div class="archive-grid">
      ${groups
        .map(
          (g) => `<a class="archive-card" href="/archive/${html(g.key)}">
            <strong>${html(g.label)}</strong><span>${g.count} 篇</span>
          </a>`
        )
        .join('') || emptyState('还没有归档')}
    </div>
  </div>`;
  return c.html(layout({ env: site, path: '/archive', title: '归档', body }));
});

publicRoutes.get('/archive/:key', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const key = c.req.param('key');
  if (!/^\d{4}-\d{2}$/.test(key)) {
    return c.redirect('/archive');
  }
  const res = await env.DB.prepare(
    `SELECT p.* FROM posts p
      WHERE p.status = 'published' AND substr(p.published_at, 1, 7) = ?
      ORDER BY p.is_top DESC, p.published_at DESC`
  ).bind(key).all<any>();
  const posts = (res.results || []).map((p) => ({
    ...p,
    tags: (p.tag_names ? String(p.tag_names).split(',') : []).map((n, i) => ({
      name: n,
      slug: (p.tag_slugs ? String(p.tag_slugs).split(',') : [])[i],
    })),
  }));
  const [y, m] = key.split('-');
  const label = `${y} 年 ${Number(m)} 月`;

  const body = `${pageHeader(label, `${posts.length} 篇`)}
  <div class="wrap content-col">
    <p class="back-link"><a href="/archive">← 返回归档</a></p>
    ${posts.length ? posts.map((p) => postCard(p)).join('') : emptyState('这个月没有文章')}
  </div>`;
  return c.html(layout({ env: site, path: `/archive/${key}`, title: label, body }));
});

/* ------------------------------------------------------------- 标签 */
publicRoutes.get('/tags', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const tags = await allTags(env);
  const body = `${pageHeader('标签', `${tags.length} 个标签`)}
  <div class="wrap">
    <div class="tags-cloud">
      ${tags
        .map(
          (t) =>
            `<a class="chip chip-lg" href="/tag/${html(t.slug)}" style="--w:${Math.min(3, 0.8 + (t.count ?? 0) * 0.4)}">#${html(t.name)} <i>${t.count}</i></a>`
        )
        .join('') || emptyState('还没有标签')}
    </div>
  </div>`;
  return c.html(layout({ env: site, path: '/tags', title: '标签', body }));
});

publicRoutes.get('/tag/:slug', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const slug = c.req.param('slug');
  const page = parseInt(c.req.query('page') || '1', 10) || 1;
  const total = await countPublished(env, { tag: slug });
  const pg = paginate(total, page, site.itemsPerPage);
  const posts = await getPublishedPosts(env, { tag: slug, limit: pg.perPage, offset: pg.offset });
  const tag = (await allTags(env)).find((t) => t.slug === slug);

  const body = `${pageHeader(tag ? `#${tag.name}` : '标签', `${total} 篇文章`)}
  <div class="wrap content-col">
    <p class="back-link"><a href="/tags">← 全部标签</a></p>
    ${posts.length ? posts.map((p) => postCard(p)).join('') : emptyState('这个标签下还没有文章')}
    ${pager(pg.current, pg.pages, (p) => pageUrl(p, `/tag/${slug}`))}
  </div>`;
  return c.html(
    layout({ env: site, path: `/tag/${slug}`, title: tag ? `#${tag.name}` : '标签', body, noindex: !tag })
  );
});

/* ------------------------------------------------------------- 搜索 */
publicRoutes.get('/search', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const q = (c.req.query('q') || '').trim().slice(0, 80);
  const page = parseInt(c.req.query('page') || '1', 10) || 1;

  let posts: any[] = [];
  let total = 0;
  if (q) {
    total = await countPublished(env, { keyword: q });
    const pg = paginate(total, page, site.itemsPerPage);
    posts = await getPublishedPosts(env, { keyword: q, limit: pg.perPage, offset: pg.offset });
    const body = `${pageHeader(`搜索：${q}`, `找到 ${total} 条结果`)}
    <div class="wrap content-col">
      <form class="search-page-form" action="/search" method="get">
        <input type="search" name="q" value="${html(q)}" placeholder="搜索标题或内容…">
        <button type="submit">搜索</button>
      </form>
      ${posts.length ? posts.map((p) => postCard(p)).join('') : emptyState('没有匹配的文章', '换个关键词试试')}
      ${pager(pg.current, pg.pages, (p) => pageUrl(p, '/search', { q }))}
    </div>`;
    return c.html(layout({ env: site, path: '/search', title: `搜索：${q}`, body, noindex: true }));
  }

  const body = `${pageHeader('搜索')}
  <div class="wrap content-col">
    <form class="search-page-form" action="/search" method="get">
      <input type="search" name="q" placeholder="输入关键词…" autofocus>
      <button type="submit">搜索</button>
    </form>
    ${emptyState('输入关键词开始搜索', '支持标题、摘要与正文')}
  </div>`;
  return c.html(layout({ env: site, path: '/search', title: '搜索', body, noindex: true }));
});

/* ------------------------------------------------------------- 关于 */
publicRoutes.get('/about', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const recent = await getPublishedPosts(env, { limit: 3 });

  const body = `${pageHeader('关于')}
  <div class="wrap content-col narrow">
    <div class="about-card">
      ${
        site.authorAvatar
          ? `<img class="avatar" src="${html(site.authorAvatar)}" alt="">`
          : `<div class="avatar avatar-text">${html(site.authorName.slice(0, 1))}</div>`
      }
      <div>
        <h2>${html(site.authorName)}</h2>
        <p>${html(site.authorBio)}</p>
        <div class="chips">
          ${site.githubUrl ? `<a class="chip" href="${html(site.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ''}
          ${site.xUrl ? `<a class="chip" href="${html(site.xUrl)}" target="_blank" rel="noopener noreferrer">X</a>` : ''}
          ${site.email ? `<a class="chip" href="mailto:${html(site.email)}">Email</a>` : ''}
        </div>
      </div>
    </div>
    <div class="prose">${site.about || '<p>还没写关于页面，去后台补充吧。</p>'}</div>
    <h3>最近更新</h3>
    <div class="list">${recent.map((p) => postCard(p, { compact: true })).join('')}</div>
  </div>`;
  return c.html(layout({ env: site, path: '/about', title: '关于', body }));
});

/* ------------------------------------------------------------- 下载区 */
publicRoutes.get('/downloads', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const items = await listDownloads(env);

  const featured = items.filter((d) => d.is_featured);
  const rest = items.filter((d) => !d.is_featured);

  const card = (d: {
    id: number;
    title: string;
    summary: string;
    platform: string;
    version: string;
    size: string;
    downloads: number;
  }) => `<article class="dl-card">
    <div class="dl-main">
      <h3>${html(d.title)}</h3>
      ${d.summary ? `<p class="dl-summary">${html(d.summary)}</p>` : ''}
      <div class="dl-meta">
        ${d.platform ? `<span class="dl-tag">${html(d.platform)}</span>` : ''}
        ${d.version ? `<span>v${html(d.version)}</span>` : ''}
        ${d.size ? `<span>${html(d.size)}</span>` : ''}
        ${d.downloads > 0 ? `<span>${d.downloads} 次下载</span>` : ''}
      </div>
    </div>
    <a class="dl-btn" href="/d/${d.id}" rel="nofollow noopener">下载</a>
  </article>`;

  const body = `${pageHeader('下载', items.length ? '这里放一些我用过觉得还行的工具和资源' : '')}
  <div class="wrap content-col">
    ${
      items.length
        ? `
    ${
      featured.length
        ? `<section class="dl-featured">
      <h2 class="dl-section">推荐</h2>
      ${featured.map(card).join('')}
    </section>`
        : ''
    }
    ${
      rest.length
        ? `<section class="dl-rest">
      ${featured.length ? '<h2 class="dl-section">全部</h2>' : ''}
      ${rest.map(card).join('')}
    </section>`
        : ''
    }
    <p class="dl-note muted">资源托管在第三方，链接可能失效。发现失效了欢迎告诉我。</p>`
        : emptyState('还没有内容', '去后台 /admin/downloads 添加下载链接')
    }
  </div>`;

  return c.html(layout({ env: site, path: '/downloads', title: '下载', body }));
});

/** 中转跳转：记一次下载量再 302 到外链 */
publicRoutes.get('/d/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const url = await recordDownload(c.env, id);
  if (!url) return c.redirect('/downloads');
  return c.redirect(url, 302);
});

/* -------------------------------------------------------------- RSS */
publicRoutes.get('/rss.xml', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const posts = await getPublishedPosts(env, { limit: 20 });
  const origin = siteOrigin(c.req);
  const last = posts[0]?.updated_at || posts[0]?.created_at || new Date().toISOString();

  const items = posts
    .map(
      (p) => `<item>
      <title><![CDATA[${p.title}]]></title>
      <link>${origin}/p/${html(p.slug)}</link>
      <guid isPermaLink="true">${origin}/p/${html(p.slug)}</guid>
      <description><![CDATA[${p.summary || excerpt(p.content)}]]></description>
      <pubDate>${new Date((p.published_at || '').replace(' ', 'T') + 'Z').toUTCString()}</pubDate>
      ${(p.tags || []).map((t) => `<category><![CDATA[${t.name}]]></category>`).join('')}
    </item>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${html(site.siteName)}</title>
  <link>${origin}</link>
  <description>${html(site.tagline)}</description>
  <language>zh-cn</language>
  <lastBuildDate>${new Date(last.replace(' ', 'T') + 'Z').toUTCString()}</lastBuildDate>
  <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>
  ${items}
</channel>
</rss>`;

  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  return c.body(xml);
});

publicRoutes.get('/sitemap.xml', async (c) => {
  const env = c.env;
  const site = await getSiteConfig(env);
  const origin = siteOrigin(c.req);
  const posts = await getPublishedPosts(env, { limit: 500 });
  const tags = await allTags(env);
  const today = new Date().toISOString().slice(0, 10);

  const urls = [
    `<url><loc>${origin}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>`,
    `<url><loc>${origin}/archive</loc><lastmod>${today}</lastmod><priority>0.6</priority></url>`,
    `<url><loc>${origin}/tags</loc><lastmod>${today}</lastmod><priority>0.6</priority></url>`,
    `<url><loc>${origin}/about</loc><lastmod>${today}</lastmod><priority>0.5</priority></url>`,
    ...posts.map(
      (p) =>
        `<url><loc>${origin}/p/${html(p.slug)}</loc><lastmod>${(p.updated_at || '').slice(0, 10)}</lastmod><priority>0.8</priority></url>`
    ),
    ...tags.map((t) => `<url><loc>${origin}/tag/${html(t.slug)}</loc><priority>0.4</priority></url>`),
  ].join('\n');

  c.header('Content-Type', 'application/xml; charset=utf-8');
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
  );
});

publicRoutes.get('/robots.txt', (c) => {
  const origin = siteOrigin(c.req);
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${origin}/sitemap.xml\n`);
});

/* ------------------------------------------------------------- 评论 */
async function getApprovedComments(env: Env, postId: number) {
  const res = await env.DB.prepare(
    `SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC`
  ).bind(postId).all<any>();
  return res.results || [];
}

function renderComments(c: any, postId: number, comments: any[], csrf: string): string {
  const origin = siteOrigin(c.req);
  const tree = buildTree(comments);
  const ok = c.req.query('comment') === 'ok';
  const err = c.req.query('err') || '';

  const renderNode = (n: any, depth: number): string => {
    const kids = (n.children || []).map((k: any) => renderNode(k, depth + 1)).join('');
    return `<li class="comment${depth ? ' reply' : ''}" id="c${n.id}">
      <div class="comment-head">
        ${n.url ? `<a class="comment-author" href="${html(n.url)}" target="_blank" rel="noopener nofollow noopener">${html(n.author)}</a>` : `<span class="comment-author">${html(n.author)}</span>`}
        <time>${n.created_at.slice(0, 16)}</time>
      </div>
      <div class="comment-body">${simpleMarkdown(n.body)}</div>
      <a class="comment-reply" href="#comment-form" data-reply="${n.id}" data-author="${html(n.author)}">回复</a>
      ${kids ? `<ul class="comment-children">${kids}</ul>` : ''}
    </li>`;
  };

  return `<section class="comments" id="comments">
    <h2>评论 <span class="count">${comments.length}</span></h2>
    ${ok ? '<div class="flash ok">评论已提交，审核通过后显示。</div>' : ''}
    ${err ? `<div class="flash err">${html(err)}</div>` : ''}
    ${
      comments.length
        ? `<ul class="comment-list">${tree.map((n) => renderNode(n, 0)).join('')}</ul>`
        : '<p class="muted">还没有评论，来抢沙发。</p>'
    }
    <form class="comment-form" id="comment-form" method="post" action="${origin}/comment">
      <input type="hidden" name="csrf_token" value="${html(csrf)}">
      <input type="hidden" name="post_id" value="${postId}">
      <input type="hidden" name="parent_id" id="replyTo" value="">
      <div class="reply-hint" id="replyHint" hidden></div>
      <div class="form-row">
        <input name="author" placeholder="昵称 *" required maxlength="30">
        <input name="email" type="email" placeholder="邮箱（不公开）" maxlength="80">
        <input name="url" type="url" placeholder="网站" maxlength="200">
      </div>
      <textarea name="body" rows="4" placeholder="说点什么…（支持 Markdown）" required maxlength="3000"></textarea>
      <button class="btn-primary" type="submit">发表评论</button>
    </form>
  </section>`;
}

function buildTree(list: any[]) {
  const map = new Map<number, any>();
  const roots: any[] = [];
  for (const c of list) map.set(c.id, { ...c, children: [] });
  for (const c of map.values()) {
    if (c.parent_id && map.has(c.parent_id)) map.get(c.parent_id).children.push(c);
    else roots.push(c);
  }
  return roots;
}

/** 评论正文：极简行内 Markdown + 转义 */
function simpleMarkdown(text: string): string {
  return html(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

publicRoutes.post('/comment', async (c) => {
  const env = c.env;
  const form = await c.req.parseBody();
  const get = (k: string) => String((form as any)[k] ?? '').trim();

  // 先按 slug 定位文章，保证任何失败分支都能把用户送回原文章
  const postId = parseInt(get('post_id'), 10);
  const post = await env.DB.prepare('SELECT slug FROM posts WHERE id = ? AND status = ?')
    .bind(postId, 'published')
    .first<{ slug: string }>();
  const slug = post?.slug || get('slug');
  if (!slug) return c.redirect('/');
  const err = (msg: string) => c.redirect(`/p/${encodeURIComponent(slug)}?err=${encodeURIComponent(msg)}#comment-form`);

  if (!checkCsrf(c.req.raw, get('csrf_token'))) {
    return err('会话已过期，请刷新页面重试');
  }
  const site = await getSiteConfig(env);
  if (!site.commentEnabled) return err('评论已关闭');

  const author = get('author').slice(0, 30);
  const body = get('body').slice(0, 3000);

  if (!post) return c.redirect('/');
  if (!author) return err('请填写昵称');
  if (body.length < 2) return err('评论太短了');

  // 简单反垃圾：链接数量 + 重复内容
  const links = (body.match(/https?:\/\//g) || []).length;
  if (links > 3) return err('评论里的链接太多了');
  const dup = await env.DB.prepare(
    `SELECT id FROM comments WHERE body = ? AND created_at > datetime('now','-1 day') LIMIT 1`
  ).bind(body).first();
  if (dup) return err('这条评论已经发过了');

  const fp = await ipHash(getClientIp(c.req.raw), 'comment');
  const limit = await rateLimit(env, 'comment', fp, 5, 60);
  if (!limit.ok) return err('评论太频繁了，休息一小时再来');

  let parentId: number | null = null;
  const pid = parseInt(get('parent_id'), 10);
  if (pid) {
    const exists = await env.DB.prepare('SELECT id FROM comments WHERE id = ? AND post_id = ?')
      .bind(pid, postId)
      .first();
    if (exists) parentId = pid;
  }

  await env.DB.prepare(
    `INSERT INTO comments (post_id, parent_id, author, email, url, body, status, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(postId, parentId, author, get('email').slice(0, 80), get('url').slice(0, 200), body, fp)
    .run();

  return c.redirect(`/p/${encodeURIComponent(slug)}?comment=ok#comments`);
});

/* -------------------------------------------------------------- 404 */
publicRoutes.notFound((c) => {
  return c.html(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>404 · ${html((c.env as Env).SITE_NAME || 'Not Found')}</title>
    <link rel="stylesheet" href="/style.css"></head>
    <body class="nf-body"><div class="nf">
      <h1>404</h1><p>这里什么都没有。</p>
      <a class="btn-primary" href="/">回首页</a>
    </div></body></html>`,
    404
  );
});

export { slugify, timingSafeEqual };