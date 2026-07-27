import test from "node:test";
import assert from "node:assert/strict";

import { processRecognitionManifest } from "../dist/services/recognition-manifest-service.js";

const PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const taxonomySnapshot = {
  tagGroups: [{ id: 1, name: "衣物", slug: "clothing", sortOrder: 0, tagCount: 2 }],
  tags: [
    { id: 10, name: "连衣裙", slug: "dress", sortOrder: 0, isVisible: true, groupId: 1 },
    { id: 11, name: "比基尼", slug: "bikini", sortOrder: 1, isVisible: true, groupId: 1 },
  ],
  categories: [
    { id: 2, name: "旧目录", directorySlug: "old", sortOrder: 0 },
    { id: 3, name: "新目录", directorySlug: "new", sortOrder: 1 },
  ],
};

function image(overrides = {}) {
  return {
    id: 42,
    publicId: PUBLIC_ID,
    contentSha256: HASH,
    storageKey: "old/old.png",
    fileName: "old.png",
    fileUrl: "https://gallery.example.com/file/old/old.png",
    width: 1920,
    height: 1080,
    tags: ["连衣裙"],
    category: taxonomySnapshot.categories[0],
    syncStatus: "ok",
    ...overrides,
  };
}

function manifestItem(overrides = {}) {
  return {
    clientItemId: "image-001",
    publicId: PUBLIC_ID,
    expectedContentSha256: HASH,
    fileName: "recognized.png",
    directoryId: 3,
    tagSelections: [{ groupId: 1, tagIds: [11] }],
    ...overrides,
  };
}

function config() {
  return {
    baseUrl: "https://gallery.example.com",
    adminKey: "test-key",
    uploadRoots: [],
    remoteCacheRoot: "C:/cache",
    remoteCacheConcurrency: 4,
    requestTimeoutMs: 1000,
    uploadTimeoutMs: 1000,
    maxFileBytes: 1024,
    uploadConcurrency: 4,
    uploadChunkSize: 20,
  };
}

function taxonomy() {
  return {
    get: async () => taxonomySnapshot,
    validateUploadSelection: async (directoryId, selections) => {
      assert.ok(taxonomySnapshot.categories.some((category) => category.id === directoryId));
      return selections.flatMap((selection) => selection.tagIds);
    },
  };
}

test("recognition manifest defaults to a read-only preflight plan", async () => {
  let mutations = 0;
  const result = await processRecognitionManifest({
    api: {
      getImage: async () => image(),
      renameImage: async () => { mutations += 1; },
      moveImagesToCategory: async () => { mutations += 1; },
      setImageTagsBatch: async () => { mutations += 1; },
    },
    taxonomy: taxonomy(),
    config: config(),
  }, [manifestItem()], {
    dryRun: true,
    continueOnError: true,
    resultDetail: "all",
    mutationConfirmed: false,
  });

  assert.equal(mutations, 0);
  assert.equal(result.ready_count, 1);
  assert.deepEqual(result.items[0].planned_changes, ["file_name", "directory", "tags"]);
});

test("recognition manifest rejects stale content before any mutation", async () => {
  let mutations = 0;
  const result = await processRecognitionManifest({
    api: {
      getImage: async () => image({ contentSha256: "b".repeat(64) }),
      renameImage: async () => { mutations += 1; },
    },
    taxonomy: taxonomy(),
    config: config(),
  }, [manifestItem()], {
    dryRun: false,
    continueOnError: true,
    resultDetail: "failures",
    mutationConfirmed: true,
  });

  assert.equal(mutations, 0);
  assert.equal(result.failed_count, 1);
  assert.equal(result.failures[0].code, "IMAGE_CONTENT_CHANGED");
  assert.equal(result.failures[0].phase, "preflight");
});

test("recognition manifest applies only changed fields and verifies the final image", async () => {
  const calls = [];
  let current = image();
  const result = await processRecognitionManifest({
    api: {
      getImage: async (identifier) => {
        calls.push(["get", identifier]);
        return current;
      },
      renameImage: async (imageId, fileName) => {
        calls.push(["rename", imageId, fileName]);
        current = image({ ...current, fileName, storageKey: `old/${fileName}` });
        return current;
      },
      moveImagesToCategory: async (imageIds, categoryId) => {
        calls.push(["move", imageIds, categoryId]);
        current = image({ ...current, category: taxonomySnapshot.categories.find((category) => category.id === categoryId) });
        return { images: [current], failed: [] };
      },
      setImageTagsBatch: async (assignments) => {
        calls.push(["tags", assignments]);
        current = image({ ...current, tags: ["比基尼"] });
        return { updatedCount: 1, assignments };
      },
    },
    taxonomy: taxonomy(),
    config: config(),
  }, [manifestItem()], {
    dryRun: false,
    continueOnError: true,
    resultDetail: "all",
    mutationConfirmed: true,
  });

  assert.deepEqual(calls, [
    ["get", PUBLIC_ID],
    ["rename", 42, "recognized.png"],
    ["move", [42], 3],
    ["tags", [{ imageId: 42, tagIds: [11] }]],
    ["get", PUBLIC_ID],
  ]);
  assert.equal(result.updated_count, 1);
  assert.deepEqual(result.items[0].applied_fields, ["file_name", "directory", "tags"]);
  assert.equal(result.items[0].image.id, 42);
  assert.equal(result.items[0].image.publicId, PUBLIC_ID);
});

test("recognition manifest reports completed fields when a later phase fails", async () => {
  let current = image();
  const result = await processRecognitionManifest({
    api: {
      getImage: async () => current,
      renameImage: async (_imageId, fileName) => {
        current = image({ ...current, fileName });
        return current;
      },
      moveImagesToCategory: async () => {
        throw new Error("R2 unavailable");
      },
    },
    taxonomy: taxonomy(),
    config: config(),
  }, [manifestItem()], {
    dryRun: false,
    continueOnError: true,
    resultDetail: "failures",
    mutationConfirmed: true,
  });

  assert.equal(result.failed_count, 1);
  assert.equal(result.failures[0].phase, "directory");
  assert.equal(result.failures[0].partial_update, true);
  assert.deepEqual(result.failures[0].applied_fields, ["file_name"]);
});

test("recognition manifest requires an explicit confirmation for mutation", async () => {
  await assert.rejects(
    () => processRecognitionManifest({ api: {}, taxonomy: taxonomy(), config: config() }, [manifestItem()], {
      dryRun: false,
      continueOnError: true,
      resultDetail: "summary",
      mutationConfirmed: false,
    }),
    (error) => error.code === "MUTATION_CONFIRMATION_REQUIRED",
  );
});
