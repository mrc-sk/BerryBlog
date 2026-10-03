-- 迁移：downloads 表支持第二个下载源
--
-- D1 的 CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，
-- 所以已上线的库必须走这份ALTER。SQLite 没有 ADD COLUMN IF NOT EXISTS，
-- 重复执行会报「duplicate column name」——对已迁移的库跳过即可，不影响其他语句。
--
-- 幂等做法：查 pragma_table_info 判断列是否已存在。

ALTER TABLE downloads ADD COLUMN mirror_url TEXT NOT NULL DEFAULT '';
ALTER TABLE downloads ADD COLUMN mirror_label TEXT NOT NULL DEFAULT '';

-- 验证（可选执行，确认两列都在）
-- SELECT name FROM pragma_table_info('downloads') WHERE name LIKE 'mirror%';
