import { Hono } from 'hono';
import type { Env } from './types';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { getSiteConfig } from './lib/db';

const app = new Hono<{ Bindings: Env }>();

/* 安全响应头 */
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
});

/* 静态资源交给 Assets binding */
app.get('/app.js', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/theme-init.js', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/admin.js', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/style.css', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/admin.css', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/favicon.svg', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/og.svg', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/manifest.webmanifest', (c) => c.env.ASSETS.fetch(c.req.raw));
// 注意：/robots.txt 由 publicRoutes 动态生成（带 sitemap 地址），不要在此劫持

app.route('/', publicRoutes);
app.route('/admin', adminRoutes);

/* 定期清理过期会话（Workers 每次唤醒都跑，成本极低） */
app.get('/__cron/cleanup', async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  await c.env.DB.prepare("DELETE FROM rate_limits WHERE window_from < datetime('now','-2 day')").run();
  return c.text('ok');
});

app.onError((err, c) => {
  console.error('Error:', err);
  return c.html(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>出错了</title><link rel="stylesheet" href="/style.css"></head>
     <body class="nf-body"><div class="nf"><h1>500</h1><p>服务器出了点问题，稍后再试。</p>
     <a class="btn-primary" href="/">回首页</a></div></body></html>`,
    500
  );
});

export default app;
export { getSiteConfig };