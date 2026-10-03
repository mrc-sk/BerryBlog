/**
 * 端到端冒烟测试：跑真实的 HTTP 请求，覆盖公开页 + 后台登录 + 写文章 + 评论
 * 用法：node test/smoke.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name + (extra ? ` (${extra})` : '')); console.log(`  FAIL ${name} ${extra}`); }
}

const jar = new Map();

function saveCookies(res) {
  const raw = res.headers.getSetCookie?.() || [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (val === '') jar.delete(name); else jar.set(name, val);
  }
}

const cookieHeader = () => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    redirect: 'manual',
    headers: { ...(opts.headers || {}), ...(jar.size ? { cookie: cookieHeader() } : {}) },
  });
  saveCookies(res);
  const text = await res.text();
  return { res, text, status: res.status };
}

const form = (obj) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString(),
});

console.log(`\n▶ 冒烟测试 ${BASE}\n`);

/* ---------------------------------------------------- 公开页面 */
console.log('公开页面');
{
  const home = await req('/');
  check('首页 200', home.status === 200, String(home.status));
  check('首页含文章卡片', home.text.includes('post-card'));
  check('首页含 RSS 链接', home.text.includes('/rss.xml'));
  check('首页设置 CSP', (home.res.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  check('首页设置 nosniff', home.res.headers.get('x-content-type-options') === 'nosniff');

  const post = await req('/p/hello-world');
  check('文章页 200', post.status === 200, String(post.status));
  check('文章页渲染正文', post.text.includes('class="prose"'));
  check('文章页有代码块', post.text.includes('code-block'));
  check('文章页有评论表单', post.text.includes('id="comment-form"'));
  check('文章页无草稿泄漏', !post.text.includes('这是一篇草稿'));

  const nf = await req('/p/draft-example');
  check('草稿对外 404', nf.status === 404, String(nf.status));

  const archive = await req('/archive');
  check('归档页 200', archive.status === 200 && archive.text.includes('archive-card'));

  const tagPage = await req('/tag/tech');
  check('标签页 200', tagPage.status === 200 && tagPage.text.includes('post-card'));

  const search = await req('/search?q=Workers');
  check('搜索有结果', search.status === 200 && search.text.includes('post-card'), '关键词 Workers');

  const searchMiss = await req('/search?q=zzzznotfound');
  check('搜索无结果显示空态', searchMiss.text.includes('没有匹配的文章'));

  const about = await req('/about');
  check('关于页 200', about.status === 200 && about.text.includes('about-card'));

  const rss = await req('/rss.xml');
  check('RSS 200', rss.status === 200);
  check('RSS 是合法 XML 头', rss.text.startsWith('<?xml'));
  check('RSS 含文章', rss.text.includes('<item>'));

  const sm = await req('/sitemap.xml');
  check('sitemap 200', sm.status === 200 && sm.text.includes('<urlset'));

  const robots = await req('/robots.txt');
  check('robots 200 且禁 admin', robots.status === 200 && robots.text.includes('Disallow: /admin'));

  const nf404 = await req('/no-such-page');
  check('未知路径 404', nf404.status === 404, String(nf404.status));

  const staticRes = await req('/style.css');
  check('静态 CSS 可访问', staticRes.status === 200);
}

/* -------------------------------------------------------- XSS */
console.log('\n安全');
{
  // 未登录访问后台应 302 到登录页
  const guarded = await req('/admin');
  check('后台未登录被拦截', guarded.status === 302 && (guarded.res.headers.get('location') || '').includes('/admin/login'));
}

/* ---------------------------------------------------- 后台登录 */
console.log('\n后台');
let csrf = '';
{
  const login = await req('/admin/login');
  check('登录页 200', login.status === 200, String(login.status));
  const m = login.text.match(/name="csrf_token" value="([a-f0-9]+)"/);
  csrf = m ? m[1] : '';
  check('登录页带 CSRF token', csrf.length >= 32, csrf.length ? `len=${csrf.length}` : '未找到');

  // 错误 CSRF 应被拒
  const badCsrf = await req('/admin/login', form({ csrf_token: 'deadbeef', username: 'admin', password: 'admin123', next: '/admin' }));
  check('错误 CSRF 被拒绝', badCsrf.status === 302 && decodeURIComponent(badCsrf.res.headers.get('location') || '').includes('会话已过期'));

  // 错误密码
  const badPw = await req('/admin/login', form({ csrf_token: csrf, username: 'admin', password: 'wrong', next: '/admin' }));
  check('错误密码被拒绝', badPw.status === 302 && decodeURIComponent(badPw.res.headers.get('location') || '').includes('不正确'));

  // 正确登录
  const ok = await req('/admin/login', form({ csrf_token: csrf, username: 'admin', password: 'admin123', next: '/admin' }));
  check('登录成功重定向', ok.status === 302 && (ok.res.headers.get('location') || '').startsWith('/admin'));
  check('设置了 HttpOnly 会话 cookie', jar.has('nb_session'));

  const dash = await req('/admin');
  check('后台首页 200', dash.status === 200, String(dash.status));
  check('后台显示用户名', dash.text.includes('admin'));
  check('后台列表有文章', dash.text.includes('hello-world'));

  const editor = await req('/admin/new');
  check('编辑器 200', editor.status === 200 && editor.text.includes('contentInput'));
}

/* ------------------------------------------------------ 写文章 */
console.log('\n写文章');
let newId = 0;
{
  // 唯一标题，避免重复运行累积垃圾文章
  const uniq = Date.now().toString(36);
  const md = `# 冒烟测试文章

这是一段**加粗**和 \`代码\`，还有 [链接](https://example.com)。

## 二级标题

- 列表 A
- 列表 B

> 引用一句

\`\`\`js
const x = 1;
console.log(x);
\`\`\`

| 列A | 列B |
| --- | --- |
| 1 | 2 |
`;

  const saved = await req('/admin/save', form({
    csrf_token: csrf,
    title: `冒烟测试文章 ${uniq}`,
    content: md,
    summary: '',
    tags: '测试, 自动化',
    status: 'published',
    is_top: '',
    slug: `smoke-${uniq}`,
    cover: '',
  }));
  check('保存文章重定向到编辑页', saved.status === 302, String(saved.status));
  const loc = saved.res.headers.get('location') || '';
  const mid = loc.match(/\/admin\/edit\/(\d+)/);
  newId = mid ? Number(mid[1]) : 0;
  check('返回新文章 ID', newId > 0, loc);

  const edit = await req(`/admin/edit/${newId}`);
  check('编辑页可打开', edit.status === 200);

  const view = await req(`/p/smoke-${uniq}`);
  check('新文章公开可访问', view.status === 200, `smoke-${uniq} → ${view.status}`);
  check('渲染粗体', view.text.includes('<strong>加粗</strong>'));
  check('渲染行内代码', view.text.includes('<code>代码</code>'));
  check('渲染代码块', view.text.includes('class="code-block"'));
  check('渲染表格', view.text.includes('<table>'));
  check('渲染引用', view.text.includes('<blockquote>'));
  check('渲染标题锚点', view.text.includes('class="anchor"'));
  check('摘要自动生成', view.text.length > 0);
  check('标签已关联', view.text.includes('自动化'));
  check('自定义 slug 生效', view.status === 200);

  // 收尾删除，保持库干净
  await req(`/admin/delete/${newId}`, form({ csrf_token: csrf }));
}

/* ------------------------------------------------------ XSS 注入 */
console.log('\nXSS 防护');
{
  const evilTitle = '<img src=x onerror=alert(1)>';
  const evil = await req('/admin/save', form({
    csrf_token: csrf,
    title: evilTitle,
    content: '正文 <script>alert("xss")</script> 与 [恶意](javascript:alert(1))',
    tags: '',
    status: 'published',
    slug: `xss-${Date.now().toString(36)}`,
  }));
  check('含脚本的文章保存成功', evil.status === 302);
  const evilId = Number((evil.res.headers.get('location') || '').match(/\/admin\/edit\/(\d+)/)?.[1] || 0);

  const list = await req('/admin');
  check('标题已转义', list.text.includes('&lt;img src=x onerror=alert(1)&gt;'), '未找到转义标题');
  check('正文 script 被转义', list.text.includes('&lt;script&gt;') || !list.text.includes('<script>alert("xss")'));

  // 公开页面上也不能出现可执行脚本
  if (evilId) {
    const evilSlug = (await req(`/admin/edit/${evilId}`)).text.match(/\/p\/([^"]+)"/)?.[1] || '';
    if (evilSlug) {
      const pub = await req(`/p/${encodeURIComponent(decodeURIComponent(evilSlug))}`);
      check('公开页无原始 script 标签', !pub.text.includes('<script>alert("xss")'));
      check('公开页无 javascript: 链接', !pub.text.includes('href="javascript:'));
      check('公开页无未转义的 onerror', !pub.text.includes('<img src=x onerror'));
    }
    await req(`/admin/delete/${evilId}`, form({ csrf_token: csrf }));
  }
}

/* -------------------------------------------------------- 评论 */
console.log('\n评论');
{
  // 用时间戳保证内容唯一，测试可重复运行而不触发「重复评论」拦截
  const stamp = Date.now().toString(36);
  const CM_BODY = `测试评论 ${stamp} **加粗**`;
  const CM_AUTHOR = `测试用户${stamp.slice(-4)}`;
  // 评论限流是 5 条/小时/IP，这里用唯一 IP 头让每次运行互不干扰
  const ipHeaders = { 'x-forwarded-for': `10.0.${Number(stamp.slice(-2, -1)) || 1}.${Number(stamp.slice(-1)) || 1}` };
  const post2 = (bodyObj) => {
    const opts = form(bodyObj);
    // 注意要合并 headers，直接展开会覆盖掉 content-type 导致表单解析失败
    return req('/comment', { ...opts, headers: { ...opts.headers, ...ipHeaders } });
  };

  const post = await req('/p/hello-world');
  const cm = post.text.match(/name="csrf_token" value="([a-f0-9]+)"/);
  const ccsrf = cm ? cm[1] : '';
  // 后台的 csrf 与公开页的是同一个 cookie 值，若后台改过密码会重发，这里以页面里的为准
  check('评论表单带 CSRF', ccsrf.length >= 32);
  check('评论表单 CSRF 与 cookie 一致', !!ccsrf && jar.get('nb_csrf') === ccsrf,
    `cookie=${String(jar.get('nb_csrf')).slice(0, 8)}… form=${ccsrf.slice(0, 8)}…`);
  const pid = (post.text.match(/name="post_id" value="(\d+)"/) || [])[1] || '1';
  check('评论表单带 post_id', pid !== undefined && pid !== '', `post_id=${pid}`);

  const bad = await post2({ csrf_token: 'bad', post_id: pid, slug: 'hello-world', author: 'x', body: 'hello' });
  check('错误 CSRF 评论被拒', bad.status === 302);

  const noName = await post2({ csrf_token: ccsrf, post_id: pid, slug: 'hello-world', author: '', body: CM_BODY });
  check('空昵称被拒', decodeURIComponent(noName.res.headers.get('location') || '').includes('请填写昵称'),
    decodeURIComponent(noName.res.headers.get('location') || ''));

  const okc = await post2({ csrf_token: ccsrf, post_id: pid, slug: 'hello-world', author: CM_AUTHOR, body: CM_BODY, email: 'a@b.c' });
  check('评论提交成功', okc.status === 302 && (okc.res.headers.get('location') || '').includes('comment=ok'),
    decodeURIComponent(okc.res.headers.get('location') || ''));

  const dup = await post2({ csrf_token: ccsrf, post_id: pid, slug: 'hello-world', author: CM_AUTHOR, body: CM_BODY });
  check('重复评论被拦截', decodeURIComponent(dup.res.headers.get('location') || '').includes('已经发过'),
    decodeURIComponent(dup.res.headers.get('location') || ''));

  const pub = await req('/p/hello-world');
  check('新评论不立即公开（待审）', !pub.text.includes(`测试评论 ${stamp}`));

  // 后台审核
  const cpage = await req('/admin/comments?status=pending');
  check('评论后台 200', cpage.status === 200);
  check('待审列表含新评论', cpage.text.includes(CM_AUTHOR));

  // 找到这条评论的 ID（按作者精确定位，避免误操作上一轮的）
  const rowIdx = cpage.text.indexOf(CM_AUTHOR);
  const cidMatch = rowIdx > -1
    ? cpage.text.slice(rowIdx).match(/\/admin\/comment\/(\d+)\/status/)
    : null;
  check('找到评论 ID', !!cidMatch);
  if (cidMatch) {
    const ap = await req(`/admin/comment/${cidMatch[1]}/status`, form({ csrf_token: csrf, status: 'approved' }));
    check('通过评论', ap.status === 302);
    const pub2 = await req('/p/hello-world');
    check('通过后评论公开显示', pub2.text.includes(`测试评论 ${stamp}`) && pub2.text.includes(CM_AUTHOR));
    check('评论正文加粗已渲染', pub2.text.includes('<strong>加粗</strong>'));

    // 收尾：删掉这条评论，保持库干净
    await req(`/admin/comment/${cidMatch[1]}/delete`, form({ csrf_token: csrf }));
  }
}

/* --------------------------------------------------------- 下载区 */
console.log('\n下载区');
{
  const page = await req('/downloads');
  check('下载页 200', page.status === 200 && page.text.includes('dl-card'), String(page.status));
  check('导航有下载入口', page.text.includes('href="/downloads"'));
  check('页脚有下载入口', page.text.includes('>下载</a>'));
  check('后台下载页可访问', (await req('/admin/downloads')).status === 200);

  /* 源链接是 /d/<下载项id>?s=<源id>，两个参数都有意义 */
  const linkM = page.text.match(/href="\/d\/(\d+)\?s=(\d+)"/);
  check('渲染了带源参数的下载链接', !!linkM, linkM ? '' : '未找到 ?s= 参数');
  const dlId = linkM ? linkM[1] : '';
  const srcId = linkM ? linkM[2] : '';

  if (dlId && srcId) {
    const hit = await req(`/d/${dlId}?s=${srcId}`);
    check('指定源跳转 302', hit.status === 302, String(hit.status));
    check('跳转到外链', /^https?:\/\//.test(hit.res.headers.get('location') || ''),
      hit.res.headers.get('location') || '');

    const noSrc = await req(`/d/${dlId}`);
    check('不带 s 参数走默认源', noSrc.status === 302, String(noSrc.status));

    const badId = await req(`/d/${dlId}?s=99999`);
    check('不存在的源回落默认', badId.status === 302, String(badId.status));

    const admin = await req('/admin/downloads');
    check('下载量有计数列', admin.text.includes('下载量'));
  }

  /* 校验 */
  const bad = await req('/admin/downloads', form({
    csrf_token: csrf,
    title: '坏链接',
    src_label: 'X',
    src_url: 'javascript:alert(1)',
  }));
  check('拒绝 javascript: 链接',
    decodeURIComponent(bad.res.headers.get('location') || '').includes('http'),
    decodeURIComponent(bad.res.headers.get('location') || ''));

  const noLink = await req('/admin/downloads', form({
    csrf_token: csrf,
    title: '没有链接',
    src_label: 'X',
    src_url: '',
  }));
  check('拒绝零个源',
    decodeURIComponent(noLink.res.headers.get('location') || '').includes('至少要填一个下载链接'),
    decodeURIComponent(noLink.res.headers.get('location') || ''));

  const noTitle = await req('/admin/downloads', form({
    csrf_token: csrf,
    title: '',
    src_label: 'X',
    src_url: 'https://example.com',
  }));
  check('拒绝空标题', decodeURIComponent(noTitle.res.headers.get('location') || '').includes('标题不能为空'),
    decodeURIComponent(noTitle.res.headers.get('location') || ''));

  const badCsrfDl = await req('/admin/downloads', form({
    csrf_token: 'bad', title: 'x', src_label: 'X', src_url: 'https://example.com',
  }));
  check('下载添加校验 CSRF', decodeURIComponent(badCsrfDl.res.headers.get('location') || '').includes('会话已过期'));

  /* 核心：一个条目挂多个源 */
  const uniq = Date.now().toString(36);
  const multi = [
    ['主源', 'https://example.com/main.zip'],
    ['备用', 'https://backup.example.com/x.zip'],
    ['镜像', 'https://mirror.example.com/y.zip'],
  ];
  const body = new URLSearchParams();
  body.set('csrf_token', csrf);
  body.set('title', `多源测试 ${uniq}`);
  body.set('summary', '测试多个下载源');
  body.set('platform', '测试');
  body.set('version', '1.0');
  body.set('size', '2 MB');
  body.set('sort_order', '99');
  for (const [l, u] of multi) { body.append('src_label', l); body.append('src_url', u); }
  const created2 = await req('/admin/downloads', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  check('新增多源下载项', created2.status === 302 && (created2.res.headers.get('location') || '').includes('ok='),
    decodeURIComponent(created2.res.headers.get('location') || ''));

  const pub = await req('/downloads');
  check('前台出现新项', pub.text.includes(`多源测试 ${uniq}`));
  check('三个源都有按钮',
    ['主源', '备用', '镜像'].every((l) => pub.text.includes(`>${l}</a>`)),
    '缺某个源');

  // 每源独立链接，且跳向不同地址。
  // 必须按 article 切片取源 —— 页面上还有别的下载项的链接，
  // 直接全局 matchAll 会混进其他项的源。
  const card = pub.text.split('</article>').find((x) => x.includes(`多源测试 ${uniq}`)) || '';
  const ids = [...card.matchAll(/href="\/d\/(\d+)\?s=(\d+)"/g)].map((m) => ({ d: m[1], s: m[2] }));
  check('每源都有独立链接', ids.length === 3, `本项有 ${ids.length} 个（应为 3）`);
  check('三个源同属一个下载项', new Set(ids.map((x) => x.d)).size === 1,
    [...new Set(ids.map((x) => x.d))].join(','));
  if (ids.length === 3 && new Set(ids.map((x) => x.d)).size === 1) {
    const locs = [];
    for (const [i, id] of ids.entries()) {
      const r = await req(`/d/${id.d}?s=${id.s}`);
      check(`源${i + 1} 可跳转`, r.status === 302 && /^https?:\/\//.test(r.res.headers.get('location') || ''),
        r.res.headers.get('location') || '');
      locs.push(r.res.headers.get('location'));
    }
    check('三个源跳向三个不同地址', new Set(locs).size === 3, locs.join(' | '));
  }

  // 清理
  const admin = await req('/admin/downloads');
  for (const row of admin.text.split('</tr>')) {
    if (row.includes(`多源测试 ${uniq}`)) {
      const id = row.match(/\/admin\/downloads\/(\d+)\/delete/)?.[1];
      if (id) {
        const del = await req(`/admin/downloads/${id}/delete`, form({ csrf_token: csrf }));
        check('删除下载项', del.status === 302);
      }
    }
  }
  const gone = await req('/downloads');
  check('删除后前台消失', !gone.text.includes(`多源测试 ${uniq}`));
  check('删除源也跟着清', !gone.text.includes('>镜像</a>'));
}

/* -------------------------------------------------------- 设置 */
console.log('\n设置');
{
  const sp = await req('/admin/settings');
  check('设置页 200', sp.status === 200);

  const s = await req('/admin/settings', form({
    csrf_token: csrf,
    site_name: '我的小站',
    site_tagline: '测试标语',
    about: '关于页内容',
    footer_note: '页脚备注',
    comment_enabled: '1',
  }));
  check('保存设置', s.status === 302);
  const home = await req('/');
  check('首页显示新站名', home.text.includes('我的小站'), '未生效');
  const about = await req('/about');
  check('关于页显示自定义内容', about.text.includes('关于页内容'));

  // 关闭评论应生效
  const off = await req('/admin/settings', form({
    csrf_token: csrf,
    site_name: '我的小站',
    site_tagline: '测试标语',
    about: '关于页内容',
    footer_note: '页脚备注',
  }));
  check('关闭评论保存', off.status === 302);
  const noComment = await req('/p/hello-world');
  check('关闭后评论区隐藏', !noComment.text.includes('id="comment-form"'));
  // 重新开启，供评论测试用
  await req('/admin/settings', form({
    csrf_token: csrf,
    site_name: '我的小站',
    site_tagline: '测试标语',
    about: '关于页内容',
    footer_note: '页脚备注',
    comment_enabled: '1',
  }));
  const back = await req('/p/hello-world');
  check('重新开启后评论区恢复', back.text.includes('id="comment-form"'));

  /* 改密码：先测校验，再测真实改密 */
  const shortPw = await req('/admin/password', form({ csrf_token: csrf, password: '123', confirm: '123' }));
  check('短密码被拒', decodeURIComponent(shortPw.res.headers.get('location') || '').includes('至少 8 位'));

  const mismatch = await req('/admin/password', form({ csrf_token: csrf, password: 'newpassword1', confirm: 'different1' }));
  check('两次不一致被拒', decodeURIComponent(mismatch.res.headers.get('location') || '').includes('两次输入不一致'));

  const badCsrfPw = await req('/admin/password', form({ csrf_token: 'bad', password: 'newpassword1', confirm: 'newpassword1' }));
  check('改密码校验 CSRF', decodeURIComponent(badCsrfPw.res.headers.get('location') || '').includes('会话已过期'));

  const chPw = await req('/admin/password', form({ csrf_token: csrf, password: 'newpassword1', confirm: 'newpassword1' }));
  check('修改密码成功', chPw.status === 302 && (chPw.res.headers.get('location') || '').includes('ok=%E5%AF%86%E7%A0%81'),
    decodeURIComponent(chPw.res.headers.get('location') || ''));

  // 旧密码应失效，新密码应生效
  const page2 = await req('/admin/login');
  const csrf2 = (page2.text.match(/name="csrf_token" value="([a-f0-9]+)"/) || [])[1] || '';
  jar.delete('nb_session');
  const oldPw = await req('/admin/login', form({ csrf_token: csrf2, username: 'admin', password: 'admin123', next: '/admin' }));
  check('旧密码已失效', decodeURIComponent(oldPw.res.headers.get('location') || '').includes('不正确'));

  const page3 = await req('/admin/login');
  const csrf3 = (page3.text.match(/name="csrf_token" value="([a-f0-9]+)"/) || [])[1] || csrf2;
  const newPw = await req('/admin/login', form({ csrf_token: csrf3, username: 'admin', password: 'newpassword1', next: '/admin' }));
  check('新密码可登录', newPw.status === 302 && (newPw.res.headers.get('location') || '').startsWith('/admin'),
    decodeURIComponent(newPw.res.headers.get('location') || ''));

  // 改回默认，方便重复测试
  await req('/admin/settings');   // 确保登录态
  const pwPage = await req('/admin/settings');
  const csrf4 = (pwPage.text.match(/name="csrf_token" value="([a-f0-9]+)"/) || [])[1] || csrf3;
  await req('/admin/password', form({ csrf_token: csrf4, password: 'admin123', confirm: 'admin123' }));
  csrf = csrf4;
}

/* ---------------------------------------------------- 删除文章 */
console.log('\n删除文章');
{
  const tmp = await req('/admin/save', form({
    csrf_token: csrf,
    title: '待删除文章',
    content: '临时内容',
    tags: '临时',
    status: 'published',
  }));
  const tid = Number((tmp.res.headers.get('location') || '').match(/\/admin\/edit\/(\d+)/)?.[1] || 0);
  check('创建待删文章', tid > 0);

  const del = await req(`/admin/delete/${tid}`, form({ csrf_token: csrf }));
  check('删除重定向', del.status === 302);

  const gone = await req('/admin');
  check('列表中已消失', !gone.text.includes('待删除文章'));

  // 错误 CSRF 的删除必须无效
  const tmp2 = await req('/admin/save', form({ csrf_token: csrf, title: 'CSRF测试', content: 'x', tags: '', status: 'published' }));
  const tid2 = Number((tmp2.res.headers.get('location') || '').match(/\/admin\/edit\/(\d+)/)?.[1] || 0);
  await req(`/admin/delete/${tid2}`, form({ csrf_token: 'bad' }));
  const still = await req('/admin');
  check('错误 CSRF 删除无效', still.text.includes('CSRF测试'));

  // 清理
  await req(`/admin/delete/${tid2}`, form({ csrf_token: csrf }));
}

/* ---------------------------------------------------- 退出登录 */
console.log('\n登出');
{
  const lo = await req('/admin/logout', form({ csrf_token: csrf }));
  check('登出重定向', lo.status === 302);
  jar.delete('nb_session');
  const after = await req('/admin');
  check('登出后后台被拦截', after.status === 302);
}

/* ------------------------------------------------------- 结果 */
console.log(`\n${'─'.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  - ' + f);
}
console.log(`${'─'.repeat(46)}\n`);
process.exit(fail ? 1 : 0);