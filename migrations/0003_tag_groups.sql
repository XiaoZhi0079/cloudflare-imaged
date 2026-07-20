CREATE TABLE IF NOT EXISTS tag_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tag_groups (name, slug, sort_order)
VALUES ('未分类', 'uncategorized', 1);

ALTER TABLE tags
ADD COLUMN group_id INTEGER REFERENCES tag_groups(id) ON DELETE RESTRICT;

UPDATE tags
SET group_id = (SELECT id FROM tag_groups WHERE slug = 'uncategorized')
WHERE group_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tag_groups_order ON tag_groups(sort_order, name);
CREATE INDEX IF NOT EXISTS idx_tags_group_order ON tags(group_id, sort_order, name);
