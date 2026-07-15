import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createTestDatabase } from "./helpers/test-database.js";

function createTestDb() {
  return createTestDatabase();
}

async function createImage(repository, key, dimensions = {}) {
  return await repository.upsertImage({
    storageKey: key,
    fileName: `${key}.webp`,
    fileUrl: `https://gallery.test/file/${key}.webp`,
    width: dimensions.width ?? 1920,
    height: dimensions.height ?? 1080,
    syncStatus: "ok",
  });
}

test("getSiteSettings reads baseline issue name and hero copy", async () => {
  const repository = createGalleryRepository(createTestDb());
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

test("listFeaturedImages preserves legacy ineligible featured rows", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const legacy = await createImage(repository, "legacy-too-small", {
    width: 1280,
    height: 720,
  });
  database
    .prepare("INSERT INTO featured_images (image_id, sort_order) VALUES (?, ?)")
    .run(legacy.id, 1);

  const listed = await repository.listFeaturedImages();
  assert.deepEqual(
    listed.map(({ id, width, height }) => ({ id, width, height })),
    [{ id: legacy.id, width: 1280, height: 720 }],
  );
});

test("setFeaturedImages enforces featured image dimension rules without clearing selection", async () => {
  const repository = createGalleryRepository(createTestDb());
  const selected = await createImage(repository, "selected");
  const ineligible = await createImage(repository, "wrong-ratio", {
    width: 1920,
    height: 1200,
  });
  await repository.setFeaturedImages([selected.id]);

  await assert.rejects(
    () => repository.setFeaturedImages([ineligible.id]),
    /exact 16:9 and at least 1920x1080/,
  );
  assert.deepEqual(
    (await repository.listFeaturedImages()).map((image) => image.id),
    [selected.id],
  );
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

test("updateSiteConfiguration rejects ineligible featured images atomically", async () => {
  const repository = createGalleryRepository(createTestDb());
  const selected = await createImage(repository, "atomic-selected");
  const ineligible = await createImage(repository, "too-small", {
    width: 1280,
    height: 720,
  });
  await repository.updateSiteSettings({
    issueName: "原期名",
    heroCopy: "原文案",
  });
  await repository.setFeaturedImages([selected.id]);

  await assert.rejects(
    () => repository.updateSiteConfiguration({
      issueName: "不应保存",
      heroCopy: "也不应保存",
      featuredImageIds: [ineligible.id],
    }),
    /exact 16:9 and at least 1920x1080/,
  );
  assert.deepEqual(await repository.getSiteSettings(), {
    issueName: "原期名",
    heroCopy: "原文案",
  });
  assert.deepEqual(
    (await repository.listFeaturedImages()).map((image) => image.id),
    [selected.id],
  );
});

test("concurrent repository instances read migrated defaults consistently", async () => {
  const database = createTestDb();
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
