import test from "node:test";
import assert from "node:assert/strict";

import { registerImageTools } from "../dist/tools/image-tools.js";

function registeredHandlers(dependencies) {
  const handlers = new Map();
  registerImageTools({
    registerTool(name, _definition, handler) {
      handlers.set(name, handler);
    },
  }, dependencies);
  return handlers;
}

function config() {
  return {
    baseUrl: "https://gallery.example.com",
    adminKey: "test-key",
    uploadRoots: [],
    requestTimeoutMs: 1000,
    uploadTimeoutMs: 1000,
    maxFileBytes: 1024,
    uploadConcurrency: 4,
    uploadChunkSize: 20,
  };
}

test("single-image tag tool directly updates the image without listing the library", async () => {
  let listCalls = 0;
  const updates = [];
  const handlers = registeredHandlers({
    api: {
      listImages: async () => { listCalls += 1; return []; },
      setImageTags: async (imageId, tagIds) => {
        updates.push({ imageId, tagIds });
        return { imageId, tagIds };
      },
    },
    taxonomy: {
      validateTagSelections: async (selections) => selections.flatMap((selection) => selection.tagIds),
    },
    config: config(),
  });

  const response = await handlers.get("gallery_set_image_tags")({
    image_id: 42,
    tag_selections: [{ group_id: 1, tag_ids: [2, 3] }],
    response_format: "json",
  });

  assert.equal(response.isError, undefined);
  assert.equal(listCalls, 0);
  assert.deepEqual(updates, [{ imageId: 42, tagIds: [2, 3] }]);
  assert.deepEqual(response.structuredContent, { imageId: 42, tagIds: [2, 3] });
});

test("batch tag tool sends one heterogeneous assignment request", async () => {
  const calls = [];
  const handlers = registeredHandlers({
    api: {
      setImageTagsBatch: async (assignments) => {
        calls.push(assignments);
        return { updatedCount: assignments.length, assignments };
      },
    },
    taxonomy: {
      validateTagSelections: async (selections) => selections.flatMap((selection) => selection.tagIds),
    },
    config: config(),
  });

  const response = await handlers.get("gallery_set_image_tags_batch")({
    assignments: [
      { image_id: 42, tag_selections: [{ group_id: 1, tag_ids: [2, 3] }] },
      { image_id: 43, tag_selections: [{ group_id: 1, tag_ids: [4] }] },
    ],
    response_format: "json",
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(calls, [[
    { imageId: 42, tagIds: [2, 3] },
    { imageId: 43, tagIds: [4] },
  ]]);
  assert.equal(response.structuredContent.updated_count, 2);
});
