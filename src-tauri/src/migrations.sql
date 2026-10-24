-- SocialHQ schema migrations.
-- Each block starts with a "-- migration: N" marker. Blocks are applied in order
-- and the applied version is stored in SQLite's PRAGMA user_version.

-- migration: 1
CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#BFEF00',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  url TEXT,
  color TEXT NOT NULL DEFAULT '#BFEF00',
  icon TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_briefs (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  about TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  avoid TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  fixed_elements TEXT NOT NULL DEFAULT '',
  extra_context TEXT NOT NULL DEFAULT '',
  visual_guidelines TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  instruction TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  topic TEXT,
  members INTEGER,
  rules TEXT,
  notes TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'page',
  status TEXT NOT NULL DEFAULT 'idea',
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  notes TEXT,
  published_at TEXT,
  published_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'inne',
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  thumb_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS post_media (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE IF NOT EXISTS media_tags (
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);

CREATE TABLE IF NOT EXISTS group_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  body_snapshot TEXT NOT NULL,
  published_at TEXT NOT NULL,
  post_url TEXT,
  outcome_note TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- migration: 2
CREATE INDEX IF NOT EXISTS idx_posts_project ON posts(project_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_kind ON posts(kind);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id);
CREATE INDEX IF NOT EXISTS idx_posts_updated ON posts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id);
CREATE INDEX IF NOT EXISTS idx_groups_pinned ON groups(pinned);
CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id);
CREATE INDEX IF NOT EXISTS idx_media_category ON media(category);
CREATE INDEX IF NOT EXISTS idx_media_sha ON media(sha256);
CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id);
CREATE INDEX IF NOT EXISTS idx_prompts_kind ON prompts(kind);
CREATE INDEX IF NOT EXISTS idx_publications_group ON group_publications(group_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_templates_project ON task_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- migration: 3
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('post', new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  DELETE FROM search_fts WHERE entity_type = 'post' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  DELETE FROM search_fts WHERE entity_type = 'post' AND entity_id = old.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('post', new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS groups_fts_ai AFTER INSERT ON groups BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('group', new.id, new.name, coalesce(new.topic, '') || ' ' || coalesce(new.rules, '') || ' ' || coalesce(new.notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS groups_fts_ad AFTER DELETE ON groups BEGIN
  DELETE FROM search_fts WHERE entity_type = 'group' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS groups_fts_au AFTER UPDATE ON groups BEGIN
  DELETE FROM search_fts WHERE entity_type = 'group' AND entity_id = old.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('group', new.id, new.name, coalesce(new.topic, '') || ' ' || coalesce(new.rules, '') || ' ' || coalesce(new.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('prompt', new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS prompts_fts_ad AFTER DELETE ON prompts BEGIN
  DELETE FROM search_fts WHERE entity_type = 'prompt' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS prompts_fts_au AFTER UPDATE ON prompts BEGIN
  DELETE FROM search_fts WHERE entity_type = 'prompt' AND entity_id = old.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('prompt', new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS media_fts_ai AFTER INSERT ON media BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('media', new.id, new.file_name, coalesce(new.description, '') || ' ' || new.category);
END;
CREATE TRIGGER IF NOT EXISTS media_fts_ad AFTER DELETE ON media BEGIN
  DELETE FROM search_fts WHERE entity_type = 'media' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS media_fts_au AFTER UPDATE ON media BEGIN
  DELETE FROM search_fts WHERE entity_type = 'media' AND entity_id = old.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body)
  VALUES ('media', new.id, new.file_name, coalesce(new.description, '') || ' ' || new.category);
END;

-- migration: 4
CREATE TABLE IF NOT EXISTS group_tags (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_group_tags_group ON group_tags(group_id);
