import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createTestDatabase, enforceBoundParameterLimit } from "./helpers/test-database.js";

function createTestDb() {
  return createTestDatabase();
}

test("listVisibleTags reads an explicitly migrated empty tag table", async () => {
  const database = createTestDb();
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
    storageKey: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://gallery.test/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const secondImage = await repository.upsertImage({
    storageKey: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://gallery.test/file/girls/japan-01.webp",
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

test("tag lists expose stable full-library image counts", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const portrait = await repository.createTag({ name: "全库人像", sortOrder: 1, isVisible: true });
  const dress = await repository.createTag({ name: "全库礼服", sortOrder: 2, isVisible: true });
  const first = await repository.upsertImage({ storageKey: "gallery/count-1.webp", fileName: "count-1.webp", fileUrl: "/file/gallery/count-1.webp" });
  const second = await repository.upsertImage({ storageKey: "gallery/count-2.webp", fileName: "count-2.webp", fileUrl: "/file/gallery/count-2.webp" });
  const third = await repository.upsertImage({ storageKey: "gallery/count-3.webp", fileName: "count-3.webp", fileUrl: "/file/gallery/count-3.webp" });
  await repository.replaceImageTags(first.id, [portrait.id, dress.id]);
  await repository.replaceImageTags(second.id, [portrait.id]);
  await repository.replaceImageTags(third.id, [portrait.id]);

  const adminCounts = new Map((await repository.listTags()).map((tag) => [tag.name, Number(tag.image_count)]));
  const publicCounts = new Map((await repository.listVisibleTags()).map((tag) => [tag.name, Number(tag.image_count)]));
  assert.equal(adminCounts.get("全库人像"), 3);
  assert.equal(adminCounts.get("全库礼服"), 1);
  assert.equal(publicCounts.get("全库人像"), 3);
  assert.equal(publicCounts.get("全库礼服"), 1);
});

test("image lists batch tag lookups within the D1 100-parameter limit", async () => {
  const database = createTestDb();
  const tag = createGalleryRepository(database);
  const portrait = await tag.createTag({ name: "portrait", sortOrder: 1, isVisible: true });
  const imageIds = [];
  const insertImage = database.prepare("INSERT INTO images (storage_key, file_name, file_url, width, height) VALUES (?, ?, ?, ?, ?)");
  const insertTag = database.prepare("INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)");
  for (let index = 1; index <= 101; index += 1) {
    const name = `image-${index}.webp`;
    insertImage.run(`gallery/${name}`, name, `/file/gallery/${name}`, 1920, 1080);
    const imageId = Number(database.prepare("SELECT last_insert_rowid() AS id").get().id);
    insertTag.run(imageId, portrait.id);
    imageIds.push(imageId);
  }

  const guarded = enforceBoundParameterLimit(database);
  const repository = createGalleryRepository(guarded.database);
  const images = await repository.listImages();
  const selected = await repository.listImagesByIds([...imageIds].reverse());

  assert.equal(images.length, 101);
  assert.ok(images.every((image) => image.tags.join(",") === "portrait"));
  assert.deepEqual(selected.map((image) => image.id), [...imageIds].reverse());
  assert.ok(guarded.parameterCounts.every((count) => count <= 100));
  assert.ok(guarded.parameterCounts.filter((count) => count === 100).length >= 3);
});

test("listImagesPage reads only one page from a 1698-image library", async () => {
  const database = createTestDb();
  const insertImage = database.prepare("INSERT INTO images (storage_key, file_name, file_url, width, height) VALUES (?, ?, ?, ?, ?)");
  database.exec("BEGIN");
  for (let index = 1; index <= 1698; index += 1) {
    const name = `page-${String(index).padStart(4, "0")}.webp`;
    insertImage.run(`gallery/${name}`, name, `/file/gallery/${name}`, 1920, 1080);
  }
  database.exec("COMMIT");

  const executions = [];
  const observedDatabase = new Proxy(database, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            const value = Reflect.get(statementTarget, statementProperty, statementTarget);
            if (typeof value !== "function" || !["all", "get", "run"].includes(statementProperty)) {
              return typeof value === "function" ? value.bind(statementTarget) : value;
            }
            return (...params) => {
              executions.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
              return value.apply(statementTarget, params);
            };
          },
        });
      };
    },
  });

  const page = await createGalleryRepository(observedDatabase).listImagesPage({ limit: 50, offset: 100 });

  assert.equal(page.totalCount, 1698);
  assert.equal(page.count, 50);
  assert.equal(page.images.length, 50);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 150);
  assert.equal(executions.length, 3);
  assert.deepEqual(executions[1].params, [50, 100]);
  assert.equal(executions[2].params.length, 50);
});

