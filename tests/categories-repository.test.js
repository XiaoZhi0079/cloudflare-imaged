import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createGalleryRepository } from "../src/server/gallery-repository.js";

function createTestDb() {
  const database = new DatabaseSync(":memory:");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

  database.exec(schema);

  return database;
}

test("listCategories bootstraps default upload categories when the database is empty", async () => {
  const database = new DatabaseSync(":memory:");
  const repository = createGalleryRepository(database);

  const categories = await repository.listCategories();

  assert.deepEqual(
    categories.map((category) => ({
      name: category.name,
      directory: category.directory_slug,
      sortOrder: category.sort_order,
    })),
    [
      { name: "性感美人", directory: "sexy-beauty", sortOrder: 1 },
      { name: "气质美人", directory: "elegant-beauty", sortOrder: 2 },
      { name: "风景", directory: "scenery", sortOrder: 3 },
    ],
  );
});

test("listCategories migrates a legacy images table before creating category indexes", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT NOT NULL DEFAULT 'ok',
      note TEXT
    );
  `);

  const repository = createGalleryRepository(database);
  const categories = await repository.listCategories();
  const imageColumns = database.prepare("PRAGMA table_info(images)").all();

  assert.equal(imageColumns.some((column) => column.name === "category_id"), true);
  assert.deepEqual(categories.map((category) => category.directory_slug), [
    "sexy-beauty",
    "elegant-beauty",
    "scenery",
  ]);
});

test("createCategory persists a custom category", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);

  const created = await repository.createCategory({
    name: "静物",
    directorySlug: "still-life",
    sortOrder: 4,
  });

  assert.deepEqual(created, {
    id: 4,
    name: "静物",
    directory_slug: "still-life",
    sort_order: 4,
  });
});

test("updateCategory changes display name and order without changing directory slug", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const category = (await repository.listCategories())[0];

  const updated = await repository.updateCategory(category.id, {
    name: "性感佳人",
    sortOrder: 3,
  });

  assert.deepEqual(updated, {
    id: category.id,
    name: "性感佳人",
    directory_slug: "sexy-beauty",
    sort_order: 3,
  });
});

test("upsertImage attaches category metadata to admin image records", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const category = (await repository.listCategories())[0];

  await repository.upsertImage({
    storageKey: "sexy-beauty/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://gallery.test/file/sexy-beauty/japan-01.webp",
    width: 1080,
    height: 1620,
    syncStatus: "ok",
    categoryId: category.id,
  });

  const images = await repository.listImages();

  assert.deepEqual(images[0].category, {
    id: category.id,
    name: "性感美人",
    directorySlug: "sexy-beauty",
    sortOrder: 1,
  });
});
