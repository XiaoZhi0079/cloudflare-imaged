import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as adminUploadInitHandler } from "../functions/api/admin/images/upload/init.js";
import { onRequest as adminUploadCompleteHandler } from "../functions/api/admin/images/upload/complete.js";

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
      });

      return { key };
    },
    async head(key) {
      const entry = objects.get(key);
      if (!entry) {
        return null;
      }

      return {
        key,
        size: entry.body.byteLength,
        httpMetadata: { ...(entry.httpMetadata ?? {}) },
      };
    },
  };
}

function createTestEnv() {
  const database = new DatabaseSync(":memory:");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  database.exec(schema);

  return {
    GALLERY_DB: database,
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_ADMIN_KEY: "gallery-secret",
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
    GALLERY_UPLOAD_NAME_TYPE: "origin",
    R2_ACCOUNT_ID: "account-123",
    R2_BUCKET_NAME: "gallery",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
  };
}

test("admin upload init handler requires a category and uses its directory slug in storage keys", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const scenery = (await repository.listCategories()).find((category) => category.directory_slug === "scenery");

  const failureResponse = await adminUploadInitHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload/init", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        tagIds: [campus.id],
        files: [{ name: "campus-01.webp", type: "image/webp", size: 12345 }],
      }),
    }),
  });

  assert.equal(failureResponse.status, 400);
  assert.deepEqual(await failureResponse.json(), {
    error: "请选择一个主分类。",
  });

  const successResponse = await adminUploadInitHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload/init", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        categoryId: scenery.id,
        tagIds: [campus.id],
        files: [{ name: "campus-01.webp", type: "image/webp", size: 12345 }],
      }),
    }),
  });

  assert.equal(successResponse.status, 200);
  const payload = await successResponse.json();
  assert.equal(payload.uploads[0].storageKey, "scenery/campus-01.webp");
  assert.equal(payload.uploads[0].category.directorySlug, "scenery");
});

test("admin upload complete handler stores image category metadata", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const category = (await repository.listCategories()).find((item) => item.directory_slug === "sexy-beauty");

  await env.GALLERY_BUCKET.put("sexy-beauty/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });

  const response = await adminUploadCompleteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        categoryId: category.id,
        tagIds: [campus.id],
        files: [
          {
            storageKey: "sexy-beauty/campus-01.webp",
            fileName: "campus-01.webp",
            width: 900,
            height: 1350,
          },
        ],
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    uploadedCount: 1,
    images: [
      {
        id: 1,
        fileName: "campus-01.webp",
        fileUrl: "https://gallery.example.com/file/sexy-beauty/campus-01.webp",
        width: 900,
        height: 1350,
        featuredEligibility: {
          dimensions: "900×1350",
          isExactSixteenNine: false,
          meetsMinimum: false,
          eligible: false,
          is4K: false,
          qualityLabel: null,
          statusLabel: "比例不符",
          reason: "比例不符",
        },
        tags: ["校园风情"],
        category: {
          id: category.id,
          name: "性感美人",
          directorySlug: "sexy-beauty",
          sortOrder: 1,
        },
      },
    ],
  });
});
