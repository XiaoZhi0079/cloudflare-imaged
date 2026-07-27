import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as publicTagsHandler } from "../functions/api/public/tags.js";
import { onRequest as publicImagesHandler } from "../functions/api/public/images.js";
import { onRequest as adminTagsHandler } from "../functions/api/admin/tags.js";
import { onRequest as adminTagGroupsHandler } from "../functions/api/admin/tag-groups.js";
import { onRequest as adminImagesHandler } from "../functions/api/admin/images.js";
import { onRequest as adminImageHandler } from "../functions/api/admin/images/[id].js";
import { onRequest as adminImageScanHandler } from "../functions/api/admin/images/scan.js";
import { onRequest as adminImagesAuditHandler } from "../functions/api/admin/images/audit.js";
import { onRequest as adminImportHandler } from "../functions/api/admin/images/import.js";
import { onRequest as adminUploadHandler } from "../functions/api/admin/images/upload/index.js";
import { onRequest as adminTagAssignmentsHandler } from "../functions/api/admin/images/tag-assignments.js";
import { onRequest as adminBulkTagAssignmentsHandler } from "../functions/api/admin/images/tag-assignments/bulk.js";
import { onRequest as adminBulkDeleteHandler } from "../functions/api/admin/images/bulk-delete.js";
import { createTestDatabase, enforceBoundParameterLimit } from "./helpers/test-database.js";

function createTestEnv() {
  return {
    GALLERY_DB: createTestDatabase(),
    GALLERY_ADMIN_KEY: "gallery-secret",
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
  };
}

const defaultTagGroup = Object.freeze({
  id: 1,
  name: "未分类",
  slug: "uncategorized",
  sortOrder: 1,
});

function expectedAdminTag(tag) {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    sortOrder: Number(tag.sortOrder ?? tag.sort_order),
    isVisible: Number(tag.is_visible ?? tag.isVisible) === 1 || tag.isVisible === true,
    groupId: 1,
    group: defaultTagGroup,
  };
}

test("public tags handler reads an explicitly migrated empty tag table", async () => {
  const env = createTestEnv();

  const response = await publicTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/tags"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tags: [],
    tagGroups: [],
  });
});

test("public tags handler returns visible ordered tags only", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);

  await repository.createTag({ name: "欧美美女", sortOrder: 3, isVisible: true });
  await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  await repository.createTag({ name: "隐藏分类", sortOrder: 0, isVisible: false });

  const response = await publicTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/tags"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tags: [
      { id: 2, name: "校园风情", slug: "校园风情", sortOrder: 1, groupId: 1, group: defaultTagGroup },
      { id: 1, name: "欧美美女", slug: "欧美美女", sortOrder: 2, groupId: 1, group: defaultTagGroup },
    ],
    tagGroups: [{ ...defaultTagGroup, tags: [
      { id: 2, name: "校园风情", slug: "校园风情", sortOrder: 1 },
      { id: 1, name: "欧美美女", slug: "欧美美女", sortOrder: 2 },
    ] }],
  });
});

test("public images handler returns images for the requested tag", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const japan = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });

  const campusImage = await repository.upsertImage({
    storageKey: "girls/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://gallery.example.com/file/girls/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });
  const japanImage = await repository.upsertImage({
    storageKey: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://gallery.example.com/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  await repository.replaceImageTags(campusImage.id, [campus.id]);
  await repository.replaceImageTags(japanImage.id, [japan.id]);

  const response = await publicImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/images?tag=%E6%A0%A1%E5%9B%AD%E9%A3%8E%E6%83%85"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [
      {
        id: campusImage.id,
        publicId: campusImage.publicId,
        fileName: "campus-01.webp",
        fileUrl: "https://gallery.example.com/file/girls/campus-01.webp",
        width: 900,
        height: 1350,
        tags: ["校园风情"],
      },
    ],
  });
});

test("public images handler intersects repeated tag parameters", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const portrait = await repository.createTag({ name: "人像", sortOrder: 1, isVisible: true });
  const dress = await repository.createTag({ name: "连衣裙", sortOrder: 2, isVisible: true });
  const both = await repository.upsertImage({ storageKey: "gallery/both.webp", fileName: "both.webp", fileUrl: "/file/both.webp", width: 1920, height: 1080, syncStatus: "ok" });
  const portraitOnly = await repository.upsertImage({ storageKey: "gallery/portrait.webp", fileName: "portrait.webp", fileUrl: "/file/portrait.webp", width: 1920, height: 1080, syncStatus: "ok" });
  await repository.replaceImageTags(both.id, [portrait.id, dress.id]);
  await repository.replaceImageTags(portraitOnly.id, [portrait.id]);

  const response = await publicImagesHandler({
    env,
    request: new Request(`https://gallery.example.com/api/public/images?tag=${encodeURIComponent(portrait.slug)}&tag=${encodeURIComponent(dress.slug)}`),
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).images.map((image) => image.id), [both.id]);
});

