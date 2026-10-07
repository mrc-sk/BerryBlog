/**
 * 生成 schema/seed.sql —— 正确处理 SQL 字符串里的换行与引号转义。
 *
 * 为什么需要这个脚本：手写 SQL 时把 markdown 里的真实换行直接写进单引号字符串里，
 * 本地 D1 可能容错，但线上会静默插入 0 行（曾踩过：users/settings 写进去了，
 * posts/tags 全部为 0）。这里统一把 \n 转成字面量 \\n，双引号转成 ''。
 *
 * 用法：node test/gen-seed.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/* 用真实的密码哈希生成器，与 lib/crypto.ts 保持一致 */
const tmp = resolve(root, '.tmp-crypto.mjs');
await build({
  entryPoints: [resolve(root, 'src/lib/crypto.ts')],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
const { hashPassword } = await import('file://' + tmp.replace(/\\/g, '/'));
const PASSWORD_HASH = await hashPassword('admin123');

/**
 * SQL 字面量转义：单引号 → ''，反斜杠原样。
 * 换行不能转成 \n——SQLite 不认 C 风格转义，会原样存成反斜杠+n。
 * 含换行的字符串改用 char(10)拼接（见 multiline()）。
 */
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

/**
 * 生成含换行的 SQL 表达式：'第一行' || char(10) || '第二行' || char(10) || ...
 * 逐行 split + join，每段都走标准引号转义，换行由 char(10) 承担。
 */
const NL = 'char(10)';
const multiline = (text) => {
  const parts = String(text).split('\n').map(q);
  return parts.length === 1 ? parts[0] : parts.join(` || ${NL} || `);
};

/* ---------------------------------------------------------- 文章数据 */
const posts = [
  {
    slug: 'hello-world',
    title: '你好，世界',
    summary: '开博客的第一篇，先把 Hello World 写在这里。',
    content: [
      '## 起点',
      '',
      '这是一个跑在 **Cloudflare Workers** 上的博客，数据存在 D1 里。',
      '',
      '- 支持 Markdown',
      '- 支持标签与归档',
      '- 自带管理后台',
      '- 自带评论',
      '',
      '> 所谓成长，就是把踩过的坑记下来。',
      '',
      '```js',
      'console.log("hello world");',
      '```',
      '',
      '## 接下来',
      '',
      '1. 写点什么',
      '2. 部署上线',
      '3. 忘了更新',
    ].join('\n'),
    status: 'published',
    isTop: 1,
    views: 42,
    publishedAt: "datetime('now', '-3 days')",
    tags: ['essay'],
  },
  {
    slug: 'why-workers',
    title: '为什么选择 Workers 而不是传统服务器',
    summary: '免运维、免费额度够用、全球边缘分发。三个理由。',
    content: [
      '## 传统服务器的麻烦',
      '',
      '买机器、装环境、配证书、盯日志……博客而已，不至于。',
      '',
      '## Workers 的优势',
      '',
      '1. **无需服务器**：推代码即上线',
      '2. **D1 数据库**：SQLite，够用且免费',
      '3. **边缘分发**：全球节点响应快',
      '',
      '```js',
      'export default {',
      '  async fetch(request, env) {',
      '    return new Response("hello from the edge");',
      '  }',
      '};',
      '```',
      '',
      '## 代价',
      '',
      '没有 Node 原生模块，生态要自己挑。博客场景完全可以接受。',
    ].join('\n'),
    status: 'published',
    isTop: 0,
    views: 128,
    publishedAt: "datetime('now', '-1 days')",
    tags: ['tech', 'cloudflare'],
  },
  {
    slug: 'markdown-cheatsheet',
    title: '我常用的 Markdown 速查',
    summary: '写博客够用的那部分语法，就这些。',
    content: [
      '## 基础',
      '',
      '**粗体**、*斜体*、~~删除线~~、`行内代码`。',
      '',
      '> 引用块',
      '',
      '## 代码',
      '',
      '```python',
      'def hello():',
      '    print("hi")',
      '```',
      '',
      '## 其他',
      '',
      '- [x] 任务列表',
      '- 链接：[Anthropic](https://anthropic.com)',
      '- 图片：`![alt](url)`',
      '',
      '就这些，剩下的靠回忆。',
    ].join('\n'),
    status: 'published',
    isTop: 0,
    views: 76,
    publishedAt: "datetime('now', '-10 hours')",
    tags: ['tech', 'essay'],
  },
  {
    slug: 'draft-example',
    title: '这是一篇草稿',
    summary: '公开页面看不到它。',
    content: ['草稿内容，只有登录后可见。', '', '- 待审核的内容', '- 可以随时改'].join('\n'),
    status: 'draft',
    isTop: 0,
    views: 0,
    publishedAt: 'NULL',
    tags: [],
  },
];

const tags = [
  { name: '技术', slug: 'tech' },
  { name: '随笔', slug: 'essay' },
  { name: 'Cloudflare', slug: 'cloudflare' },
];

/* ---------------------------------------------------------- 组装 SQL */
const lines = [];

lines.push('-- ============================================');
lines.push('-- 种子数据：默认管理员 + 3 篇示例文章 + 1 篇草稿');
lines.push('--');
lines.push('-- ⚠️ 本文件由 test/gen-seed.mjs 生成，不要手改。');
lines.push('--    手写 SQL 很容易把 markdown 里的真实换行写进字符串字面量，');
lines.push('--    导致线上静默插入 0 行（本地却看不出来）。');
lines.push('--    改内容请改 test/gen-seed.mjs 后重新运行它。');
lines.push('--');
lines.push('-- 默认账号：admin / admin123  ← 部署后请立刻在 /admin/settings 改');
lines.push('--');
lines.push('-- html 字段一律留空：运行时由 src/lib/db.ts 的 backfillHtml()');
lines.push('-- 用真实渲染器自动补齐，改渲染器不必重写 SQL。');
lines.push('-- ============================================');
lines.push('');
lines.push(`INSERT OR IGNORE INTO users (username, password_hash) VALUES`);
lines.push(`  ('admin', ${q(PASSWORD_HASH)});`);
lines.push('');

lines.push('INSERT OR IGNORE INTO tags (name, slug) VALUES');
lines.push(tags.map((t, i) => `  (${q(t.name)}, ${q(t.slug)})${i < tags.length - 1 ? ',' : ';'}`).join('\n'));
lines.push('');

lines.push('INSERT OR IGNORE INTO posts');
lines.push('  (slug, title, summary, content, html, status, is_top, views, word_count, published_at)');
lines.push('VALUES');

const values = posts.map((p, i) => {
  const rows = [
    `    ${q(p.slug)}`,
    `    ${q(p.title)}`,
    `    ${q(p.summary)}`,
    `    ${multiline(p.content)}`,
    `    ''`,
    `    ${q(p.status)}`,
    `    ${p.isTop}`,
    `    ${p.views}`,
    `    0`,
    `    ${p.publishedAt}`,
  ];
  return `  (\n${rows.join(',\n')}\n  )${i < posts.length - 1 ? ',' : ';'}`;
});
lines.push(values.join('\n'));
lines.push('');

lines.push('INSERT OR IGNORE INTO post_tags (post_id, tag_id)');
lines.push('  SELECT p.id, t.id FROM posts p, tags t');
const conds = [];
for (const p of posts) {
  if (!p.tags.length) continue;
  if (p.tags.length === 1) {
    conds.push(`    (p.slug = ${q(p.slug)} AND t.slug = ${q(p.tags[0])})`);
  } else {
    const list = p.tags.map((t) => q(t)).join(',');
    conds.push(`    (p.slug = ${q(p.slug)} AND t.slug IN (${list}))`);
  }
}
// 注意：跨表 SELECT 时必须写 WHERE，否则语法错误
lines.push(' WHERE ' + conds.join('\n    OR ') + ';');
lines.push('');

lines.push('INSERT OR IGNORE INTO settings (key, value) VALUES');
lines.push(`  ('site_name', ${q('BerrywingBlog')}),`);
lines.push(`  ('site_tagline', ${q('写代码，训ai，用ai')}),`);
lines.push(`  ('about', ${q('这里是我的小站，左边是我，右边也是我。')}),`);
lines.push(`  ('footer_note', ${q('赞助我吧 https://afdian.com/a/Berrywing')}),`);
lines.push(`  ('comment_enabled', '1');`);

const out = lines.join('\n') + '\n';
const target = resolve(root, 'schema/seed.sql');
writeFileSync(target, out, 'utf8');

/* ---------------------------------------------------------- 自检 */
/**
 * 检查是否存在「单引号字符串内出现真实换行」——那会让 SQLite 把字面量截断，
 * 语句后半截变成语法错误，整批 INSERT 静默失败（不报错但一行都没写进去）。
 * 关键：`''` 是转义后的单引号，必须成对跳过，否则会把字符串误判为已结束。
 */
function findStrayNewlines(sql) {
  const problems = [];
  let i = 0;
  let line = 1;
  let inStr = false;
  let strStartLine = 0;

  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '\n') {
      if (inStr) problems.push({ line: strStartLine, at: line });
      line++;
      i++;
      continue;
    }
    if (!inStr && ch === '-' && sql[i + 1] === '-') {
      // 整行注释，跳到行尾
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") { i += 2; continue; } // 转义 ''
      if (inStr) inStr = false;
      else { inStr = true; strStartLine = line; }
    }
    i++;
  }
  return problems;
}

