import { Hono } from 'hono';
import type { Env, Post } from '../types';
import { allTags, countAllPosts, getAllPosts, getPostById, getSiteConfig, saveSettings, syncTags } from '../lib/db';
import {
  checkCsrf,
  clearRateLimit,
  clearSessionCookie,
  createSession,
  csrfCookie,
  destroySession,
  ensureCsrfToken,
  getSession,
  loginLimitKey,
  rateLimit,
  sessionCookie,
} from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { countWords, escapeHtml, extractCover, extractSummary, renderMarkdown } from '../lib/markdown';
import { html, slugify } from '../lib/utils';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { user: any } }>();

/* --------------------------------------------------------- 鉴权中间件 */
// app.route() 之后 c.req.path 仍是完整路径，两种形式都放行登录页
const PUBLIC_ADMIN = ['/login', '/admin/login'];

adminRoutes.use('*', async (c, next) => {
  const token = ensureCsrfToken(c.req.raw);
  c.set('csrf' as never, token as never);
  const hasCsrfCookie = c.req.raw.headers.get('cookie')?.includes('nb_csrf=');
  if (!hasCsrfCookie) c.header('Set-Cookie', csrfCookie(token), { append: true });

  if (PUBLIC_ADMIN.includes(c.req.path)) return next();

  const user = await getSession(c.env, c.req.raw);
  if (!user) {
    if (c.req.method === 'GET') return c.redirect(`/admin/login?next=${encodeURIComponent(c.req.path)}`);
    return c.redirect('/admin/login');
  }
  c.set('user' as never, user as never);
  return next();
});

const csrf = (c: any) => String(c.get('csrf') || '');

