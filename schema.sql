CREATE TABLE IF NOT EXISTS tag_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  group_id INTEGER REFERENCES tag_groups(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  directory_slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sync_status TEXT NOT NULL DEFAULT 'ok',
  note TEXT,
  category_id INTEGER,
  upload_id TEXT,
  public_id TEXT,
  content_sha256 TEXT,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (image_id, tag_id),
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS featured_images (
  image_id INTEGER PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  cover_image_id INTEGER,
  is_home INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cover_image_id) REFERENCES images(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS album_images (
  album_id INTEGER NOT NULL,
  image_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, image_id),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  category_id INTEGER,
  tag_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  image_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+1 hour')),
  operation_id TEXT,
  client_item_id TEXT,
  public_id TEXT,
  content_sha256 TEXT,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_visible_order ON tags(is_visible, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_tag_groups_order ON tag_groups(sort_order, name);
CREATE INDEX IF NOT EXISTS idx_tags_group_order ON tags(group_id, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_categories_order ON categories(sort_order, name);
CREATE INDEX IF NOT EXISTS idx_images_file_id ON images(storage_key);
CREATE INDEX IF NOT EXISTS idx_images_category_id ON images(category_id);
CREATE INDEX IF NOT EXISTS idx_images_created_id ON images(created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_upload_id ON images(upload_id) WHERE upload_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_public_id ON images(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_content_sha256 ON images(content_sha256) WHERE content_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_featured_images_order ON featured_images(sort_order, image_id);
CREATE INDEX IF NOT EXISTS idx_albums_order ON albums(sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_home ON albums(is_home) WHERE is_home = 1;
CREATE INDEX IF NOT EXISTS idx_album_images_order ON album_images(album_id, sort_order, image_id);
CREATE INDEX IF NOT EXISTS idx_album_images_image_id ON album_images(image_id, album_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status_expiry ON upload_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_operation ON upload_sessions(operation_id, client_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_public_id ON upload_sessions(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_pending_content_sha256 ON upload_sessions(content_sha256) WHERE content_sha256 IS NOT NULL AND status = 'pending';
