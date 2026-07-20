import test from "node:test";
import assert from "node:assert/strict";

import {
  createImageRelocationService,
  ImageRelocationError,
  validateManagedFileName,
} from "../src/server/image-relocation.js";

const image = Object.freeze({
  id: 34,
  storageKey: "elegant-beauty/wallpaper-beauty-011.png",
  fileName: "wallpaper-beauty-011.png",
  fileUrl: "https://gallery.example.com/file/elegant-beauty/wallpaper-beauty-011.png",
  syncStatus: "ok",
  tags: ["气质美女"],
});

function createRepository({ failStorageUpdate = false } = {}) {
  const states = [];
  return {
    states,
    async updateImageSyncState(imageId, state) {
      states.push({ imageId, ...state });
      return { ...image, ...state };
    },
    async updateImageStorage(imageId, changes) {
      if (failStorageUpdate) throw new Error("D1 unavailable");
      return { ...image, id: imageId, ...changes };
    },
  };
}

test("image relocation records pending state and commits renamed metadata", async () => {
  const repository = createRepository();
  const calls = [];
  const storage = {
    async renameImage(sourceKey, targetKey) {
      calls.push({ sourceKey, targetKey });
      return {
        storageKey: targetKey,
        fileName: targetKey.split("/").pop(),
        fileUrl: `https://gallery.example.com/file/${targetKey}`,
      };
    },
  };
  const service = createImageRelocationService({ repository, storage });

  const updated = await service.rename(image, "wallpaper-beauty-018.png");

  assert.equal(repository.states[0].syncStatus, "rename_pending");
  assert.equal(updated.storageKey, "elegant-beauty/wallpaper-beauty-018.png");
  assert.equal(updated.syncStatus, "ok");
  assert.deepEqual(calls, [{
    sourceKey: "elegant-beauty/wallpaper-beauty-011.png",
    targetKey: "elegant-beauty/wallpaper-beauty-018.png",
  }]);
});

test("image relocation preserves a typed storage conflict and failed state", async () => {
  const repository = createRepository();
  const storage = {
    async renameImage() {
      const error = new Error("target exists");
      error.code = "TARGET_OBJECT_EXISTS";
      throw error;
    },
  };
  const service = createImageRelocationService({ repository, storage });

  await assert.rejects(
    service.rename(image, "wallpaper-beauty-018.png"),
    (error) => error instanceof ImageRelocationError && error.code === "TARGET_OBJECT_EXISTS",
  );
  assert.equal(repository.states.at(-1).syncStatus, "rename_failed");
});

test("image relocation rolls R2 back when the D1 storage update fails", async () => {
  const repository = createRepository({ failStorageUpdate: true });
  const calls = [];
  const storage = {
    async renameImage(sourceKey, targetKey) {
      calls.push({ sourceKey, targetKey });
      return {
        storageKey: targetKey,
        fileName: targetKey.split("/").pop(),
        fileUrl: `https://gallery.example.com/file/${targetKey}`,
      };
    },
  };
  const service = createImageRelocationService({ repository, storage });

  await assert.rejects(
    service.rename(image, "wallpaper-beauty-018.png"),
    (error) => error.code === "METADATA_UPDATE_FAILED" && error.repairRequired === false,
  );
  assert.deepEqual(calls, [
    {
      sourceKey: "elegant-beauty/wallpaper-beauty-011.png",
      targetKey: "elegant-beauty/wallpaper-beauty-018.png",
    },
    {
      sourceKey: "elegant-beauty/wallpaper-beauty-018.png",
      targetKey: "elegant-beauty/wallpaper-beauty-011.png",
    },
  ]);
  assert.equal(repository.states.at(-1).syncStatus, "rename_failed");
});

test("image relocation marks repair required when metadata update and rollback both fail", async () => {
  const repository = createRepository({ failStorageUpdate: true });
  let calls = 0;
  const storage = {
    async renameImage(sourceKey, targetKey) {
      calls += 1;
      if (calls === 2) throw new Error("rollback unavailable");
      return {
        storageKey: targetKey,
        fileName: targetKey.split("/").pop(),
        fileUrl: `https://gallery.example.com/file/${targetKey}`,
      };
    },
  };
  const service = createImageRelocationService({ repository, storage });

  await assert.rejects(
    service.rename(image, "wallpaper-beauty-018.png"),
    (error) => error.code === "RELOCATION_ROLLBACK_FAILED" && error.repairRequired === true,
  );
  assert.equal(repository.states.at(-1).syncStatus, "repair_required");
});

test("managed file names reject paths and control characters", () => {
  assert.equal(validateManagedFileName("wallpaper-beauty-018.png"), "wallpaper-beauty-018.png");
  assert.throws(() => validateManagedFileName("nested/name.png"), /Invalid managed file name/);
  assert.throws(() => validateManagedFileName("bad\nname.png"), /Invalid managed file name/);
});
