import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const baselineUrl = new URL("../migrations/0001_baseline.sql", import.meta.url);
const albumsUrl = new URL("../migrations/0002_albums.sql", import.meta.url);
const tagGroupsUrl = new URL("../migrations/0003_tag_groups.sql", import.meta.url);
const uploadSessionsUrl = new URL("../migrations/0004_upload_sessions.sql", import.meta.url);
const uploadOperationsUrl = new URL("../migrations/0005_upload_operations_and_paging.sql", import.meta.url);
const schemaUrl = new URL("../schema.sql", import.meta.url);

const BUSINESS_TABLES = [
  "album_images",
  "albums",
  "categories",
  "featured_images",
  "image_tags",
  "images",
  "site_settings",
  "tag_groups",
  "tags",
  "upload_sessions",
];

const BUSINESS_INDEXES = [
  "idx_album_images_image_id",
  "idx_album_images_order",
  "idx_albums_home",
  "idx_albums_order",
  "idx_categories_order",
  "idx_featured_images_order",
  "idx_image_tags_image_id",
  "idx_image_tags_tag_id",
  "idx_images_category_id",
  "idx_images_created_id",
  "idx_images_file_id",
  "idx_images_upload_id",
  "idx_tag_groups_order",
  "idx_tags_group_order",
  "idx_tags_visible_order",
  "idx_upload_sessions_operation",
  "idx_upload_sessions_status_expiry",
];

function objectNames(database, type) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name")
    .all(type)
    .map((row) => row.name)
    .filter((name) => !name.startsWith("sqlite_"));
}

