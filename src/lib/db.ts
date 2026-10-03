import type { Download, Env, Post, SiteConfig, Tag } from '../types';

const SETTING_KEYS = [
  'site_name',
  'site_tagline',
  'about',
  'footer_note',
  'comment_enabled',
] as const;

/**
 * 兜底自愈：任何 html 为空的文章（比如直接用 SQL 灌入的数据）
 * 会在渲染前自动用 Markdown 渲染器补上，避免页面空白。
 */
export async function backfillHtml(env: Env): Promise<void> {
  const res = await env.DB.prepare(
    "SELECT id, content FROM posts WHERE (html IS NULL OR html = '') AND content != '' LIMIT 20"
  ).all<{ id: number; content: string }>();
  if (!res.results?.length) return;
  const { renderMarkdown, countWords } = await import('./markdown');
  const stmts = res.results.map((r) => {
    const { html: rendered } = renderMarkdown(r.content);
    return env.DB.prepare('UPDATE posts SET html = ?, word_count = ? WHERE id = ?')
      .bind(rendered, countWords(r.content), r.id);
  });
  await env.DB.batch(stmts);
}

/** 读取站点配置：DB settings 优先，wrangler vars 兜底 */
export async function getSiteConfig(env: Env): Promise<SiteConfig> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const s: Record<string, string> = {};
  for (const r of rows.results || []) s[r.key] = r.value;

  const commentEnabled =
    (s.comment_enabled ?? env.COMMENT_ENABLED ?? '1') === '1' || (s.comment_enabled ?? env.COMMENT_ENABLED) === 'true';

  return {
    siteName: s.site_name || env.SITE_NAME || 'My Blog',
    tagline: s.site_tagline || env.SITE_TAGLINE || '',
    authorName: env.AUTHOR_NAME || 'Author',
    authorBio: env.AUTHOR_BIO || '',
    authorAvatar: env.AUTHOR_AVATAR || '',
    githubUrl: env.GITHUB_URL || '',
    xUrl: env.X_URL || '',
    email: env.EMAIL || '',
    commentEnabled,
    itemsPerPage: Math.min(50, Math.max(1, parseInt(env.ITEMS_PER_PAGE || '8', 10) || 8)),
    about: s.about || '',
    footerNote: s.footer_note || '',
  };
}

export async function saveSettings(env: Env, data: Record<string, string>): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const key of SETTING_KEYS) {
    if (data[key] !== undefined) {
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, data[key]));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

const POST_SELECT = `
  SELECT p.*,
         (SELECT GROUP_CONCAT(t.name, ',') FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tag_names,
         (SELECT GROUP_CONCAT(t.slug, ',') FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tag_slugs
    FROM posts p`;

function attachTags(rows: any[]): Post[] {
  return (rows || []).map((r) => {
    const names = r.tag_names ? String(r.tag_names).split(',') : [];
    const slugs = r.tag_slugs ? String(r.tag_slugs).split(',') : [];
    const tags: Tag[] = names.map((n: string, i: number) => ({ id: 0, name: n, slug: slugs[i] }));
    return { ...r, tags };
  });
}

export async function getPublishedPosts(
  env: Env,
  opts: { limit?: number; offset?: number; tag?: string; keyword?: string } = {}
): Promise<Post[]> {
  await backfillHtml(env);
  const where: string[] = ["p.status = 'published'", "p.published_at IS NOT NULL"];
  const binds: unknown[] = [];
  let join = '';

  if (opts.tag) {
    join = `JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id`;
    where.push('t.slug = ?');
    binds.push(opts.tag);
  }
  if (opts.keyword) {
    where.push('(p.title LIKE ? OR p.summary LIKE ? OR p.content LIKE ?)');
    const k = `%${opts.keyword}%`;
    binds.push(k, k, k);
  }

  const limit = opts.limit ?? 10;
  const offset = opts.offset ?? 0;
  const sql = `${POST_SELECT} ${join}
    WHERE ${where.join(' AND ')}
    ORDER BY p.is_top DESC, p.published_at DESC
    LIMIT ? OFFSET ?`;

  const res = await env.DB.prepare(sql).bind(...binds, limit, offset).all<any>();
  return attachTags(res.results);
}

