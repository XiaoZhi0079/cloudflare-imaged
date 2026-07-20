import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryStorage, resolvePublicBaseUrl } from "../src/server/gallery-storage.js";

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
      return entry
        ? {
            key,
            size: entry.body.byteLength,
            httpMetadata: { ...(entry.httpMetadata ?? {}) },
            customMetadata: { ...(entry.customMetadata ?? {}) },
          }
        : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

test("public base URL uses explicit configuration or falls back to the request origin", () => {
  assert.equal(
    resolvePublicBaseUrl("https://cdn.example.com/file/", "https://gallery.example.com/admin/"),
    "https://cdn.example.com/file",
  );
  assert.equal(
    resolvePublicBaseUrl("", "https://gallery.example.com/api/admin/images/upload/init"),
    "https://gallery.example.com/file",
  );
});

test("uploadImage stores the file in the gallery bucket and returns a gallery record", async () => {
  const bucket = createMockBucket();
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  const record = await storage.uploadImage({
    file: new File(["image-bytes"], "campus-01.webp", { type: "image/webp" }),
    uploadNameType: "origin",
    uploadFolder: "gallery",
    imageMeta: { width: 900, height: 1350 },
  });

  assert.deepEqual(record, {
    storageKey: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://gallery.example.com/file/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });
  assert.ok(bucket.objects.has("gallery/campus-01.webp"));
});

test("renameImage renames the stored object inside the gallery bucket", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  const record = await storage.renameImage("gallery/campus-01.webp", "gallery/campus-02.webp");

  assert.deepEqual(record, {
    storageKey: "gallery/campus-02.webp",
    fileName: "campus-02.webp",
    fileUrl: "https://gallery.example.com/file/gallery/campus-02.webp",
    syncStatus: "ok",
  });
  assert.equal(bucket.objects.has("gallery/campus-01.webp"), false);
  assert.ok(bucket.objects.has("gallery/campus-02.webp"));
});

test("renameImage uses server-side copy without reading image bytes through the service", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/source.webp", new Uint8Array([1, 2, 3]));
  let copyCall = null;
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
    serverSideCopy: async (sourceKey, destinationKey) => {
      copyCall = { sourceKey, destinationKey };
      const source = bucket.objects.get(sourceKey);
      bucket.objects.set(destinationKey, {
        body: new Uint8Array(source.body),
        httpMetadata: { ...source.httpMetadata },
        customMetadata: { ...source.customMetadata },
      });
    },
  });

  await storage.renameImage("gallery/source.webp", "gallery/target.webp");

  assert.deepEqual(copyCall, {
    sourceKey: "gallery/source.webp",
    destinationKey: "gallery/target.webp",
  });
  assert.equal(bucket.objects.has("gallery/source.webp"), false);
  assert.equal(bucket.objects.has("gallery/target.webp"), true);
});

test("renameImage never overwrites an existing target object", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/source.webp", new Uint8Array([1]));
  await bucket.put("gallery/target.webp", new Uint8Array([2]));
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  await assert.rejects(
    storage.renameImage("gallery/source.webp", "gallery/target.webp"),
    (error) => error.code === "TARGET_OBJECT_EXISTS" && error.status === 409,
  );
  assert.deepEqual([...bucket.objects.get("gallery/source.webp").body], [1]);
  assert.deepEqual([...bucket.objects.get("gallery/target.webp").body], [2]);
});

test("renameImage completes an explicitly resumed retry when only the target exists", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/target.webp", new Uint8Array([1, 2, 3]));
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  const record = await storage.renameImage("gallery/source.webp", "gallery/target.webp", {
    allowExistingTarget: true,
  });

  assert.equal(record.storageKey, "gallery/target.webp");
  assert.equal(bucket.objects.has("gallery/target.webp"), true);
});

test("renameImage treats an untracked missing-source existing-target state as ambiguous", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/target.webp", new Uint8Array([1, 2, 3]));
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  await assert.rejects(
    storage.renameImage("gallery/source.webp", "gallery/target.webp"),
    (error) => error.code === "RELOCATION_STATE_AMBIGUOUS" && error.status === 409,
  );
});

test("moveImage moves the stored object into another directory", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  const record = await storage.moveImage("gallery/campus-01.webp", "archive");

  assert.deepEqual(record, {
    storageKey: "archive/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://gallery.example.com/file/archive/campus-01.webp",
    syncStatus: "ok",
  });
  assert.equal(bucket.objects.has("gallery/campus-01.webp"), false);
  assert.ok(bucket.objects.has("archive/campus-01.webp"));
});

test("deleteImage removes the stored object from the gallery bucket", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });
  const storage = createGalleryStorage({
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  const result = await storage.deleteImage("gallery/campus-01.webp");

  assert.equal(result, true);
  assert.equal(bucket.objects.has("gallery/campus-01.webp"), false);
});
