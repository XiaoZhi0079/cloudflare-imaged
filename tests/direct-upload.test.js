import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import {
  onRequest as adminUploadInitHandler,
  signDirectUpload,
} from "../functions/api/admin/images/upload/init.js";
import { onRequest as adminUploadCompleteHandler } from "../functions/api/admin/images/upload/complete.js";
import { createTestDatabase, enforceBoundParameterLimit } from "./helpers/test-database.js";
import { copyR2Object, R2RequestError } from "../src/server/r2-direct-upload.js";

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

function createTestEnv({ database = createTestDatabase(), bucket = createMockBucket() } = {}) {
  return {
    GALLERY_DB: database,
    GALLERY_BUCKET: bucket,
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

test("R2 server-side copy signs a metadata-only CopyObject request", async () => {
  let captured = null;
  const result = await copyR2Object({
    accountId: "account-123",
    bucketName: "gallery",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    sourceKey: "elegant beauty/source image.png",
    destinationKey: "elegant beauty/target image.png",
    now: new Date("2026-07-21T00:00:00.000Z"),
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response("<CopyObjectResult><ETag>copied-etag</ETag></CopyObjectResult>", {
        status: 200,
        headers: { etag: "copied-etag" },
      });
    },
  });

  assert.deepEqual(result, { etag: "copied-etag" });
  assert.equal(
    captured.url,
    "https://gallery.account-123.r2.cloudflarestorage.com/elegant%20beauty/target%20image.png",
  );
  assert.equal(captured.options.method, "PUT");
  assert.equal(
    captured.options.headers["x-amz-copy-source"],
    "/gallery/elegant%20beauty/source%20image.png",
  );
  assert.match(captured.options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access-key\//);
  assert.equal("body" in captured.options, false);
});

test("R2 server-side copy maps storage conflicts to a typed error", async () => {
  await assert.rejects(
    copyR2Object({
      accountId: "account-123",
      bucketName: "gallery",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      sourceKey: "gallery/source.png",
      destinationKey: "gallery/target.png",
      fetchImpl: async () => new Response("<Error><Code>PreconditionFailed</Code></Error>", { status: 412 }),
    }),
    (error) => error instanceof R2RequestError
      && error.code === "PreconditionFailed"
      && error.status === 409,
  );
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
          isApproximatelySixteenNine: false,
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

test("admin upload complete returns only new images when the library exceeds 100 records", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const insertImage = database.prepare("INSERT INTO images (storage_key, file_name, file_url, width, height) VALUES (?, ?, ?, ?, ?)");
  for (let index = 1; index <= 101; index += 1) {
    const name = `existing-${index}.webp`;
    insertImage.run(`gallery/${name}`, name, `/file/gallery/${name}`, 1920, 1080);
  }
  const guarded = enforceBoundParameterLimit(database);
  const env = createTestEnv({ database: guarded.database });
  await env.GALLERY_BUCKET.put("gallery/new.webp", new Uint8Array([1, 2, 3]));

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
        files: [{ storageKey: "gallery/new.webp", fileName: "new.webp", width: 1920, height: 1080 }],
      }),
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.uploadedCount, 1);
  assert.equal(payload.images.length, 1);
  assert.equal(payload.images[0].fileName, "new.webp");
  assert.ok(guarded.parameterCounts.every((count) => count <= 100));
});

test("admin upload complete converts unexpected failures into structured JSON", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    const response = await adminUploadCompleteHandler({
      env: createTestEnv(),
      request: new Request("https://gallery.example.com/api/admin/images/upload/complete", {
        method: "POST",
        headers: {
          "cf-ray": "test-upload-ray",
          "content-type": "application/json",
          "x-gallery-admin-key": "gallery-secret",
        },
        body: "{invalid-json",
      }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "图片已传入存储，但写入图库失败，请重试失败项。",
      code: "UPLOAD_COMPLETE_FAILED",
      requestId: "test-upload-ray",
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(JSON.parse(errors[0]).service, "gallery-upload-complete");
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
