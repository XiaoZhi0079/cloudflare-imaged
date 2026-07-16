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

CREATE INDEX IF NOT EXISTS idx_albums_order ON albums(sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_home ON albums(is_home) WHERE is_home = 1;
CREATE INDEX IF NOT EXISTS idx_album_images_order ON album_images(album_id, sort_order, image_id);
CREATE INDEX IF NOT EXISTS idx_album_images_image_id ON album_images(image_id, album_id);

INSERT INTO albums (name, slug, description, is_home, sort_order)
SELECT
  COALESCE((SELECT value FROM site_settings WHERE key = 'issue_name'), '图集'),
  'home',
  COALESCE((SELECT value FROM site_settings WHERE key = 'hero_copy'), ''),
  1,
  1
WHERE NOT EXISTS (SELECT 1 FROM albums);

INSERT OR IGNORE INTO album_images (album_id, image_id, sort_order)
SELECT (SELECT id FROM albums WHERE is_home = 1 ORDER BY id LIMIT 1), image_id, sort_order
FROM featured_images
WHERE EXISTS (SELECT 1 FROM albums WHERE is_home = 1);

UPDATE albums
SET cover_image_id = (
  SELECT image_id
  FROM album_images
  WHERE album_id = albums.id
  ORDER BY sort_order, image_id
  LIMIT 1
)
WHERE is_home = 1 AND cover_image_id IS NULL;
