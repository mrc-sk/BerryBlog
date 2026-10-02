-- ============================================
-- Nova Blog · D1 Schema
-- ============================================

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  summary      TEXT    NOT NULL DEFAULT '',
  content      TEXT    NOT NULL DEFAULT '',
  html         TEXT    NOT NULL DEFAULT '',
  cover        TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'draft',      -- draft | published
  is_top       INTEGER NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  word_count   INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status_pub ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_top        ON posts(is_top DESC, published_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id  INTEGER,
  author     TEXT    NOT NULL,
  email      TEXT    NOT NULL DEFAULT '',
  url        TEXT    NOT NULL DEFAULT '',
  body       TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending',   -- pending | approved | spam
  ip_hash    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, status, created_at);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- 登录/评论限流桶
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT NOT NULL,
  key         TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  window_from TEXT NOT NULL,
  PRIMARY KEY (bucket, key)
);

-- 站点设置（后台可改，vars 作为默认值兜底）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);