test("admin tags require a tag group", async () => {
  const env = createTestEnv();
  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gallery-admin-key": "gallery-secret" },
      body: JSON.stringify({ name: "未指定分类" }),
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "请选择标签分类。" });
});

test("tag groups can be managed and non-empty groups cannot be deleted", async () => {
  const env = createTestEnv();
  const createResponse = await adminTagGroupsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tag-groups", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gallery-admin-key": "gallery-secret" },
      body: JSON.stringify({ name: "人物", sortOrder: 2 }),
    }),
  });
  assert.equal(createResponse.status, 201);
  const { tagGroup } = await createResponse.json();
  assert.equal(tagGroup.name, "人物");

  const repository = createGalleryRepository(env.GALLERY_DB);
  const tag = await repository.createTag({ name: "东亚人", groupId: tagGroup.id, sortOrder: 1, isVisible: true });
  const rejectedDelete = await adminTagGroupsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tag-groups", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-gallery-admin-key": "gallery-secret" },
      body: JSON.stringify({ id: tagGroup.id }),
    }),
  });
  assert.equal(rejectedDelete.status, 400);

  await repository.updateTag(tag.id, { groupId: 1 });
  const deleted = await adminTagGroupsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tag-groups", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-gallery-admin-key": "gallery-secret" },
      body: JSON.stringify({ id: tagGroup.id }),
    }),
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deletedTagGroupId: tagGroup.id });
});

test("admin tags handler creates tags when the admin key is valid", async () => {
  const env = createTestEnv();

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "田园景色",
        groupId: 1,
        sortOrder: 1,
        isVisible: true,
      }),
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { tag: expectedAdminTag({ id: 1, name: "田园景色", slug: "田园景色", sortOrder: 1, isVisible: true }) });
});

test("admin tags handler rejects blank tag names", async () => {
  const env = createTestEnv();

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "   ",
      }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "标签名称不能为空。",
  });
});

test("admin tags handler rejects duplicate tags with a conflict response", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "校园风情",
        groupId: 1,
        sortOrder: 2,
        isVisible: true,
      }),
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "标签已存在。",
  });
});

test("admin tags handler reorders tags into contiguous slots when sort order is updated", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const first = await repository.createTag({ name: "tag-alpha", sortOrder: 1, isVisible: true });
  const second = await repository.createTag({ name: "tag-bravo", sortOrder: 2, isVisible: true });
  const third = await repository.createTag({ name: "tag-charlie", sortOrder: 3, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        id: third.id,
        sortOrder: 2,
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tag: expectedAdminTag({ ...third, sortOrder: 2, isVisible: true }) });

  const listResponse = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual((await listResponse.json()).tags, [
    expectedAdminTag({ ...first, sortOrder: 1, isVisible: true }),
    expectedAdminTag({ ...third, sortOrder: 2, isVisible: true }),
    expectedAdminTag({ ...second, sortOrder: 3, isVisible: true }),
  ]);
});

test("admin tags handler updates tag fields when the admin key is valid", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const tag = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        id: tag.id,
        name: "日系写真",
        sortOrder: 1,
        isVisible: false,
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tag: expectedAdminTag({ id: tag.id, name: "日系写真", slug: "日系写真", sortOrder: 1, isVisible: false }) });
});

test("admin tags handler deletes a tag when the admin key is valid", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const tag = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ id: tag.id }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    deletedTagId: tag.id,
  });

  const listResponse = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual((await listResponse.json()).tags, []);
});

test("admin images handler returns an empty list on a migrated database", async () => {
  const env = createTestEnv();

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [],
  });
});