const problems = findStrayNewlines(out);
console.log('✓ schema/seed.sql 已生成');
console.log('  文章', posts.length, '篇 / 标签', tags.length, '个');
console.log('  文件行数:', out.split('\n').length);
if (problems.length) {
  console.log(`  ✗ 发现 ${problems.length} 处字符串内真实换行（会导致线上插入 0 行）`);
  problems.slice(0, 3).forEach((p) => console.log(`    第 ${p.at} 行（字面量始于第 ${p.line} 行）`));
  process.exit(1);
}
console.log('  单引号内真实换行: 0 ✓');

/* --------------------------------------------------- 真实执行验证 */
/**
 * 光检查语法不够——SQLite 对「字符串内真实换行」是静默容忍的，
 * 必须真的建库跑一遍，确认每张表都插进了数据。
 */
if (process.argv.includes('--verify')) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(root, 'schema/schema.sql'), 'utf8'));
  db.exec(out);

  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const expect = { posts: posts.length, tags: tags.length, post_tags: posts.reduce((s, p) => s + p.tags.length, 0), users: 1, settings: 5 };

  console.log('  SQLite 实测：');
  let bad = false;
  for (const [t, want] of Object.entries(expect)) {
    const got = count(t);
    const ok = got === want;
    if (!ok) bad = true;
    console.log(`    ${ok ? '✓' : '✗'} ${t}: ${got}/${want}`);
  }

  // 抽查内容换行是否真的存成了 \n
  const row = db.prepare(`SELECT content FROM posts WHERE slug = ?`).get('hello-world');
  const hasNewline = /## 起点\n\n这是一个跑在/.test(row.content);
  console.log(`    ${hasNewline ? '✓' : '✗'} content 换行符正确还原`);
  if (!hasNewline) bad = true;

  db.close();
  if (bad) {
    console.log('\n✗ 验证未通过，请检查 gen-seed.mjs');
    process.exit(1);
  }
  console.log('\n✓ 全部验证通过');
}