import test from "node:test";
import assert from "node:assert/strict";

import {
  compareImageStorage,
  createImageStorageAuditService,
  ImageStorageAuditError,
  listR2ObjectMetadata,
} from "../src/server/image-storage-audit.js";

const records = [
  {
    id: 20,
    storageKey: "elegant-beauty/wallpaper-beauty-001.png",
    fileName: "wallpaper-beauty-001.png",
    syncStatus: "ok",
  },
  {
    id: 34,
    storageKey: "elegant-beauty/wallpaper-beauty-018.png",
    fileName: "wallpaper-beauty-018.png",
    syncStatus: "rename_failed",
    note: "rename failed",
  },
];

const objects = [
  { key: "elegant-beauty/wallpaper-beauty-001.png", size: 100, etag: "one" },
  { key: "elegant-beauty/wallpaper-beauty-011.png", size: 110, etag: "eleven" },
];

test("storage audit finds the unique R2 key left behind by a failed rename", () => {
  const result = compareImageStorage(records, objects);

  assert.deepEqual(result.summary, {
    imageRecords: 2,
    r2Objects: 2,
    missingObjects: 1,
    orphanObjects: 1,
    failedRecords: 1,
    uniqueRepairSuggestions: 1,
  });
  assert.equal(result.missingRecords[0].storageKey, "elegant-beauty/wallpaper-beauty-018.png");
  assert.equal(result.orphanObjects[0].key, "elegant-beauty/wallpaper-beauty-011.png");
  assert.deepEqual(result.suggestions, [{
    imageId: 34,
    missingKey: "elegant-beauty/wallpaper-beauty-018.png",
    existingKey: "elegant-beauty/wallpaper-beauty-011.png",
  }]);
});

test("R2 metadata listing follows cursors without reading object bodies", async () => {
  const calls = [];
  const bucket = {
    async list(options) {
      calls.push(options);
      return options.cursor
        ? { objects: [{ key: "gallery/b.png", size: 2, etag: "b" }], truncated: false }
        : { objects: [{ key: "gallery/a.png", size: 1, etag: "a" }], truncated: true, cursor: "next" };
    },
  };

  const listed = await listR2ObjectMetadata(bucket);

  assert.deepEqual(listed.map((object) => object.key), ["gallery/a.png", "gallery/b.png"]);
  assert.deepEqual(calls, [{ limit: 1000 }, { limit: 1000, cursor: "next" }]);
});

test("storage audit repairs D1 only when its current object is missing and candidate exists", async () => {
  const updates = [];
  const repository = {
    async getImageById(id) {
      return id === 34 ? records[1] : null;
    },
    async getImageByStorageKey() {
      return null;
    },
    async updateImageStorage(id, changes) {
      updates.push({ id, ...changes });
      return { ...records[1], ...changes };
    },
  };
  const bucket = {
    async head(key) {
      return key === "elegant-beauty/wallpaper-beauty-011.png" ? objects[1] : null;
    },
  };
  const service = createImageStorageAuditService({
    repository,
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  const repaired = await service.repairRecord({
    imageId: 34,
    storageKey: "elegant-beauty/wallpaper-beauty-011.png",
  });

  assert.equal(repaired.fileName, "wallpaper-beauty-011.png");
  assert.equal(repaired.syncStatus, "ok");
  assert.equal(updates[0].fileUrl, "https://gallery.example.com/file/elegant-beauty/wallpaper-beauty-011.png");
});

test("storage audit refuses to repair while the D1 target still exists in R2", async () => {
  const repository = {
    async getImageById() { return records[1]; },
    async getImageByStorageKey() { return null; },
  };
  const bucket = {
    async head() { return { size: 1 }; },
  };
  const service = createImageStorageAuditService({
    repository,
    bucket,
    publicBaseUrl: "https://gallery.example.com/file",
  });

  await assert.rejects(
    service.repairRecord({ imageId: 34, storageKey: "elegant-beauty/wallpaper-beauty-011.png" }),
    (error) => error instanceof ImageStorageAuditError && error.code === "CURRENT_OBJECT_STILL_EXISTS",
  );
});