export async function countPublished(env: Env, opts: { tag?: string; keyword?: string } = {}): Promise<number> {
  const where: string[] = ["p.status = 'published'", 'p.published_at IS NOT NULL'];
  const binds: unknown[] = [];
  let join = '';
  if (opts.tag) {
    join = `JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id`;
    where.push('t.slug = ?');
    binds.push(opts.tag);
  }
  if (opts.keyword) {
    where.push('(p.title LIKE ? OR p.summary LIKE ? OR p.content LIKE ?)');
    const k = `%${opts.keyword}%`;
    binds.push(k, k, k);
  }
  const res = await env.DB.prepare(`SELECT COUNT(*) AS c FROM posts p ${join} WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>();
  return res?.c ?? 0;
}

export async function getPostBySlug(env: Env, slug: string, includeDraft = false): Promise<Post | null> {
  await backfillHtml(env);
  const sql = includeDraft
    ? `${POST_SELECT} WHERE p.slug = ?`
    : `${POST_SELECT} WHERE p.slug = ? AND p.status = 'published'`;
  const res = await env.DB.prepare(sql).bind(slug).all<any>();
  const posts = attachTags(res.results);
  return posts[0] ?? null;
}

export async function getPostById(env: Env, id: number): Promise<Post | null> {
  const res = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).all<any>();
  return attachTags(res.results)[0] ?? null;
}

/** 上一篇 / 下一篇（按发布时间） */
export async function getNeighbours(env: Env, post: Post): Promise<{ prev: Post | null; next: Post | null }> {
  if (!post.published_at) return { prev: null, next: null };
  const res = await env.DB.prepare(
    `SELECT slug, title FROM posts
      WHERE status = 'published' AND published_at IS NOT NULL
        AND published_at > ?
      ORDER BY published_at ASC LIMIT 1`
  )
    .bind(post.published_at)
    .first<{ slug: string; title: string }>();
  const res2 = await env.DB.prepare(
    `SELECT slug, title FROM posts
      WHERE status = 'published' AND published_at IS NOT NULL
        AND published_at < ?
      ORDER BY published_at DESC LIMIT 1`
  )
    .bind(post.published_at)
    .first<{ slug: string; title: string }>();
  return {
    prev: res ? { slug: res.slug, title: res.title } as Post : null,
    next: res2 ? { slug: res2.slug, title: res2.title } as Post : null,
  };
}

export async function allTags(env: Env): Promise<Tag[]> {
  const res = await env.DB.prepare(
    `SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS count
       FROM tags t
       LEFT JOIN post_tags pt ON pt.tag_id = t.id
       LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
      GROUP BY t.id ORDER BY count DESC, t.name ASC`
  ).all<{ id: number; name: string; slug: string; count: number }>();
  return res.results || [];
}

export async function archiveGroups(env: Env): Promise<{ key: string; label: string; count: number }[]> {
  const res = await env.DB.prepare(
    `SELECT substr(published_at, 1, 7) AS key, COUNT(*) AS count
       FROM posts WHERE status = 'published' AND published_at IS NOT NULL
      GROUP BY key ORDER BY key DESC`
  ).all<{ key: string; count: number }>();
  return (res.results || []).map((r) => {
    const [y, m] = r.key.split('-');
    return { key: r.key, label: `${y} 年 ${Number(m)} 月`, count: r.count };
  });
}

export async function popularPosts(env: Env, limit = 5): Promise<Post[]> {
  const res = await env.DB.prepare(
    `${POST_SELECT} WHERE p.status = 'published' ORDER BY p.views DESC LIMIT ?`
  ).bind(limit).all<any>();
  return attachTags(res.results);
}

export async function recentPosts(env: Env, limit = 5): Promise<Post[]> {
  return getPublishedPosts(env, { limit });
}

/** 同步标签：写入 post_tags 并清理孤儿标签 */
export async function syncTags(env: Env, postId: number, names: string[]): Promise<void> {
  const clean = Array.from(
    new Set(
      names
        .map((n) => String(n).trim())
        .filter(Boolean)
        .slice(0, 10)
    )
  );
  await env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId).run();

  for (const name of clean) {
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '') || 'tag';
    await env.DB.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)').bind(name, slug).run();
    const tag = await env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first<{ id: number }>();
    if (tag) {
      await env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(postId, tag.id).run();
    }
  }

  await env.DB.prepare(
    'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM post_tags)'
  ).run();
}

export async function getAllPosts(env: Env, limit = 50, offset = 0): Promise<Post[]> {
  const res = await env.DB.prepare(
    `${POST_SELECT} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all<any>();
  return attachTags(res.results);
}

export async function countAllPosts(env: Env): Promise<number> {
  const res = await env.DB.prepare('SELECT COUNT(*) AS c FROM posts').first<{ c: number }>();
  return res?.c ?? 0;
}

export async function incrementViews(env: Env, id: number): Promise<void> {
  await env.DB.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').bind(id).run();
}

export async function bumpSettingsCounter(env: Env, key: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
  ).bind(key).run();
}

