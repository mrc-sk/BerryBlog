-- ============================================
-- 种子数据：默认管理员 + 3 篇示例文章 + 1 篇草稿
--
-- ⚠️ 本文件由 test/gen-seed.mjs 生成，不要手改。
--    手写 SQL 很容易把 markdown 里的真实换行写进字符串字面量，
--    导致线上静默插入 0 行（本地却看不出来）。
--    改内容请改 test/gen-seed.mjs 后重新运行它。
--
-- 默认账号：admin / admin123  ← 部署后请立刻在 /admin/settings 改
--
-- html 字段一律留空：运行时由 src/lib/db.ts 的 backfillHtml()
-- 用真实渲染器自动补齐，改渲染器不必重写 SQL。
-- ============================================

INSERT OR IGNORE INTO users (username, password_hash) VALUES
  ('admin', 'pbkdf2_sha256$100000$65619dfe2c0c1575a167a6fc235b0ca5$718dd5c350322945095c1f609b2aa9c616005fc8513b716b2d3cb6a8715e5833');

INSERT OR IGNORE INTO tags (name, slug) VALUES
  ('技术', 'tech'),
  ('随笔', 'essay'),
  ('Cloudflare', 'cloudflare');

INSERT OR IGNORE INTO posts
  (slug, title, summary, content, html, status, is_top, views, word_count, published_at)
VALUES
  (
    'hello-world',
    '你好，世界',
    '开博客的第一篇，先把 Hello World 写在这里。',
    '## 起点' || char(10) || '' || char(10) || '这是一个跑在 **Cloudflare Workers** 上的博客，数据存在 D1 里。' || char(10) || '' || char(10) || '- 支持 Markdown' || char(10) || '- 支持标签与归档' || char(10) || '- 自带管理后台' || char(10) || '- 自带评论' || char(10) || '' || char(10) || '> 所谓成长，就是把踩过的坑记下来。' || char(10) || '' || char(10) || '```js' || char(10) || 'console.log("hello world");' || char(10) || '```' || char(10) || '' || char(10) || '## 接下来' || char(10) || '' || char(10) || '1. 写点什么' || char(10) || '2. 部署上线' || char(10) || '3. 忘了更新',
    '',
    'published',
    1,
    42,
    0,
    datetime('now', '-3 days')
  ),
  (
    'why-workers',
    '为什么选择 Workers 而不是传统服务器',
    '免运维、免费额度够用、全球边缘分发。三个理由。',
    '## 传统服务器的麻烦' || char(10) || '' || char(10) || '买机器、装环境、配证书、盯日志……博客而已，不至于。' || char(10) || '' || char(10) || '## Workers 的优势' || char(10) || '' || char(10) || '1. **无需服务器**：推代码即上线' || char(10) || '2. **D1 数据库**：SQLite，够用且免费' || char(10) || '3. **边缘分发**：全球节点响应快' || char(10) || '' || char(10) || '```js' || char(10) || 'export default {' || char(10) || '  async fetch(request, env) {' || char(10) || '    return new Response("hello from the edge");' || char(10) || '  }' || char(10) || '};' || char(10) || '```' || char(10) || '' || char(10) || '## 代价' || char(10) || '' || char(10) || '没有 Node 原生模块，生态要自己挑。博客场景完全可以接受。',
    '',
    'published',
    0,
    128,
    0,
    datetime('now', '-1 days')
  ),
  (
    'markdown-cheatsheet',
    '我常用的 Markdown 速查',
    '写博客够用的那部分语法，就这些。',
    '## 基础' || char(10) || '' || char(10) || '**粗体**、*斜体*、~~删除线~~、`行内代码`。' || char(10) || '' || char(10) || '> 引用块' || char(10) || '' || char(10) || '## 代码' || char(10) || '' || char(10) || '```python' || char(10) || 'def hello():' || char(10) || '    print("hi")' || char(10) || '```' || char(10) || '' || char(10) || '## 其他' || char(10) || '' || char(10) || '- [x] 任务列表' || char(10) || '- 链接：[Anthropic](https://anthropic.com)' || char(10) || '- 图片：`![alt](url)`' || char(10) || '' || char(10) || '就这些，剩下的靠回忆。',
    '',
    'published',
    0,
    76,
    0,
    datetime('now', '-10 hours')
  ),
  (
    'draft-example',
    '这是一篇草稿',
    '公开页面看不到它。',
    '草稿内容，只有登录后可见。' || char(10) || '' || char(10) || '- 待审核的内容' || char(10) || '- 可以随时改',
    '',
    'draft',
    0,
    0,
    0,
    NULL
  );

INSERT OR IGNORE INTO post_tags (post_id, tag_id)
  SELECT p.id, t.id FROM posts p, tags t
 WHERE     (p.slug = 'hello-world' AND t.slug = 'essay')
    OR     (p.slug = 'why-workers' AND t.slug IN ('tech','cloudflare'))
    OR     (p.slug = 'markdown-cheatsheet' AND t.slug IN ('tech','essay'));

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name', 'BerrywingBlog'),
  ('site_tagline', '写代码，训ai，用ai'),
  ('about', '这里是我的小站，左边是我，右边也是我。'),
  ('footer_note', '赞助我吧 https://afdian.com/a/Berrywing'),
  ('comment_enabled', '1');