test("admin images handler searches strictly by file name with bounded pagination", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const matchingTag = await repository.createTag({ name: "asian-dress", sortOrder: 1, isVisible: true });
  const fileNameMatch = await repository.upsertImage({
    storageKey: "gallery/asian-dress-studio-0042.png",
    fileName: "asian-dress-studio-0042.png",
    fileUrl: "/file/gallery/asian-dress-studio-0042.png",
    width: 1920,
    height: 1080,
  });
  const tagOnlyMatch = await repository.upsertImage({
    storageKey: "gallery/unrelated.png",
    fileName: "unrelated.png",
    fileUrl: "/file/gallery/unrelated.png",
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
  const headers = { "x-gallery-admin-key": "gallery-secret" };

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images?file_name=asian-dress&limit=20&offset=0", { headers }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.images.map((image) => image.id), [fileNameMatch.id]);
  assert.equal(payload.totalCount, 1);
  assert.equal(payload.count, 1);
  assert.equal(payload.hasMore, false);

  const longNameResponse = await adminImagesHandler({
    env,
    request: new Request(`https://gallery.example.com/api/admin/images?file_name=${encodeURIComponent(longFileName)}&limit=20&offset=0`, { headers }),
  });
  assert.equal(longNameResponse.status, 200);
  assert.deepEqual((await longNameResponse.json()).images.map((image) => image.id), [longNameMatch.id]);

  const ambiguous = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images?query=asian&file_name=dress", { headers }),
  });
  assert.equal(ambiguous.status, 400);
  assert.deepEqual(await ambiguous.json(), { error: "query and file_name cannot be combined" });

  const tooLong = await adminImagesHandler({
    env,
    request: new Request(`https://gallery.example.com/api/admin/images?file_name=${"x".repeat(201)}`, { headers }),
  });
  assert.equal(tooLong.status, 400);
  assert.deepEqual(await tooLong.json(), { error: "search text must not exceed 200 characters" });
});

test("admin exact image handler returns one image and a typed 404", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    storageKey: "gallery/exact.webp",
    fileName: "exact.webp",
    fileUrl: "/file/gallery/exact.webp",
    width: 1920,
    height: 1080,
    syncStatus: "ok",
  });
  const headers = { "x-gallery-admin-key": "gallery-secret" };

  const found = await adminImageHandler({
    env,
    request: new Request(`https://gallery.example.com/api/admin/images/${image.id}`, { headers }),
    params: { id: String(image.id) },
  });
  assert.equal(found.status, 200);
  assert.equal((await found.json()).image.id, image.id);

  const missing = await adminImageHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/99999", { headers }),
    params: { id: "99999" },
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Image not found", code: "IMAGE_NOT_FOUND" });
});

test("admin image scan returns a stable numeric-ID cursor and validates continuation", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  for (let index = 1; index <= 4; index += 1) {
    await repository.upsertImage({
      storageKey: `gallery/scan-${index}.webp`,
      fileName: `scan-${index}.webp`,
      fileUrl: `/file/gallery/scan-${index}.webp`,
      width: 1920,
      height: 1080,
      syncStatus: "ok",
    });
  }
  env.GALLERY_DB.prepare("DELETE FROM images WHERE id = ?").run(2);
  const headers = { "x-gallery-admin-key": "gallery-secret" };

  const first = await adminImageScanHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/scan?after_id=0&limit=2", { headers }),
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.snapshotMaxImageId, 4);
  assert.deepEqual(firstPayload.items.map((item) => item.imageId), [1, 3]);
  assert.equal(firstPayload.nextAfterImageId, 3);

  await repository.upsertImage({
    storageKey: "gallery/scan-5.webp",
    fileName: "scan-5.webp",
    fileUrl: "/file/gallery/scan-5.webp",
    width: 1920,
    height: 1080,
    syncStatus: "ok",
  });
  const second = await adminImageScanHandler({
    env,
    request: new Request(`https://gallery.example.com/api/admin/images/scan?after_id=3&snapshot_max_id=${firstPayload.snapshotMaxImageId}&limit=2`, { headers }),
  });
  assert.equal(second.status, 200);
  const secondPayload = await second.json();
  assert.deepEqual(secondPayload.items.map((item) => item.imageId), [4]);
  assert.equal(secondPayload.hasMore, false);

  const invalid = await adminImageScanHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/scan?after_id=5&snapshot_max_id=4", { headers }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_IMAGE_SCAN_CURSOR");
});

test("admin images handler lists more than 100 tagged images within D1 limits", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const portrait = await repository.createTag({ name: "portrait", sortOrder: 1, isVisible: true });
  const insertImage = database.prepare("INSERT INTO images (storage_key, file_name, file_url, width, height) VALUES (?, ?, ?, ?, ?)");
  const insertTag = database.prepare("INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)");
  for (let index = 1; index <= 101; index += 1) {
    const name = `admin-${index}.webp`;
    insertImage.run(`gallery/${name}`, name, `/file/gallery/${name}`, 1920, 1080);
    const imageId = Number(database.prepare("SELECT last_insert_rowid() AS id").get().id);
    insertTag.run(imageId, portrait.id);
  }
  const guarded = enforceBoundParameterLimit(database);

  const response = await adminImagesHandler({
    env: { ...createTestEnv(), GALLERY_DB: guarded.database },
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: { "x-gallery-admin-key": "gallery-secret" },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).images.length, 101);
  assert.ok(guarded.parameterCounts.every((count) => count <= 100));
});

