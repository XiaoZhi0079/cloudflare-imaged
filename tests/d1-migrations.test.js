import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const baselineUrl = new URL("../migrations/0001_baseline.sql", import.meta.url);
const schemaUrl = new URL("../schema.sql", import.meta.url);

const BUSINESS_TABLES = [
  "categories",
  "featured_images",
  "image_tags",
  "images",
  "site_settings",
  "tags",
];

const BUSINESS_INDEXES = [
  "idx_categories_order",
  "idx_featured_images_order",
  "idx_image_tags_image_id",
  "idx_image_tags_tag_id",
  "idx_images_category_id",
  "idx_images_file_id",
  "idx_tags_visible_order",
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
      sql: row.sql.replace(/\s+/g, " ").trim().toLowerCase(),
    }));
}

test("baseline migration prepares a fresh database and is idempotent", () => {
  assert.equal(existsSync(baselineUrl), true, "baseline migration must exist");
  const baseline = readFileSync(baselineUrl, "utf8");
  const database = new DatabaseSync(":memory:");

  database.exec(baseline);
  database.exec(baseline);

  assert.deepEqual(objectNames(database, "table"), BUSINESS_TABLES);
  assert.deepEqual(objectNames(database, "index"), BUSINESS_INDEXES);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM categories").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM site_settings").get().count, 2);
});

test("schema snapshot and baseline migration define identical objects", () => {
  assert.equal(existsSync(baselineUrl), true, "baseline migration must exist");
  const migrationDatabase = new DatabaseSync(":memory:");
  const snapshotDatabase = new DatabaseSync(":memory:");

  migrationDatabase.exec(readFileSync(baselineUrl, "utf8"));
  snapshotDatabase.exec(readFileSync(schemaUrl, "utf8"));

  assert.deepEqual(normalizedObjects(migrationDatabase), normalizedObjects(snapshotDatabase));
});

test("baseline migration preserves an existing gallery and custom settings", () => {
  const database = new DatabaseSync(":memory:");
  const baseline = readFileSync(baselineUrl, "utf8");

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
  database.exec(baseline);

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
