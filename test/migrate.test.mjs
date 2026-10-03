/**
 * 迁移自测：验证 0002_download_sources.sql 能把旧结构正确升级，且数据不丢。
 *
 * 背景：downloads 初版是单列 url，后来改成 download_sources 子表（支持 N 个源）。
 * D1 的 CREATE TABLE IF NOT EXISTS 不会改已存在的表，只能靠迁移脚本。
 *
 * 用法：node test/migrate.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/** 模拟「已上线的旧库」：downloads 有 url 列，没有子表 */
const OLD_SCHEMA = `CREATE TABLE downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  is_featured INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`;

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const db = new DatabaseSync(':memory:');
db.exec(OLD_SCHEMA);

// 塞几条旧数据，覆盖各种情况
db.exec(`
  INSERT INTO downloads (title, url, sort_order, is_featured, downloads)
  VALUES ('普通项', 'https://a.example.com', 0, 0, 5);
  INSERT INTO downloads (title, url, sort_order, is_featured, downloads)
  VALUES ('推荐项', 'https://b.example.com', 1, 1, 10);
  INSERT INTO downloads (title, url, sort_order, is_featured, downloads)
  VALUES ('无链接项', '', 2, 0, 0);
`);

console.log('\n迁移前：');
check('downloads 有 3 条', db.prepare('SELECT COUNT(*) n FROM downloads').get().n === 3);
check('url 列存在', db.prepare("PRAGMA table_info(downloads)").all().some((c) => c.name === 'url'));

/* 跑迁移 */
try {
  db.exec(read('schema/0002_download_sources.sql'));
  console.log('\n迁移执行：成功');
} catch (e) {
  console.log('\n✗ 迁移失败：', e.message);
  process.exit(1);
}

console.log('\n迁移后：');
const cols = db.prepare("PRAGMA table_info(downloads)").all().map((c) => c.name);
check('downloads 仍是 3 条', db.prepare('SELECT COUNT(*) n FROM downloads').get().n === 3);
check('url 列已移除', !cols.includes('url'));
check('sort_order 保留', cols.includes('sort_order'));
check('is_featured 保留', cols.includes('is_featured'));
check('downloads 计数保留', db.prepare('SELECT downloads FROM downloads WHERE title=?').get('推荐项').downloads === 10);

const srcs = db.prepare('SELECT COUNT(*) n FROM download_sources').get().n;
check('只迁了2 条源（空链接不迁）', srcs === 2, `实际 ${srcs}`);

const a = db.prepare(
  "SELECT * FROM download_sources WHERE download_id = (SELECT id FROM downloads WHERE title='普通项')"
).get();
check('普通项的链接正确', a && a.url === 'https://a.example.com', a?.url || 'null');
check('默认 label 为「主源」', a && a.label === '主源', a?.label || 'null');
check('下载量归零（重新统计）', a && a.downloads === 0, String(a?.downloads));

const b = db.prepare(
  "SELECT * FROM download_sources WHERE download_id = (SELECT id FROM downloads WHERE title='推荐项')"
).get();
check('推荐项的链接正确', b && b.url === 'https://b.example.com', b?.url || 'null');

check('无链接项没有源',
  db.prepare("SELECT COUNT(*) n FROM download_sources WHERE download_id=(SELECT id FROM downloads WHERE title='无链接项')").get().n === 0);

/* 新结构下能正常插入多源 */
console.log('\n新结构写入：');
try {
  // last_insert_rowid 在 node:sqlite 里是 number，直接取
  const id = Number(
    db.prepare("INSERT INTO downloads (title, sort_order) VALUES ('多项源', 3)").run()
      .lastInsertRowid
  );
  const ins = db.prepare(
    'INSERT INTO download_sources (download_id, label, url, sort_order) VALUES (?,?,?,?)'
  );
  ins.run(id, 'GitHub', 'https://github.com/x', 0);
  ins.run(id, '官网', 'https://x.com', 1);
  ins.run(id, '镜像', 'https://mirror.com', 2);
  const n = db.prepare('SELECT COUNT(*) n FROM download_sources WHERE download_id=?').get(id).n;
  check('一条下载项可挂 3 个源', n === 3, `实际 ${n}`);
} catch (e) {
  check('新结构写入', false, e.message);
}

db.close();
console.log(`\n${fail === 0 ? '✓' : '✗'} 通过 ${pass} · 失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