test("admin images handler converts unexpected failures into structured JSON", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    const response = await adminImagesHandler({
      env: {
        ...createTestEnv(),
        GALLERY_DB: { prepare() { throw new Error("database unavailable"); } },
      },
      request: new Request("https://gallery.example.com/api/admin/images", {
        headers: {
          "cf-ray": "test-library-ray",
          "x-gallery-admin-key": "gallery-secret",
        },
      }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "图片库加载失败，请稍后重试。",
      code: "ADMIN_IMAGES_READ_FAILED",
      requestId: "test-library-ray",
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(JSON.parse(errors[0]).event, "image_list_failed");
});


test("admin tag assignment handler rejects missing tag ids", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    storageKey: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://gallery.example.com/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const response = await adminTagAssignmentsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/tag-assignments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        imageId: image.id,
        tagIds: [999],
      }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "存在无效标签，无法完成设置。",
    code: "TAG_NOT_FOUND",
  });
});

test("admin tag assignment handler replaces image tag bindings", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const japan = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });
  const image = await repository.upsertImage({
    storageKey: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://gallery.example.com/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const response = await adminTagAssignmentsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/tag-assignments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        imageId: image.id,
        tagIds: [campus.id, japan.id],
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    imageId: image.id,
    tagIds: [campus.id, japan.id],
  });
});




test("admin bulk tag assignment handler replaces tags for multiple images", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const japan = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });
  const imageA = await repository.upsertImage({
    storageKey: "girls/a.webp",
    fileName: "a.webp",
    fileUrl: "https://gallery.example.com/file/girls/a.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });
  const imageB = await repository.upsertImage({
    storageKey: "girls/b.webp",
    fileName: "b.webp",
    fileUrl: "https://gallery.example.com/file/girls/b.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const response = await adminBulkTagAssignmentsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/tag-assignments/bulk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        imageIds: [imageA.id, imageB.id],
        tagIds: [campus.id, japan.id],
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    updatedCount: 2,
    imageIds: [imageA.id, imageB.id],
    tagIds: [campus.id, japan.id],
  });

  const images = await repository.listImages();
  assert.deepEqual(images.map((image) => image.tags), [
    ["校园风情", "日本美女"],
    ["校园风情", "日本美女"],
  ]);
});

test("admin bulk delete handler removes multiple images and bucket objects", async () => {
  const env = {
    ...createTestEnv(),
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
  };
  await env.GALLERY_BUCKET.put("gallery/a.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });
  await env.GALLERY_BUCKET.put("gallery/b.webp", new Uint8Array([4, 5, 6]), {
    httpMetadata: { contentType: "image/webp" },
  });
  const repository = createGalleryRepository(env.GALLERY_DB);
  const imageA = await repository.upsertImage({
    storageKey: "gallery/a.webp",
    fileName: "a.webp",
    fileUrl: "https://gallery.example.com/file/gallery/a.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });
  const imageB = await repository.upsertImage({
    storageKey: "gallery/b.webp",
    fileName: "b.webp",
    fileUrl: "https://gallery.example.com/file/gallery/b.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const response = await adminBulkDeleteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/bulk-delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        imageIds: [imageA.id, imageB.id],
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    deletedCount: 2,
    imageIds: [imageA.id, imageB.id],
  });
  assert.equal(env.GALLERY_BUCKET.objects.has("gallery/a.webp"), false);
  assert.equal(env.GALLERY_BUCKET.objects.has("gallery/b.webp"), false);
  assert.deepEqual(await repository.listImages(), []);
});

function createMockBucket() {
  const objects = new Map();

  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(await value.arrayBuffer());
      objects.set(key, {
        body: new Uint8Array(bytes),
        httpMetadata: { ...(options.httpMetadata ?? {}) },
        customMetadata: { ...(options.customMetadata ?? {}) },
      });

      return { key };
    },
    async get(key) {
      const entry = objects.get(key);
      if (!entry) {
        return null;
      }

      return {
        body: new Uint8Array(entry.body),
        httpMetadata: { ...(entry.httpMetadata ?? {}) },
        customMetadata: { ...(entry.customMetadata ?? {}) },
      };
    },
    async head(key) {
      const entry = objects.get(key);
      return entry ? { key, size: entry.body.byteLength, etag: key } : null;
    },
    async list() {
      return {
        objects: [...objects.entries()].map(([key, entry]) => ({
          key,
          size: entry.body.byteLength,
          etag: key,
        })),
        truncated: false,
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

test("admin upload handler returns a gone response after switching to direct R2 uploads", async () => {
  const response = await adminUploadHandler({
    env: createTestEnv(),
    request: new Request("https://gallery.example.com/api/admin/images/upload", {
      method: "POST",
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
      body: new FormData(),
    }),
  });

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: "Gallery 已改为直传 R2，请使用 /api/admin/images/upload/init 和 /api/admin/images/upload/complete。",
  });
});

test("admin images handler renames and moves gallery files inside the gallery bucket", async () => {
  const env = {
    ...createTestEnv(),
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
  };
  await env.GALLERY_BUCKET.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    storageKey: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://gallery.example.com/file/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const renameResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id, fileName: "campus-02.webp" }),
    }),
  });

  assert.equal(renameResponse.status, 200);
  assert.equal(env.GALLERY_BUCKET.objects.has("gallery/campus-01.webp"), false);
  assert.ok(env.GALLERY_BUCKET.objects.has("gallery/campus-02.webp"));

  const moveResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id, directory: "archive" }),
    }),
  });

  assert.equal(moveResponse.status, 200);
  assert.equal(env.GALLERY_BUCKET.objects.has("gallery/campus-02.webp"), false);
  assert.ok(env.GALLERY_BUCKET.objects.has("archive/campus-02.webp"));
});

