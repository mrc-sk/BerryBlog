-- ============================================
-- 种子数据：默认管理员 + 3 篇示例文章 + 1 篇草稿
--
-- 默认账号：admin / admin123  ← 部署后请立刻在 /admin/settings 修改密码
-- 密码算法：PBKDF2-SHA256，100000 轮，格式 pbkdf2_sha256$轮数$salt$hash
--   重置密码：node test/gen-hash.mjs <新密码>
--
-- html 字段一律留空：运行时会用 src/lib/markdown.ts 的真实渲染器自动补齐
-- （见 db.ts 的 backfillHtml），这样改渲染器不必重写 SQL。
-- ============================================

INSERT OR IGNORE INTO users (username, password_hash) VALUES
  ('admin', 'pbkdf2_sha256$100000$f53363a5ee87d9f395add8843c4fdf7e$f2257e2d8571f9ded720df8bbffd5e5de0968fa5a3bdcfe833b3931a14d8df07');

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
    '## 起点

这是一个跑在 **Cloudflare Workers** 上的博客，数据存在 D1 里。

- 支持 Markdown
- 支持标签与归档
- 自带管理后台
- 自带评论

> 所谓成长，就是把踩过的坑记下来。

```js
console.log("hello world");
```

## 接下来

1. 写点什么
2. 部署上线
3. 忘了更新
',
    '',
    'published',
    1,
    42,
    120,
    datetime('now', '-3 days')
  ),
  (
    'why-workers',
    '为什么选择 Workers 而不是传统服务器',
    '免运维、免费额度够用、全球边缘分发。三个理由。',
    '## 传统服务器的麻烦

买机器、装环境、配证书、盯日志……博客而已，不至于。

## Workers 的优势

1. **无需服务器**：推代码即上线
2. **D1 数据库**：SQLite，够用且免费
3. **边缘分发**：全球节点响应快

```js
export default {
  async fetch(request, env) {
    return new Response("hello from the edge");
  }
};
```

## 代价

没有 Node 原生模块，生态要自己挑。博客场景完全可以接受。
',
    '',
    'published',
    0,
    128,
    210,
    datetime('now', '-1 days')
  ),
  (
    'markdown-cheatsheet',
    '我常用的 Markdown 速查',
    '写博客够用的那部分语法，就这些。',
    '## 基础

**粗体**、*斜体*、~~删除线~~、`行内代码`。

> 引用块

## 代码

```python
def hello():
    print("hi")
```

## 其他

- [x] 任务列表
- 链接：[Anthropic](https://anthropic.com)
- 图片：`![alt](url)`

就这些，剩下的靠回忆。
',
    '',
    'published',
    0,
    76,
    180,
    datetime('now', '-10 hours')
  ),
  (
    'draft-example',
    '这是一篇草稿',
    '公开页面看不到它。',
    '草稿内容，只有登录后可见。

- 待审核的内容
- 可以随时改
',
    '',
    'draft',
    0,
    0,
    0,
    NULL
  );

INSERT OR IGNORE INTO post_tags (post_id, tag_id)
  SELECT p.id, t.id FROM posts p, tags t
  WHERE (p.slug = 'hello-world' AND t.slug = 'essay')
     OR (p.slug = 'why-workers' AND t.slug IN ('tech','cloudflare'))
     OR (p.slug = 'markdown-cheatsheet' AND t.slug IN ('tech','essay'));

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name', 'Nova''s Blog'),
  ('site_tagline', '写代码，也写字'),
  ('about', '这里是我的小站。左边是我，右边也是我。'),
  ('footer_note', '用 Hono + Workers + D1 搭建'),
  ('comment_enabled', '1');