test("listImagesPage can restrict search to file names without tag false positives", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);
  const matchingTag = await repository.createTag({ name: "dress-search", sortOrder: 1, isVisible: true });
  const fileNameMatch = await repository.upsertImage({
    storageKey: "gallery/dress-search-0001.png",
    fileName: "dress-search-0001.png",
    fileUrl: "/file/gallery/dress-search-0001.png",
    width: 1920,
    height: 1080,
  });
  const tagOnlyMatch = await repository.upsertImage({
    storageKey: "gallery/unrelated-0002.png",
    fileName: "unrelated-0002.png",
    fileUrl: "/file/gallery/unrelated-0002.png",
    width: 1920,
    height: 1080,
  });
  const longFileName = "European-LaceLoungewear-Bedroom-0046--77d68271.png";
  const longNameMatch = await repository.upsertImage({
    storageKey: `gallery/${longFileName}`,
    fileName: longFileName,
    fileUrl: `/file/gallery/${longFileName}`,
    width: 1920,
    height: 1080,
  });
  await repository.replaceImageTags(tagOnlyMatch.id, [matchingTag.id]);

  const generic = await repository.listImagesPage({ query: "dress-search", limit: 20 });
  const fileNamesOnly = await repository.listImagesPage({ fileNameQuery: "dress-search", limit: 20 });
  const fullLongName = await repository.listImagesPage({ fileNameQuery: longFileName, limit: 20 });

  assert.deepEqual(new Set(generic.images.map((image) => image.id)), new Set([fileNameMatch.id, tagOnlyMatch.id]));
  assert.deepEqual(fileNamesOnly.images.map((image) => image.id), [fileNameMatch.id]);
  assert.equal(fileNamesOnly.totalCount, 1);
  assert.equal(fileNamesOnly.hasMore, false);
  assert.equal(longFileName.length, 50);
  assert.deepEqual(fullLongName.images.map((image) => image.id), [longNameMatch.id]);
  await assert.rejects(
    repository.listImagesPage({ fileNameQuery: "x".repeat(201), limit: 20 }),
    /query must not exceed 200 characters/,
  );
});

test("listImagesPage performs server-side all-tag filtering and stable name sorting", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const group = await repository.createTagGroup({ name: "paged filters" });
  const firstTag = await repository.createTag({ name: "paged-a", groupId: group.id });
  const secondTag = await repository.createTag({ name: "paged-b", groupId: group.id });
  const both = await repository.upsertImage({ storageKey: "scenery/alpha.png", fileName: "alpha.png", fileUrl: "https://gallery.test/file/scenery/alpha.png" });
  const one = await repository.upsertImage({ storageKey: "scenery/zeta.png", fileName: "zeta.png", fileUrl: "https://gallery.test/file/scenery/zeta.png" });
  await repository.replaceImageTags(both.id, [firstTag.id, secondTag.id]);
  await repository.replaceImageTags(one.id, [firstTag.id]);
  const page = await repository.listImagesPage({ tagIds: [firstTag.id, secondTag.id], sort: "name", limit: 10 });
  assert.equal(page.totalCount, 1);
  assert.deepEqual(page.images.map((image) => image.fileName), ["alpha.png"]);
  assert.deepEqual(page.tagIds, [firstTag.id, secondTag.id]);
  assert.equal(page.sort, "name");
});

test("scanImageIds keeps a stable numeric-ID snapshot across gaps and new uploads", async () => {
  const database = createTestDb();
  const insert = database.prepare("INSERT INTO images (storage_key, file_name, file_url, width, height) VALUES (?, ?, ?, ?, ?)");
  for (let imageId = 1; imageId <= 5; imageId += 1) {
    const name = `scan-${imageId}.webp`;
    insert.run(`gallery/${name}`, name, `/file/gallery/${name}`, 1920, 1080);
  }
  database.prepare("DELETE FROM images WHERE id IN (?, ?)").run(2, 4);
  const repository = createGalleryRepository(database);

  const firstPage = await repository.scanImageIds({ afterImageId: 0, limit: 1 });
  assert.equal(firstPage.snapshotMaxImageId, 5);
  assert.deepEqual(firstPage.items.map((item) => item.imageId), [1]);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextAfterImageId, 1);

  insert.run("gallery/scan-6.webp", "scan-6.webp", "/file/gallery/scan-6.webp", 1920, 1080);
  const secondPage = await repository.scanImageIds({
    afterImageId: firstPage.nextAfterImageId,
    snapshotMaxImageId: firstPage.snapshotMaxImageId,
    limit: 100,
  });
  assert.deepEqual(secondPage.items.map((item) => item.imageId), [3, 5]);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.nextAfterImageId, null);
  assert.equal(secondPage.items.some((item) => item.imageId === 6), false);
});

test("replaceImageTags rewrites tag assignments and listImagesByTagSlug returns mapped images", async () => {
  const database = createTestDb();
  const repository = createGalleryRepository(database);

  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const shortHair = await repository.createTag({ name: "短发美女", sortOrder: 2, isVisible: true });
  const image = await repository.upsertImage({
    storageKey: "girls/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://gallery.test/file/girls/campus-01.webp",
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

test("listImagesByTagSlugs requires every selected tag", async () => {
  const repository = createGalleryRepository(createTestDb());
  const portrait = await repository.createTag({ name: "人像", sortOrder: 1, isVisible: true });
  const dress = await repository.createTag({ name: "连衣裙", sortOrder: 2, isVisible: true });
  const first = await repository.upsertImage({ storageKey: "gallery/a.webp", fileName: "a.webp", fileUrl: "/file/a.webp", width: 1920, height: 1080, syncStatus: "ok" });
  const second = await repository.upsertImage({ storageKey: "gallery/b.webp", fileName: "b.webp", fileUrl: "/file/b.webp", width: 1920, height: 1080, syncStatus: "ok" });
  await repository.replaceImageTags(first.id, [portrait.id, dress.id]);
  await repository.replaceImageTags(second.id, [portrait.id]);

  assert.deepEqual((await repository.listImagesByTagSlugs([portrait.slug, dress.slug])).map((image) => image.id), [first.id]);
  assert.deepEqual((await repository.listImagesByTagSlugs([])).map((image) => image.id), []);
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
    group_id: 1,
    group_name: "未分类",
    group_slug: "uncategorized",
    group_sort_order: 1,
    image_count: 0,
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
    storageKey: "girls/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://gallery.test/file/girls/campus-01.webp",
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
