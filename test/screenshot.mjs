/**
 * 用系统 Edge 截图，验证页面视觉效果。
 * 用法：node test/screenshot.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const shots = [
  { name: 'home-light',    url: '/',                     theme: 'light', w: 1280, h: 900, full: true },
  { name: 'home-dark',     url: '/',                     theme: 'dark',  w: 1280, h: 900, full: true },
  { name: 'post-light',    url: '/p/why-workers',        theme: 'light', w: 1280, h: 1000, full: true },
  { name: 'post-dark',     url: '/p/why-workers',        theme: 'dark',  w: 1280, h: 1000, full: true },
  { name: 'mobile-home',   url: '/',                     theme: 'light', w: 390,  h: 844,  full: true },
  { name: 'archive',       url: '/archive',              theme: 'light', w: 1280, h: 800,  full: true },
  { name: 'tags',          url: '/tags',                 theme: 'light', w: 1280, h: 700,  full: false },
  { name: 'about',         url: '/about',                theme: 'light', w: 1280, h: 800,  full: true },
  { name: 'login',         url: '/admin/login',          theme: 'light', w: 1280, h: 720,  full: false },
  { name: 'search',        url: '/search?q=Workers',     theme: 'light', w: 1280, h: 800,  full: true },
];

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

for (const s of shots) {
  await page.setViewportSize({ width: s.w, height: s.h });
  await page.goto(BASE + s.url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) {}
  }, s.theme);
  await page.waitForTimeout(500);
  const file = resolve(OUT, `${s.name}.png`);
  await page.screenshot({ path: file, fullPage: s.full });
  console.log('✓', s.name, '→', file);
}

/* 后台需要登录，单独一个 context */
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const ap = await adminCtx.newPage();
await ap.goto(BASE + '/admin/login', { waitUntil: 'domcontentloaded' });
await ap.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await ap.fill('[name=username]', 'admin');
await ap.fill('[name=password]', 'admin123');
await ap.screenshot({ path: resolve(OUT, 'admin-login.png') });
console.log('✓ admin-login');

await ap.click('button[type=submit]');
await ap.waitForLoadState('domcontentloaded');
await ap.waitForTimeout(600);
await ap.screenshot({ path: resolve(OUT, 'admin-list.png') });
console.log('✓ admin-list');

await ap.goto(BASE + '/admin/new', { waitUntil: 'domcontentloaded' });
await ap.fill('.title-input', '用 Markdown 写点东西');
await ap.fill('#contentInput', '## 二级标题\n\n这是**加粗**、`行内代码`，还有[链接](https://cloudflare.com)。\n\n- 列表项一\n- 列表项二\n\n> 引用块\n\n```js\nconst blog = "Workers + D1";\nconsole.log(blog);\n```\n\n| 特性 | 状态 |\n| --- | --- |\n| 后台 | ✓ |\n| 评论 | ✓ |\n');
await ap.waitForTimeout(400);
await ap.screenshot({ path: resolve(OUT, 'admin-editor.png') });
console.log('✓ admin-editor');

await ap.click('.editor-side .btn-ghost');
await ap.waitForTimeout(500);
await ap.screenshot({ path: resolve(OUT, 'admin-preview.png') });
console.log('✓ admin-preview');

await ap.goto(BASE + '/admin/comments', { waitUntil: 'domcontentloaded' });
await ap.waitForTimeout(300);
await ap.screenshot({ path: resolve(OUT, 'admin-comments.png') });
console.log('✓ admin-comments');

await ap.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded' });
await ap.waitForTimeout(300);
await ap.screenshot({ path: resolve(OUT, 'admin-settings.png'), fullPage: true });
console.log('✓ admin-settings');

await browser.close();
console.log('\n全部截图完成 →', OUT);