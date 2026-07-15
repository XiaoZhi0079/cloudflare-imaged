import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createTestDatabase } from "./helpers/test-database.js";

function createTestDb() {
  return createTestDatabase();
}

test("listCategories reads default upload categories from the baseline migration", async () => {
  const database = createTestDb();
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

test("baseline migration includes the current image category column and index", () => {
  const database = createTestDb();
  const imageColumns = database.prepare("PRAGMA table_info(images)").all();
  const imageIndexes = database.prepare("PRAGMA index_list(images)").all();

  assert.equal(imageColumns.some((column) => column.name === "category_id"), true);
  assert.equal(imageIndexes.some((index) => index.name === "idx_images_category_id"), true);
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