/* ================================================================ 下载区 */
/** 只允许 http/https，挡掉 javascript: 和 data: */
function safeDownloadUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.slice(0, 2000);
}

export async function listDownloads(env: Env, onlyFeatured = false): Promise<Download[]> {
  const where = onlyFeatured ? 'WHERE is_featured = 1' : '';
  const res = await env.DB.prepare(
    `SELECT * FROM downloads ${where} ORDER BY sort_order ASC, id ASC`
  ).all<Download>();
  return res.results || [];
}

export async function countDownloads(env: Env): Promise<number> {
  const res = await env.DB.prepare('SELECT COUNT(*) AS c FROM downloads').first<{ c: number }>();
  return res?.c ?? 0;
}

export async function getDownload(env: Env, id: number): Promise<Download | null> {
  return env.DB.prepare('SELECT * FROM downloads WHERE id = ?').bind(id).first<Download>();
}

export interface DownloadInput {
  title: string;
  summary: string;
  platform: string;
  version: string;
  size: string;
  url: string;
  is_featured: number;
  sort_order: number;
}

function normalizeDownload(input: DownloadInput): DownloadInput | { error: string } {
  const title = String(input.title || '').trim().slice(0, 100);
  if (!title) return { error: '标题不能为空' };
  const url = safeDownloadUrl(input.url);
  if (!url) return { error: '链接必须是 http:// 或 https:// 开头' };
  return {
    title,
    summary: String(input.summary || '').trim().slice(0, 300),
    platform: String(input.platform || '').trim().slice(0, 40),
    version: String(input.version || '').trim().slice(0, 40),
    size: String(input.size || '').trim().slice(0, 40),
    url,
    is_featured: input.is_featured ? 1 : 0,
    sort_order: Number.isFinite(input.sort_order) ? Math.trunc(input.sort_order) : 0,
  };
}

export async function createDownload(env: Env, input: DownloadInput): Promise<number | { error: string }> {
  const d = normalizeDownload(input);
  if ('error' in d) return d;
  // 新条目默认排到末尾
  const maxRow = await env.DB.prepare('SELECT MAX(sort_order) AS m FROM downloads').first<{ m: number | null }>();
  const order = d.sort_order || (maxRow?.m ?? -1) + 1;
  const res = await env.DB.prepare(
    `INSERT INTO downloads (title, summary, platform, version, size, url, is_featured, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(d.title, d.summary, d.platform, d.version, d.size, d.url, d.is_featured, order)
    .run();
  return Number(res.meta.last_row_id);
}

export async function updateDownload(env: Env, id: number, input: DownloadInput): Promise<'ok' | { error: string }> {
  const d = normalizeDownload(input);
  if ('error' in d) return d;
  await env.DB.prepare(
    `UPDATE downloads
        SET title = ?, summary = ?, platform = ?, version = ?, size = ?,
            url = ?, is_featured = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?`
  )
    .bind(d.title, d.summary, d.platform, d.version, d.size, d.url, d.is_featured, d.sort_order, id)
    .run();
  return 'ok';
}

export async function deleteDownload(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM downloads WHERE id = ?').bind(id).run();
}

/** 点击计数 + 记录来源，供「下载量」排序和后台展示 */
export async function recordDownload(env: Env, id: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT url FROM downloads WHERE id = ?').bind(id).first<{ url: string }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE downloads SET downloads = downloads + 1 WHERE id = ?').bind(id).run();
  return row.url;
}