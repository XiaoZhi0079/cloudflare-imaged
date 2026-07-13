import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as bulkCategoryHandler } from "../functions/api/admin/images/category-assignments/bulk.js";

function createMockBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, {
        body: value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(await value.arrayBuffer()),
        httpMetadata: { ...(options.httpMetadata ?? {}) },
        customMetadata: { ...(options.customMetadata ?? {}) },
      });
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? {
            body: new Uint8Array(object.body),
            httpMetadata: { ...object.httpMetadata },
            customMetadata: { ...object.customMetadata },
          }
        : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function createTestEnv() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    GALLERY_DB: database,
    GALLERY_ADMIN_KEY: "gallery-secret",
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
    GALLERY_BUCKET: createMockBucket(),
  };
}

function adminRequest(payload) {
  return new Request("https://gallery.example.com/api/admin/images/category-assignments/bulk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gallery-admin-key": "gallery-secret",
    },
    body: JSON.stringify(payload),
  });
}

async function createImage(repository, bucket, name) {
  const storageKey = `gallery/${name}`;
  await bucket.put(storageKey, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });
  return await repository.upsertImage({
    storageKey,
    fileName: name,
    fileUrl: `https://gallery.example.com/file/${storageKey}`,
    width: 800,
    height: 600,
    syncStatus: "ok",
  });
}

test("bulk category assignment moves files and updates category metadata", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const scenery = (await repository.listCategories()).find((category) => category.directory_slug === "scenery");
  const first = await createImage(repository, env.GALLERY_BUCKET, "first.webp");
  const second = await createImage(repository, env.GALLERY_BUCKET, "second.webp");

  const response = await bulkCategoryHandler({
    env,
    request: adminRequest({ imageIds: [first.id, second.id], categoryId: scenery.id }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.failed, []);
  assert.deepEqual(payload.images.map((image) => image.category.id), [scenery.id, scenery.id]);
  assert.equal(env.GALLERY_BUCKET.objects.has("scenery/first.webp"), true);
  assert.equal(env.GALLERY_BUCKET.objects.has("scenery/second.webp"), true);
  assert.equal(env.GALLERY_BUCKET.objects.has("gallery/first.webp"), false);
});

test("bulk category assignment reports failed objects without discarding successes", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const scenery = (await repository.listCategories()).find((category) => category.directory_slug === "scenery");
  const first = await createImage(repository, env.GALLERY_BUCKET, "first.webp");
  const missing = await createImage(repository, env.GALLERY_BUCKET, "missing.webp");
  await env.GALLERY_BUCKET.delete("gallery/missing.webp");

  const response = await bulkCategoryHandler({
    env,
    request: adminRequest({ imageIds: [first.id, missing.id], categoryId: scenery.id }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.images.map((image) => image.id), [first.id]);
  assert.deepEqual(payload.failed, [{ imageId: missing.id, error: "底层文件移动失败。" }]);
  const failedImage = await repository.getImageById(missing.id);
  assert.equal(failedImage.syncStatus, "move_failed");
});

test("bulk category assignment rejects an unknown category before moving", async () => {
  const env = createTestEnv();
  const response = await bulkCategoryHandler({
    env,
    request: adminRequest({ imageIds: [1, 1, 0], categoryId: 999 }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "所选主分类无效。" });
  assert.equal(env.GALLERY_BUCKET.objects.size, 0);
});
