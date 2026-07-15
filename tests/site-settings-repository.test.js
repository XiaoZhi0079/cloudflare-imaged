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

async function createImage(repository, key) {
  return await repository.upsertImage({
    storageKey: key,
    fileName: `${key}.webp`,
    fileUrl: `https://gallery.test/file/${key}.webp`,
    width: 800,
    height: 1200,
    syncStatus: "ok",
  });
}

test("getSiteSettings seeds default issue name and hero copy", async () => {
  const repository = createGalleryRepository(new DatabaseSync(":memory:"));
  const settings = await repository.getSiteSettings();

  assert.equal(settings.issueName, "图集");
  assert.match(settings.heroCopy, /慢慢看/);
});

test("updateSiteSettings persists partial changes", async () => {
  const repository = createGalleryRepository(createTestDb());

  await repository.updateSiteSettings({ issueName: "红调侧光" });
  let settings = await repository.getSiteSettings();
  assert.equal(settings.issueName, "红调侧光");
  assert.match(settings.heroCopy, /慢慢看/);

  await repository.updateSiteSettings({ heroCopy: "只留下一句氛围。" });
  settings = await repository.getSiteSettings();
  assert.equal(settings.issueName, "红调侧光");
  assert.equal(settings.heroCopy, "只留下一句氛围。");
});

test("setFeaturedImages stores ordered images and listFeaturedImages returns them", async () => {
  const repository = createGalleryRepository(createTestDb());
  const first = await createImage(repository, "a");
  const second = await createImage(repository, "b");
  const third = await createImage(repository, "c");

  const featured = await repository.setFeaturedImages([third.id, first.id, second.id]);
  assert.deepEqual(featured.map((image) => image.id), [third.id, first.id, second.id]);

  const listed = await repository.listFeaturedImages();
  assert.deepEqual(listed.map((image) => image.id), [third.id, first.id, second.id]);
});

test("setFeaturedImages rejects unknown image ids", async () => {
  const repository = createGalleryRepository(createTestDb());
  const image = await createImage(repository, "only");

  await assert.rejects(
    () => repository.setFeaturedImages([image.id, 9999]),
    /unknown image ids/,
  );
});

test("deleting an image removes it from featured images", async () => {
  const repository = createGalleryRepository(createTestDb());
  const first = await createImage(repository, "keep");
  const second = await createImage(repository, "drop");

  await repository.setFeaturedImages([first.id, second.id]);
  await repository.deleteImage(second.id);

  const featured = await repository.listFeaturedImages();
  assert.deepEqual(featured.map((image) => image.id), [first.id]);
});

test("updateSiteConfiguration updates settings and featured order together", async () => {
  const repository = createGalleryRepository(createTestDb());
  const first = await createImage(repository, "atomic-a");
  const second = await createImage(repository, "atomic-b");

  const updated = await repository.updateSiteConfiguration({
    issueName: "原子更新",
    heroCopy: "设置与精选同时生效。",
    featuredImageIds: [second.id, first.id],
  });

  assert.equal(updated.issueName, "原子更新");
  assert.equal(updated.heroCopy, "设置与精选同时生效。");
  assert.deepEqual(updated.featuredImages.map((image) => image.id), [second.id, first.id]);
});

test("concurrent repository instances bootstrap defaults idempotently", async () => {
  const database = new DatabaseSync(":memory:");
  const firstRepository = createGalleryRepository(database);
  const secondRepository = createGalleryRepository(database);

  const [settings, visibleTags] = await Promise.all([
    firstRepository.getSiteSettings(),
    secondRepository.listVisibleTags(),
  ]);

  assert.equal(settings.issueName, "图集");
  assert.deepEqual(visibleTags, []);
  assert.equal((await firstRepository.listCategories()).length, 3);
});
