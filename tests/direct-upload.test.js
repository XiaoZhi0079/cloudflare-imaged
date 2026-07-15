import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import {
  onRequest as adminUploadInitHandler,
  signDirectUpload,
} from "../functions/api/admin/images/upload/init.js";
import { onRequest as adminUploadCompleteHandler } from "../functions/api/admin/images/upload/complete.js";
import { createTestDatabase } from "./helpers/test-database.js";

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
    async head(key) {
      const entry = objects.get(key);
      if (!entry) {
        return null;
      }

      return {
        key,
        size: entry.body.byteLength,
        httpMetadata: { ...(entry.httpMetadata ?? {}) },
        customMetadata: { ...(entry.customMetadata ?? {}) },
      };
    },
  };
}

function createTestEnv() {
  return {
    GALLERY_DB: createTestDatabase(),
    GALLERY_BUCKET: createMockBucket(),
    GALLERY_ADMIN_KEY: "gallery-secret",
    GALLERY_PUBLIC_BASE_URL: "https://gallery.example.com/file",
    GALLERY_UPLOAD_NAME_TYPE: "origin",
    GALLERY_UPLOAD_FOLDER: "gallery",
    R2_ACCOUNT_ID: "account-123",
    R2_BUCKET_NAME: "gallery",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
  };
}

test("admin upload init handler returns direct-upload descriptors for each selected image", async () => {
  const env = createTestEnv();
  delete env.GALLERY_PUBLIC_BASE_URL;
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const response = await adminUploadInitHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload/init", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        tagIds: [campus.id],
        files: [
          {
            name: "campus-01.webp",
            type: "image/webp",
            size: 12345,
            width: 900,
            height: 1350,
          },
        ],
      }),
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.uploads.length, 1);
  assert.deepEqual(payload.uploads[0].storageKey, "gallery/campus-01.webp");
  assert.deepEqual(payload.uploads[0].fileName, "campus-01.webp");
  assert.deepEqual(payload.uploads[0].fileUrl, "https://gallery.example.com/file/gallery/campus-01.webp");
  assert.deepEqual(payload.uploads[0].method, "PUT");
  assert.deepEqual(payload.uploads[0].headers, {
    "content-type": "image/webp",
  });
  assert.match(
    payload.uploads[0].uploadUrl,
    /^https:\/\/gallery\.account-123\.r2\.cloudflarestorage\.com\/gallery\/campus-01\.webp\?/,
  );
});

test("direct upload signing converts runtime failures into a safe diagnostic", async () => {
  const result = await signDirectUpload(
    { key: "gallery/photo.webp" },
    async () => { throw new TypeError("crypto provider unavailable"); },
  );

  assert.deepEqual(result, {
    error: "生成 R2 直传地址失败：TypeError: crypto provider unavailable",
  });
});

test("admin upload init handler converts unexpected runtime errors into JSON", async () => {
  const env = createTestEnv();
  const response = await adminUploadInitHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload/init", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: "{invalid-json",
    }),
  });

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.match(payload.error, /^初始化上传失败：SyntaxError:/);
});

test("admin upload complete handler stores image records after direct upload succeeds", async () => {
  const env = createTestEnv();
  delete env.GALLERY_PUBLIC_BASE_URL;
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  await env.GALLERY_BUCKET.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
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
        tagIds: [campus.id],
        files: [
          {
            storageKey: "gallery/campus-01.webp",
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
        fileUrl: "https://gallery.example.com/file/gallery/campus-01.webp",
        width: 900,
        height: 1350,
        featuredEligibility: {
          dimensions: "900×1350",
          isExactSixteenNine: false,
          meetsMinimum: false,
          eligible: false,
          is4K: false,
          resolutionTier: null,
          qualityLabel: null,
          statusLabel: "比例不符",
          reason: "比例不符",
        },
        tags: ["校园风情"],
      },
    ],
  });
});

test("admin upload complete handler rejects missing R2 objects", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const response = await adminUploadCompleteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        tagIds: [campus.id],
        files: [
          {
            storageKey: "gallery/missing.webp",
            fileName: "missing.webp",
            width: 900,
            height: 1350,
          },
        ],
      }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "存在未完成上传的图片，请重新上传后再提交。",
  });
});