test("admin tag assignment handler returns 404 for a missing image even with an empty tag set", async () => {
  const env = createTestEnv();
  const response = await adminTagAssignmentsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/tag-assignments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: 99999, tagIds: [] }),
    }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Image not found", code: "IMAGE_NOT_FOUND" });
});

test("admin images handler deletes a missing-object record and cleans its relationships", async () => {
  const env = {
    ...createTestEnv(),
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const portrait = await repository.createTag({ name: "待删除标签", sortOrder: 1, isVisible: true });
  const image = await repository.upsertImage({
    storageKey: "gallery/missing.webp",
    fileName: "missing.webp",
    fileUrl: "https://gallery.example.com/file/gallery/missing.webp",
    width: 1920,
    height: 1080,
    syncStatus: "repair_required",
    note: "R2 object missing",
  });
  await repository.replaceImageTags(image.id, [portrait.id]);
  const home = (await repository.listAlbums()).find((album) => album.isHome);
  await repository.updateAlbum(home.id, { imageIds: [image.id], coverImageId: image.id });
  await repository.setFeaturedImages([image.id]);

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deletedImageId: image.id });
  assert.deepEqual(await repository.listImages(), []);
  assert.deepEqual(await repository.listFeaturedImages(), []);
  assert.deepEqual((await repository.getAlbumById(home.id)).images, []);
});

test("admin image audit finds and repairs a unique D1 to R2 name mismatch", async () => {
  const env = {
    ...createTestEnv(),
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
  };
  await env.GALLERY_BUCKET.put("elegant-beauty/wallpaper-beauty-011.png", new Uint8Array([1, 2, 3]));
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    storageKey: "elegant-beauty/wallpaper-beauty-018.png",
    fileName: "wallpaper-beauty-018.png",
    fileUrl: "https://gallery.example.com/file/elegant-beauty/wallpaper-beauty-018.png",
    width: 1920,
    height: 1080,
    syncStatus: "rename_failed",
    note: "rename failed",
  });
  const headers = {
    "content-type": "application/json",
    "x-gallery-admin-key": "gallery-secret",
  };

  const auditResponse = await adminImagesAuditHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/audit", { headers }),
  });
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.deepEqual(audit.summary, {
    imageRecords: 1,
    r2Objects: 1,
    missingObjects: 1,
    orphanObjects: 1,
    failedRecords: 1,
    uniqueRepairSuggestions: 1,
  });
  assert.equal(audit.suggestions[0].existingKey, "elegant-beauty/wallpaper-beauty-011.png");

  const repairResponse = await adminImagesAuditHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/audit", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "repair-record",
        imageId: image.id,
        storageKey: "elegant-beauty/wallpaper-beauty-011.png",
      }),
    }),
  });
  assert.equal(repairResponse.status, 200);
  const repaired = await repairResponse.json();
  assert.equal(repaired.image.fileName, "wallpaper-beauty-011.png");
  assert.equal(repaired.image.syncStatus, "ok");
  assert.equal((await repository.getImageById(image.id)).storageKey, "elegant-beauty/wallpaper-beauty-011.png");
});

test("admin images import handler is no longer available after gallery split", async () => {
  const env = createTestEnv();

  const response = await adminImportHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ recursive: true }),
    }),
  });

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: "Image import has been removed from Gallery.",
  });
});