/* ------------------------------------------------------------ 登录页 */
adminRoutes.get('/login', async (c) => {
  const site = await getSiteConfig(c.env);
  const next = c.req.query('next') || '/admin';
  const body = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · ${html(site.siteName)}</title><link rel="stylesheet" href="/style.css"></head>
<body class="login-body">
  <form class="login-card" method="post" action="/admin/login">
    <input type="hidden" name="csrf_token" value="${html(csrf(c))}">
    <input type="hidden" name="next" value="${html(next)}">
    <h1>${html(site.siteName)}</h1>
    <p class="muted">后台登录</p>
    ${c.req.query('err') ? `<div class="flash err">${html(c.req.query('err'))}</div>` : ''}
    <label>用户名<input name="username" required autofocus autocomplete="username"></label>
    <label>密码<input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn-primary block" type="submit">登录</button>
    <p class="login-tip">默认账号 <code>admin</code> / <code>admin123</code>，登录后请立刻修改密码</p>
  </form>
</body></html>`;
  return c.html(body);
});

adminRoutes.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const username = String(form.username || '').trim().slice(0, 40);
  const password = String(form.password || '');
  const next = String(form.next || '/admin');

  const fail = (msg: string) => c.redirect(`/admin/login?err=${encodeURIComponent(msg)}`);

  if (!checkCsrf(c.req.raw, String(form.csrf_token || ''))) return fail('会话已过期，请重试');

  const key = await loginLimitKey(c.req.raw, username);
  const limit = await rateLimit(c.env, 'login', key, 10, 15);
  if (!limit.ok) return fail('尝试次数过多，请 15 分钟后再试');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<any>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return fail('用户名或密码不正确');
  }

  await clearRateLimit(c.env, 'login', key);
  const token = await createSession(c.env, user.id, c.req.raw);
  const site = await getSiteConfig(c.env);
  c.header('Set-Cookie', sessionCookie(token), { append: true });

  const safeNext = next.startsWith('/admin') ? next : '/admin';
  return c.redirect(`${safeNext}?ok=${encodeURIComponent('欢迎回来，' + user.username)}`);
});

adminRoutes.post('/logout', async (c) => {
  const form = await c.req.parseBody();
  if (checkCsrf(c.req.raw, String(form.csrf_token || ''))) await destroySession(c.env, c.req.raw);
  c.header('Set-Cookie', clearSessionCookie(), { append: true });
  return c.redirect('/admin/login');
});

/* ------------------------------------------------------------ 后台壳 */
function adminShell(
  site: any,
  active: string,
  csrfToken: string,
  user: any,
  inner: string,
  ok = ''
): string {
  const nav = [
    ['/admin', '文章'],
    ['/admin/comments', '评论'],
    ['/admin/tags', '标签'],
    ['/admin/settings', '设置'],
  ]
    .map(([href, label]) => `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`)
    .join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>后台 · ${html(site.siteName)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/admin.css">
</head><body class="admin-body" data-csrf="${html(csrfToken)}">
<header class="admin-bar">
  <div class="admin-bar-inner">
    <strong class="admin-brand">${html(site.siteName)}</strong>
    <nav>${nav}<a href="/" target="_blank">查看站点 ↗</a></nav>
    <div class="admin-user">
      <span>${html(user.username)}</span>
      <form method="post" action="/admin/logout">
        <input type="hidden" name="csrf_token" value="${html(csrfToken)}">
        <button class="link-btn" type="submit">退出</button>
      </form>
    </div>
  </div>
</header>
${ok ? `<div class="flash ok admin-flash">${html(ok)}</div>` : ''}
${inner}
<script src="/admin.js" defer></script>
</body></html>`;
}

/* ------------------------------------------------------ 文章列表页 */
adminRoutes.get('/', async (c) => {
  const site = await getSiteConfig(c.env);
  const page = parseInt(c.req.query('page') || '1', 10) || 1;
  const per = 20;
  const total = await countAllPosts(c.env);
  const posts = await getAllPosts(c.env, per, (page - 1) * per);
  const pages = Math.max(1, Math.ceil(total / per));

  const rows = posts
    .map(
      (p) => `<tr>
      <td class="t-title"><a href="/admin/edit/${p.id}">${html(p.title)}</a><div class="t-slug">/${html(p.slug)}</div></td>
      <td><span class="badge ${p.status === 'published' ? 'ok' : 'draft'}">${p.status === 'published' ? '已发布' : '草稿'}</span></td>
      <td class="t-num">${p.views}</td>
      <td class="t-num">${p.word_count}</td>
      <td class="t-date">${(p.updated_at || '').slice(0, 16)}</td>
      <td class="t-act">
        <a href="/p/${html(p.slug)}" target="_blank">看</a>
        <a href="/admin/edit/${p.id}">编辑</a>
        <form method="post" action="/admin/delete/${p.id}" data-confirm="确定删除《${escapeHtml(p.title)}》？此操作不可撤销。">
          <input type="hidden" name="csrf_token" value="${html(csrf(c))}">
          <button class="link-btn danger" type="submit">删</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const inner = `<main class="admin-main">
    <div class="admin-head">
      <h1>文章 <span class="muted">${total} 篇</span></h1>
      <a class="btn-primary" href="/admin/new">写新文章</a>
    </div>
    <table class="admin-table">
      <thead><tr><th>标题</th><th>状态</th><th>阅读</th><th>字数</th><th>更新</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="t-empty">还没有文章</td></tr>'}</tbody>
    </table>
    ${
      pages > 1
        ? `<nav class="pager">${
            page > 1 ? `<a class="page" href="/admin?page=${page - 1}">上一页</a>` : ''
          }<span class="page active">${page} / ${pages}</span>${
            page < pages ? `<a class="page" href="/admin?page=${page + 1}">下一页</a>` : ''
          }</nav>`
        : ''
    }
  </main>`;

  return c.html(adminShell(site, '/admin', csrf(c), c.get('user'), inner, c.req.query('ok') || ''));
});

/* ------------------------------------------------------ 新建/编辑页 */
adminRoutes.get('/new', async (c) => {
  const site = await getSiteConfig(c.env);
  const all = await allTags(c.env);
  const blank = {
    id: 0, slug: '', title: '', summary: '', content: '', html: '', cover: '',
    status: 'draft', is_top: 0, views: 0, word_count: 0,
    published_at: null, created_at: '', updated_at: '',
    tags: [],
  } as unknown as Post;
  return c.html(adminShell(site, '/admin', csrf(c), c.get('user'), editorHtml(blank, all, csrf(c)), c.req.query('ok') || ''));
});

adminRoutes.get('/edit/:id', async (c) => {
  const site = await getSiteConfig(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const post = await getPostById(c.env, id);
  if (!post) return c.redirect('/admin?err=' + encodeURIComponent('文章不存在'));
  const all = await allTags(c.env);
  return c.html(adminShell(site, '/admin', csrf(c), c.get('user'), editorHtml(post, all, csrf(c)), c.req.query('ok') || ''));
});

function editorHtml(p: Post, allTags: { name: string; slug: string }[], csrfToken: string): string {
  const tagsValue = (p.tags || []).map((t) => t.name).join(', ');
  return `<main class="admin-main editor">
    <form id="postForm" method="post" action="${p.id ? `/admin/save/${p.id}` : '/admin/save'}">
      <input type="hidden" name="csrf_token" value="${html(csrfToken)}">
      <div class="editor-main">
        <input class="title-input" name="title" placeholder="文章标题" value="${html(p.title)}" required maxlength="120">
        <div class="editor-toolbar" id="toolbar">
          <button type="button" data-md="h2">H2</button>
          <button type="button" data-md="h3">H3</button>
          <button type="button" data-md="bold"><b>B</b></button>
          <button type="button" data-md="italic"><i>I</i></button>
          <button type="button" data-md="code">&lt;/&gt;</button>
          <button type="button" data-md="link">链接</button>
          <button type="button" data-md="quote">引用</button>
          <button type="button" data-md="ul">列表</button>
          <button type="button" data-md="ol">编号</button>
          <button type="button" data-md="codeblock">代码块</button>
          <button type="button" data-md="hr">分割线</button>
        </div>
        <textarea class="content-input" name="content" id="contentInput" placeholder="用 Markdown 写正文…" required>${html(p.content)}</textarea>
        <div class="editor-hint">字数 <span id="wordCount">${p.word_count}</span> · 剩余 <span id="leftCount"></span></div>
      </div>

      <aside class="editor-side">
        <div class="box">
          <h3>发布</h3>
          <label>状态
            <select name="status">
              <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>草稿</option>
              <option value="published" ${p.status === 'published' ? 'selected' : ''}>已发布</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" name="is_top" value="1" ${p.is_top ? 'checked' : ''}> 置顶</label>
          ${p.status === 'published' ? '<p class="muted small">公开页面已可见</p>' : '<p class="muted small">草稿不对外可见</p>'}
          <button class="btn-primary block" type="submit">保存</button>
          ${p.id ? `<a class="btn-ghost block" href="/p/${html(p.slug)}" target="_blank">预览 ↗</a>` : ''}
        </div>

        <div class="box">
          <h3>摘要</h3>
          <textarea name="summary" rows="3" placeholder="留空则自动截取正文">${html(p.summary)}</textarea>
        </div>

        <div class="box">
          <h3>标签</h3>
          <input name="tags" value="${html(tagsValue)}" placeholder="逗号分隔，如：技术, 随笔">
          <div class="chips small-chips">${allTags.map((t) => `<span class="chip" data-tag="${html(t.name)}">#${html(t.name)}</span>`).join('')}</div>
        </div>

        <div class="box">
          <h3>Slug</h3>
          <input name="slug" value="${html(p.slug)}" placeholder="留空自动生成">
          <p class="muted small" id="slugHint"></p>
        </div>

        <div class="box">
          <h3>封面</h3>
          <input name="cover" value="${html(p.cover)}" placeholder="图片 URL">
        </div>
      </aside>
    </form>

    <div class="preview-modal" id="previewModal" hidden>
      <div class="preview-box">
        <div class="preview-head"><strong>预览</strong><button type="button" id="closePreview">关闭</button></div>
        <div class="prose" id="previewBody"></div>
      </div>
    </div>
  </main>`;
}

/* ------------------------------------------------------------ 保存 */
const saveHandler = async (c: any) => {
  const form = await c.req.parseBody();
  const get = (k: string, d = '') => String(form[k] ?? d);

  if (!checkCsrf(c.req.raw, get('csrf_token'))) {
    return c.redirect(`/admin/new?err=${encodeURIComponent('会话已过期')}`);
  }

  const title = get('title').slice(0, 120);
  const content = get('content');
  if (!title.trim()) return c.redirect(`/admin/new?err=${encodeURIComponent('标题不能为空')}`);
  if (!content.trim()) return c.redirect(`/admin/new?err=${encodeURIComponent('正文不能为空')}`);

  const rawId = c.req.param('id');
  const existingId = rawId ? parseInt(rawId, 10) : 0;
  const existing = existingId ? await getPostById(c.env, existingId) : null;
  if (existingId && !existing) return c.redirect('/admin');

  const { html: rendered } = renderMarkdown(content);
  const summary = get('summary').trim().slice(0, 300) || extractSummary(content);
  const cover = get('cover').trim().slice(0, 500) || extractCover(content);
  const slugInput = slugify(get('slug').trim() || title);
  const wordCount = countWords(content);
  const status = get('status') === 'published' ? 'published' : 'draft';
  const isTop = form.is_top ? 1 : 0;

  let slug = slugInput;
  if (!existing || existing.slug !== slugInput) {
    // slug 去重
    let candidate = slugInput;
    let n = 1;
    for (;;) {
      const clash = await c.env.DB.prepare('SELECT id FROM posts WHERE slug = ?').bind(candidate).first();
      if (!clash || clash.id === existingId) break;
      candidate = `${slugInput}-${++n}`;
    }
    slug = candidate;
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  let postId = existingId;
  if (existing) {
    const publishedAt =
      status === 'published'
        ? existing.published_at || now
        : existing.published_at;
    await c.env.DB.prepare(
      `UPDATE posts SET slug=?, title=?, summary=?, content=?, html=?, cover=?, status=?, is_top=?,
              word_count=?, published_at=?, updated_at=? WHERE id=?`
    )
      .bind(slug, title, summary, content, rendered, cover, status, isTop, wordCount, publishedAt, now, existingId)
      .run();
  } else {
    const res = await c.env.DB.prepare(
      `INSERT INTO posts (slug, title, summary, content, html, cover, status, is_top, word_count, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        slug, title, summary, content, rendered, cover, status, isTop, wordCount,
        status === 'published' ? now : null, now
      )
      .run();
    postId = Number(res.meta.last_row_id);
  }

  await syncTags(c.env, postId, get('tags').split(','));

  return c.redirect(
    `/admin/edit/${postId}?ok=${encodeURIComponent(existing ? '已保存' : '已创建，去 /admin/edit 继续编辑或发布')}`
  );
};

adminRoutes.post('/save', saveHandler);
adminRoutes.post('/save/:id', saveHandler);

/* ------------------------------------------------------------ 删除 */
adminRoutes.post('/delete/:id', async (c) => {
  const form = await c.req.parseBody();
  if (!checkCsrf(c.req.raw, String(form.csrf_token || ''))) return c.redirect('/admin');
  const id = parseInt(c.req.param('id'), 10);
  await c.env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM post_tags)').run();
  return c.redirect(`/admin?ok=${encodeURIComponent('已删除')}`);
});

/* ------------------------------------------------------------ 评论 */
adminRoutes.get('/comments', async (c) => {
  const site = await getSiteConfig(c.env);
  const status = c.req.query('status') || 'pending';
  const allowed = ['pending', 'approved', 'spam', 'all'];
  const s = allowed.includes(status) ? status : 'pending';

  const where = s === 'all' ? '' : 'WHERE c.status = ?';
  const res = await c.env.DB.prepare(
    `SELECT c.*, p.title AS post_title, p.slug AS post_slug
       FROM comments c JOIN posts p ON p.id = c.post_id
       ${where} ORDER BY c.created_at DESC LIMIT 200`
  )
    .bind(...(s === 'all' ? [] : [s]))
    .all<any>();
  const list = res.results || [];

  const counts: Record<string, number> = { pending: 0, approved: 0, spam: 0, all: 0 };
  for (const st of ['pending', 'approved', 'spam']) {
    const r = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM comments WHERE status = ?').bind(st).first<any>();
    counts[st] = r?.c ?? 0;
  }
  const allc = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM comments').first<any>();
  counts.all = allc?.c ?? 0;

  const tabs = (['pending', 'approved', 'spam', 'all'] as const)
    .map(
      (st) =>
        `<a href="/admin/comments?status=${st}" class="tab ${s === st ? 'active' : ''}">${
          { pending: '待审', approved: '已通过', spam: '垃圾', all: '全部' }[st]
        } <i>${counts[st]}</i></a>`
    )
    .join('');

  const rows = list
    .map(
      (cm) => `<tr>
      <td class="t-title">
        <strong>${html(cm.author)}</strong> ${cm.url ? `<a class="muted small" href="${html(cm.url)}" target="_blank" rel="noopener nofollow">↗</a>` : ''}
        <div class="t-slug">${html(cm.body).slice(0, 160)}</div>
      </td>
      <td class="t-date"><a href="/p/${html(cm.post_slug)}" target="_blank">${html((cm.post_title || '').slice(0, 20))}</a></td>
      <td class="t-date">${(cm.created_at || '').slice(5, 16)}</td>
      <td class="t-act">
        <form method="post" action="/admin/comment/${cm.id}/status">
          <input type="hidden" name="csrf_token" value="${html(csrf(c))}">
          <input type="hidden" name="status" value="${cm.status === 'approved' ? 'pending' : 'approved'}">
          <button class="link-btn" type="submit">${cm.status === 'approved' ? '撤回' : '通过'}</button>
        </form>
        <form method="post" action="/admin/comment/${cm.id}/delete">
          <input type="hidden" name="csrf_token" value="${html(csrf(c))}">
          <button class="link-btn danger" type="submit">删</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const inner = `<main class="admin-main">
    <div class="admin-head"><h1>评论</h1></div>
    <div class="tabs">${tabs}</div>
    <table class="admin-table"><thead><tr><th>内容</th><th>文章</th><th>时间</th><th>操作</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="t-empty">没有评论</td></tr>'}</tbody></table>
  </main>`;

  return c.html(adminShell(site, '/admin/comments', csrf(c), c.get('user'), inner, c.req.query('ok') || ''));
});

adminRoutes.post('/comment/:id/status', async (c) => {
  const form = await c.req.parseBody();
  if (!checkCsrf(c.req.raw, String(form.csrf_token || ''))) return c.redirect('/admin/comments');
  const id = parseInt(c.req.param('id'), 10);
  const status = ['pending', 'approved', 'spam'].includes(String(form.status)) ? String(form.status) : 'pending';
  await c.env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run();
  return c.redirect('/admin/comments?ok=' + encodeURIComponent('已更新'));
});

adminRoutes.post('/comment/:id/delete', async (c) => {
  const form = await c.req.parseBody();
  if (!checkCsrf(c.req.raw, String(form.csrf_token || ''))) return c.redirect('/admin/comments');
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(parseInt(c.req.param('id'), 10)).run();
  return c.redirect('/admin/comments?ok=' + encodeURIComponent('已删除'));
});

/* ------------------------------------------------------------ 标签 */
adminRoutes.get('/tags', async (c) => {
  const site = await getSiteConfig(c.env);
  const tags = await allTags(c.env);
  const inner = `<main class="admin-main">
    <div class="admin-head"><h1>标签 <span class="muted">${tags.length} 个</span></h1></div>
    <p class="muted">标签在编辑文章时用「标签」字段管理，逗号分隔。删掉所有文章里的标签会自动清理。</p>
    <div class="tags-cloud">
      ${tags
        .map(
          (t) =>
            `<div class="chip chip-lg">#${html(t.name)} <i>${t.count}</i> <a href="/tag/${html(t.slug)}" target="_blank" title="查看">↗</a></div>`
        )
        .join('') || '<p class="muted">还没有标签</p>'}
    </div>
  </main>`;
  return c.html(adminShell(site, '/admin/tags', csrf(c), c.get('user'), inner, c.req.query('ok') || ''));
});

/* ------------------------------------------------------------ 设置 */
adminRoutes.get('/settings', async (c) => {
  const site = await getSiteConfig(c.env);
  const user = await c.env.DB.prepare('SELECT id, username, created_at FROM users WHERE id = ?')
    .bind((c.get('user') as any).id)
    .first<any>();

  const inner = `<main class="admin-main narrow">
    <div class="admin-head"><h1>站点设置</h1></div>
    <form class="settings-form" method="post" action="/admin/settings">
      <input type="hidden" name="csrf_token" value="${html(csrf(c))}">
      <div class="box">
        <h3>基本信息</h3>
        <label>站点名称<input name="site_name" value="${html(site.siteName)}" maxlength="60"></label>
        <label>副标题<input name="site_tagline" value="${html(site.tagline)}" maxlength="120"></label>
        <label>关于我（支持 Markdown）
          <textarea name="about" rows="8">${html(site.about)}</textarea>
        </label>
        <label>页脚备注<input name="footer_note" value="${html(site.footerNote)}" maxlength="120"></label>
        <label class="check">
          <input type="hidden" name="comment_enabled" value="0">
          <input type="checkbox" name="comment_enabled" value="1" ${site.commentEnabled ? 'checked' : ''}> 开启评论
        </label>
        <button class="btn-primary" type="submit">保存设置</button>
      </div>
    </form>

    <form class="settings-form" method="post" action="/admin/password">
      <input type="hidden" name="csrf_token" value="${html(csrf(c))}">
      <div class="box">
        <h3>修改密码 <span class="muted small">当前账号：${html(user?.username || '')}</span></h3>
        <label>新密码<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>确认新密码<input name="confirm" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn-primary" type="submit">更新密码</button>
      </div>
    </form>

    <div class="box">
      <h3>环境变量（wrangler.jsonc → vars）</h3>
      <p class="muted small">作者信息、社交链接、每页文章数在这里改，改完需要 <code>npm run deploy</code> 生效。</p>
      <ul class="kv">
        <li><code>AUTHOR_NAME</code> = ${html(site.authorName)}</li>
        <li><code>AUTHOR_BIO</code> = ${html(site.authorBio)}</li>
        <li><code>GITHUB_URL</code> = ${html(site.githubUrl || '—')}</li>
        <li><code>EMAIL</code> = ${html(site.email || '—')}</li>
        <li><code>ITEMS_PER_PAGE</code> = ${site.itemsPerPage}</li>
      </ul>
    </div>
  </main>`;

  return c.html(adminShell(site, '/admin/settings', csrf(c), c.get('user'), inner, c.req.query('ok') || ''));
});

adminRoutes.post('/settings', async (c) => {
  const form = await c.req.parseBody();
  if (!checkCsrf(c.req.raw, String(form.csrf_token || ''))) return c.redirect('/admin/settings?err=' + encodeURIComponent('会话已过期'));
  const get = (k: string) => String(form[k] ?? '').slice(0, 2000);
  // checkbox 未勾选时 hidden 先提交 '0'，勾选时同名参数后提交 '1'（后者胜出）
  const submitted = form.comment_enabled;
  const commentOn = Array.isArray(submitted) ? submitted.includes('1') : submitted === '1';
  await saveSettings(c.env, {
    site_name: get('site_name') || 'My Blog',
    site_tagline: get('site_tagline'),
    about: get('about'),
    footer_note: get('footer_note'),
    comment_enabled: commentOn ? '1' : '0',
  });
  return c.redirect('/admin/settings?ok=' + encodeURIComponent('设置已保存'));
});

adminRoutes.post('/password', async (c) => {
  const form = await c.req.parseBody();
  const fail = (m: string) => c.redirect('/admin/settings?err=' + encodeURIComponent(m));
  if (!checkCsrf(c.req.raw, String(form.csrf_token || ''))) return fail('会话已过期');
  const pw = String(form.password || '');
  const confirm = String(form.confirm || '');
  if (pw.length < 8) return fail('密码至少 8 位');
  if (pw !== confirm) return fail('两次输入不一致');

  const user = c.get('user') as any;
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(pw), user.id)
    .run();
  // 改密后使其他会话失效
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, user.token).run();
  return c.redirect('/admin/settings?ok=' + encodeURIComponent('密码已更新，其他设备的登录已失效'));
});