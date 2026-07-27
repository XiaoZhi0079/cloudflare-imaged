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

  const response = await handlers.get("gallery_set_remote_image_tags")({
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

  const response = await handlers.get("gallery_set_remote_image_tags_batch")({
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

test("single-image tools accept the permanent public ID", async () => {
  const publicId = "a9e03cb1-6fab-4e08-a623-579287246f30";
  const calls = [];
  const handlers = registeredHandlers({
    api: {
      getImage: async (identifier) => {
        calls.push(["get", identifier]);
        return { id: 42, publicId, fileName: "exact.webp", fileUrl: "/file/exact.webp", width: 1, height: 1, tags: [] };
      },
      setImageTags: async (identifier, tagIds) => {
        calls.push(["tags", identifier, tagIds]);
        return { imageId: 42, publicId, tagIds };
      },
    },
    taxonomy: {
      validateTagSelections: async (selections) => selections.flatMap((selection) => selection.tagIds),
    },
    config: config(),
  });

  await handlers.get("gallery_get_image")({ public_id: publicId, response_format: "json" });
  await handlers.get("gallery_set_remote_image_tags")({
    public_id: publicId,
    tag_selections: [{ group_id: 1, tag_ids: [2] }],
    response_format: "json",
  });
  assert.deepEqual(calls, [["get", publicId], ["tags", publicId, [2]]]);
});

test("numeric-ID scan tool preserves the server snapshot cursor", async () => {
  const calls = [];
  const handlers = registeredHandlers({
    api: {
      scanImageIds: async (afterImageId, snapshotMaxImageId, limit) => {
        calls.push({ afterImageId, snapshotMaxImageId, limit });
        return {
          snapshotMaxImageId: snapshotMaxImageId ?? 2000,
          afterImageId,
          count: 2,
          limit,
          hasMore: true,
          nextAfterImageId: 103,
          items: [
            { imageId: 101, publicId: "11111111-1111-4111-8111-111111111111", contentSha256: "a".repeat(64) },
            { imageId: 103, publicId: "33333333-3333-4333-8333-333333333333", contentSha256: "b".repeat(64) },
          ],
        };
      },
    },
    taxonomy: {},
    config: config(),
  });

  const response = await handlers.get("gallery_scan_image_ids")({
    after_image_id: 100,
    snapshot_max_image_id: 2000,
    limit: 50,
    response_format: "json",
  });

  assert.deepEqual(calls, [{ afterImageId: 100, snapshotMaxImageId: 2000, limit: 50 }]);
  assert.equal(response.structuredContent.snapshot_max_image_id, 2000);
  assert.equal(response.structuredContent.next_after_image_id, 103);
  assert.deepEqual(response.structuredContent.items.map((item) => item.image_id), [101, 103]);
});

test("file-name search tool performs one server-side page request", async () => {
  const calls = [];
  const image = {
    id: 42,
    publicId: "11111111-1111-4111-8111-111111111111",
    contentSha256: "a".repeat(64),
    fileName: "asian-dress-0042.png",
    fileUrl: "/file/gallery/asian-dress-0042.png",
    width: 1920,
    height: 1080,
    tags: ["连衣裙"],
  };
  const handlers = registeredHandlers({
    api: {
      searchImagesByName: async (query, limit, offset) => {
        calls.push({ query, limit, offset });
        return { images: [image], totalCount: 1, count: 1, offset, limit, hasMore: false, nextOffset: null };
      },
    },
    taxonomy: {},
    config: config(),
  });

  const response = await handlers.get("gallery_search_images_by_name")({
    name_query: "asian-dress",
    limit: 20,
    offset: 0,
    response_format: "json",
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(calls, [{ query: "asian-dress", limit: 20, offset: 0 }]);
  assert.equal(response.structuredContent.name_query, "asian-dress");
  assert.equal(response.structuredContent.total_count, 1);
  assert.deepEqual(response.structuredContent.images, [{
    image_id: 42,
    public_id: image.publicId,
    content_sha256: image.contentSha256,
    storage_key: null,
    file_name: image.fileName,
    file_url: image.fileUrl,
    width: 1920,
    height: 1080,
    tags: ["连衣裙"],
    directory: null,
  }]);
});