function normalizedObjects(database) {
  return database
    .prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `)
    .all()
    .map((row) => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, " ").replace(/\s+([,)])/g, "$1").trim().toLowerCase(),
    }));
}

test("migrations prepare a fresh database and are idempotent", () => {
  assert.equal(existsSync(baselineUrl), true, "baseline migration must exist");
  const baseline = readFileSync(baselineUrl, "utf8");
  const albums = readFileSync(albumsUrl, "utf8");
  const tagGroups = readFileSync(tagGroupsUrl, "utf8");
  const uploadSessions = readFileSync(uploadSessionsUrl, "utf8");
  const uploadOperations = readFileSync(uploadOperationsUrl, "utf8");
  const database = new DatabaseSync(":memory:");

  database.exec(baseline);
  database.exec(albums);
  database.exec(tagGroups);
  database.exec(uploadSessions);
  database.exec(uploadOperations);
  database.exec(baseline);
  database.exec(albums);

  assert.deepEqual(objectNames(database, "table"), BUSINESS_TABLES);
  assert.deepEqual(objectNames(database, "index"), BUSINESS_INDEXES);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM categories").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM site_settings").get().count, 2);
  assert.deepEqual(
    { ...database.prepare("SELECT name, slug, sort_order FROM tag_groups").get() },
    { name: "未分类", slug: "uncategorized", sort_order: 1 },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT name, slug, description, is_home FROM albums").get() },
    {
      name: "图集",
      slug: "home",
      description: "慢慢看，挑一份喜欢的气质。本期以红调与侧光为主，适合夜色、轮廓与留白。",
      is_home: 1,
    },
  );
});

test("schema snapshot and baseline migration define identical objects", () => {
  assert.equal(existsSync(baselineUrl), true, "baseline migration must exist");
  const migrationDatabase = new DatabaseSync(":memory:");
  const snapshotDatabase = new DatabaseSync(":memory:");

  migrationDatabase.exec(readFileSync(baselineUrl, "utf8"));
  migrationDatabase.exec(readFileSync(albumsUrl, "utf8"));
  migrationDatabase.exec(readFileSync(tagGroupsUrl, "utf8"));
  migrationDatabase.exec(readFileSync(uploadSessionsUrl, "utf8"));
  migrationDatabase.exec(readFileSync(uploadOperationsUrl, "utf8"));
  snapshotDatabase.exec(readFileSync(schemaUrl, "utf8"));

  assert.deepEqual(normalizedObjects(migrationDatabase), normalizedObjects(snapshotDatabase));
});

test("tag group migration preserves existing tags and assigns the default group", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(baselineUrl, "utf8"));
  database.prepare("INSERT INTO tags (name, slug, sort_order, is_visible) VALUES (?, ?, ?, ?)").run("旧标签", "legacy", 1, 1);

  database.exec(readFileSync(tagGroupsUrl, "utf8"));
  assert.deepEqual(
    { ...database.prepare(`SELECT tags.name, tag_groups.slug AS group_slug FROM tags INNER JOIN tag_groups ON tag_groups.id = tags.group_id WHERE tags.slug = 'legacy'`).get() },
    { name: "旧标签", group_slug: "uncategorized" },
  );
});

test("album migration preserves an existing gallery and converts featured order", () => {
  const database = new DatabaseSync(":memory:");
  const baseline = readFileSync(baselineUrl, "utf8");
  const albums = readFileSync(albumsUrl, "utf8");

  database.exec("PRAGMA foreign_keys = ON");
  database.exec(readFileSync(schemaUrl, "utf8"));
  database.prepare(`
    INSERT INTO categories (id, name, directory_slug, sort_order)
    VALUES (501, 'sentinel-category', 'sentinel-category', 41)
  `).run();
  database.prepare(`
    INSERT INTO tags (id, name, slug, sort_order, is_visible)
    VALUES (502, 'sentinel-tag', 'sentinel-tag', 42, 0)
  `).run();
  database.prepare(`
    INSERT INTO images (
      id, storage_key, file_name, file_url, width, height, sync_status, note, category_id
    ) VALUES (
      503, 'sentinel/storage-key', 'sentinel.jpg', '/file/sentinel/storage-key',
      2560, 1440, 'pending', 'sentinel-note', 501
    )
  `).run();
  database.prepare("INSERT INTO image_tags (image_id, tag_id) VALUES (503, 502)").run();
  database.prepare("INSERT INTO featured_images (image_id, sort_order) VALUES (503, 7)").run();
  database.prepare(`
    INSERT INTO site_settings (key, value)
    VALUES ('issue_name', 'custom-issue'),
           ('hero_copy', 'custom-copy'),
           ('custom_setting', 'custom-value')
  `).run();

  database.exec(baseline);
  database.exec(albums);
  database.exec(baseline);
  database.exec(albums);

  assert.deepEqual(
    { ...database.prepare(`
      SELECT storage_key, file_name, file_url, width, height, sync_status, note, category_id
      FROM images
      WHERE id = 503
    `).get() },
    {
      storage_key: "sentinel/storage-key",
      file_name: "sentinel.jpg",
      file_url: "/file/sentinel/storage-key",
      width: 2560,
      height: 1440,
      sync_status: "pending",
      note: "sentinel-note",
      category_id: 501,
    },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT name, slug, description, cover_image_id, is_home FROM albums").get() },
    {
      name: "custom-issue",
      slug: "home",
      description: "custom-copy",
      cover_image_id: 503,
      is_home: 1,
    },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT image_id, sort_order FROM album_images").get() },
    { image_id: 503, sort_order: 7 },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT name, slug, sort_order, is_visible FROM tags WHERE id = 502").get() },
    { name: "sentinel-tag", slug: "sentinel-tag", sort_order: 42, is_visible: 0 },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT image_id, tag_id FROM image_tags WHERE image_id = 503").get() },
    { image_id: 503, tag_id: 502 },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT image_id, sort_order FROM featured_images WHERE image_id = 503").get() },
    { image_id: 503, sort_order: 7 },
  );
  assert.deepEqual(
    database
      .prepare("SELECT key, value FROM site_settings ORDER BY key")
      .all()
      .map((row) => ({ ...row })),
    [
      { key: "custom_setting", value: "custom-value" },
      { key: "hero_copy", value: "custom-copy" },
      { key: "issue_name", value: "custom-issue" },
    ],
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM categories WHERE id = 501").get().count,
    1,
  );
});
