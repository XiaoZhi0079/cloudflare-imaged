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
