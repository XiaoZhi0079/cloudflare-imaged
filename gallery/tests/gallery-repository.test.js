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

test("listVisibleTags bootstraps the schema when the database is empty", async () => {
  const database = new DatabaseSync(":memory:");
  const repository = createGalleryRepository(database);

  assert.deepEqual(await repository.listVisibleTags(), []);

  const created = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  assert.equal(created.name, "校园风情");
  assert.deepEqual((await repository.listVisibleTags()).map((tag) => tag.name), ["校园风情"]);
});

test("createTag persists slugged tags and listVisibleTags respects sort order", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);

  await repository.createTag({ name: "欧美美女", sortOrder: 3, isVisible: true });
  await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  await repository.createTag({ name: "隐藏分类", sortOrder: 0, isVisible: false });

  const tags = await repository.listVisibleTags();

  assert.deepEqual(
    tags.map((tag) => [tag.name, tag.slug]),
    [
      ["校园风情", "校园风情"],
      ["欧美美女", "欧美美女"],
    ],
  );
});

test("createTag inserts tags into a contiguous order without duplicates or gaps", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);

  await repository.createTag({ name: "tag-alpha", sortOrder: 2, isVisible: true });
  await repository.createTag({ name: "tag-bravo", sortOrder: 2, isVisible: true });
  await repository.createTag({ name: "tag-charlie", sortOrder: 5, isVisible: true });

  const tags = await repository.listVisibleTags();

  assert.deepEqual(
    tags.map((tag) => ({
      name: tag.name,
      sortOrder: tag.sort_order,
    })),
    [
      { name: "tag-alpha", sortOrder: 1 },
      { name: "tag-bravo", sortOrder: 2 },
      { name: "tag-charlie", sortOrder: 3 },
    ],
  );
});

test("upsertImage updates imported image metadata instead of duplicating rows", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);

  const firstImage = await repository.upsertImage({
    imgbedFileId: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://imgbed.test/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const secondImage = await repository.upsertImage({
    imgbedFileId: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://imgbed.test/file/girls/japan-01.webp",
    width: 1080,
    height: 1620,
    syncStatus: "ok",
  });

  const adminImages = await repository.listImages();

  assert.equal(firstImage.id, secondImage.id);
  assert.equal(adminImages.length, 1);
  assert.equal(adminImages[0].width, 1080);
  assert.equal(adminImages[0].height, 1620);
});

test("replaceImageTags rewrites tag assignments and listImagesByTagSlug returns mapped images", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);

  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const shortHair = await repository.createTag({ name: "短发美女", sortOrder: 2, isVisible: true });
  const image = await repository.upsertImage({
    imgbedFileId: "girls/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://imgbed.test/file/girls/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  await repository.replaceImageTags(image.id, [campus.id, shortHair.id]);

  const campusImages = await repository.listImagesByTagSlug(campus.slug);
  const shortHairImages = await repository.listImagesByTagSlug(shortHair.slug);

  assert.equal(campusImages.length, 1);
  assert.equal(shortHairImages.length, 1);
  assert.deepEqual(campusImages[0].tags, ["校园风情", "短发美女"]);
});

test("updateTag renames a tag and updates its order and visibility", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const original = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });

  const updated = await repository.updateTag(original.id, {
    name: "日系写真",
    sortOrder: 5,
    isVisible: false,
  });

  assert.deepEqual(updated, {
    id: original.id,
    name: "日系写真",
    slug: "日系写真",
    sort_order: 1,
    is_visible: 0,
  });
  assert.deepEqual(await repository.listVisibleTags(), []);
});

test("updateTag reorders tags into a contiguous sequence when moving into an occupied slot", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const first = await repository.createTag({ name: "tag-alpha", sortOrder: 1, isVisible: true });
  const second = await repository.createTag({ name: "tag-bravo", sortOrder: 2, isVisible: true });
  const third = await repository.createTag({ name: "tag-charlie", sortOrder: 3, isVisible: true });

  const updated = await repository.updateTag(third.id, {
    sortOrder: 2,
  });

  assert.equal(updated.sort_order, 2);
  assert.deepEqual(
    (await repository.listVisibleTags()).map((tag) => ({
      id: tag.id,
      name: tag.name,
      sortOrder: tag.sort_order,
    })),
    [
      { id: first.id, name: "tag-alpha", sortOrder: 1 },
      { id: third.id, name: "tag-charlie", sortOrder: 2 },
      { id: second.id, name: "tag-bravo", sortOrder: 3 },
    ],
  );
});

test("deleteTag removes the tag and detaches it from images", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const tag = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const image = await repository.upsertImage({
    imgbedFileId: "girls/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://imgbed.test/file/girls/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  await repository.replaceImageTags(image.id, [tag.id]);
  await repository.deleteTag(tag.id);

  assert.deepEqual(await repository.listVisibleTags(), []);
  assert.deepEqual((await repository.listImages())[0].tags, []);
});


test("deleteTag compacts remaining tag sort orders", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const first = await repository.createTag({ name: "tag-alpha", sortOrder: 1, isVisible: true });
  const second = await repository.createTag({ name: "tag-bravo", sortOrder: 2, isVisible: true });
  const third = await repository.createTag({ name: "tag-charlie", sortOrder: 3, isVisible: true });

  await repository.deleteTag(first.id);

  assert.deepEqual(
    (await repository.listVisibleTags()).map((tag) => ({
      id: tag.id,
      name: tag.name,
      sortOrder: tag.sort_order,
    })),
    [
      { id: second.id, name: "tag-bravo", sortOrder: 1 },
      { id: third.id, name: "tag-charlie", sortOrder: 2 },
    ],
  );
});
