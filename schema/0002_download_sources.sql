-- 迁移：downloads 支持任意多个下载源
--
-- 背景：初版downloads 表直接放 url（单链接），后来要支持一条下载项挂多个
-- 下载源（主源/备用源/镜像站…），改成 download_sources 子表。
--
-- D1 的 CREATE TABLE IF NOT EXISTS 不会给已存在的表加列/改结构，所以已上线的
-- 库必须走这份ALTER。SQLite 没有 DROP COLUMN，用「建新表 + 拷数据」的方式重建。
--
-- ⚠️ 两个坑（都踩过，顺序不能改）：
--
--   1. download_sources 有 FOREIGN KEY (download_id) REFERENCES downloads(id)
--      ON DELETE CASCADE —— 执行 DROP TABLE downloads 会连带把源全部删光。
--      所以必须先把源导到临时表，再 DROP，再导回来。
--   2. 重建 downloads 时新表叫 downloads_new，拷数据要显式列名，不能 SELECT *。
--
-- 重复执行会因临时表已存在而报错，对已迁移的库跳过即可。

-- 1. 旧 url 先导出到临时表（此时 downloads 还是旧结构，url 列还在）
DROP TABLE IF EXISTS _dl_src_tmp;
CREATE TABLE _dl_src_tmp (
  download_id INTEGER NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL
);
INSERT INTO _dl_src_tmp (download_id, label, url)
  SELECT id, '主源', url FROM downloads
  WHERE url IS NOT NULL AND url <> '';

-- 2. 子表
CREATE TABLE IF NOT EXISTS download_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id INTEGER NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sources_dl ON download_sources(download_id, sort_order);

-- 3. 建不含 url 的新表
CREATE TABLE downloads_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO downloads_new
  (id, title, summary, platform, version, size, is_featured, sort_order, downloads, created_at, updated_at)
SELECT id, title, summary, platform, version, size, is_featured, sort_order, downloads, created_at, updated_at
  FROM downloads;

-- 4. 换表（先删子表，否则 CASCADE 会把源删光）
DROP TABLE IF EXISTS download_sources;
DROP TABLE downloads;
ALTER TABLE downloads_new RENAME TO downloads;

-- 5. 重建子表并导回源
CREATE TABLE download_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id INTEGER NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
);
INSERT INTO download_sources (download_id, label, url, sort_order)
  SELECT download_id, label, url, 0 FROM _dl_src_tmp;
DROP TABLE _dl_src_tmp;

CREATE INDEX IF NOT EXISTS idx_sources_dl ON download_sources(download_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_downloads_sort ON downloads(sort_order, id);

-- 验证（可选执行）
-- SELECT d.title, s.label, s.url FROM downloads d JOIN download_sources s ON s.download_id = d.id;
