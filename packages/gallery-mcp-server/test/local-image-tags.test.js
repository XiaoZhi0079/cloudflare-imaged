import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { TaxonomyService } from "../dist/services/taxonomy-service.js";
import { registerLocalImageTagTools } from "../dist/tools/local-image-tag-tools.js";

function registeredHandlers(dependencies) {
  const handlers = new Map();
  registerLocalImageTagTools({
    registerTool(name, _definition, handler) {
      handlers.set(name, handler);
    },
  }, dependencies);
  return handlers;
}

function taxonomy() {
  return {
    tagGroups: [
      { id: 1, name: "默认", slug: "default", sortOrder: 1, tagCount: 1 },
      { id: 3, name: "场景", slug: "scene", sortOrder: 2, tagCount: 1 },
    ],
    tags: [
      { id: 20, name: "气质美人", slug: "elegant", sortOrder: 1, isVisible: true, groupId: 1 },
      { id: 61, name: "卧室", slug: "bedroom", sortOrder: 2, isVisible: true, groupId: 3 },
    ],
    categories: [],
  };
}

function config(root) {
  return {
    baseUrl: "https://gallery.example.com",
    adminKey: "test-key",
    uploadRoots: [root],
    requestTimeoutMs: 1000,
    uploadTimeoutMs: 1000,
    maxFileBytes: 1024 * 1024,
    uploadConcurrency: 4,
    uploadChunkSize: 20,
  };
}

test("local tag tool writes an adjacent sidecar without changing image bytes or online records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-local-tags-"));
  try {
    const imagePath = path.join(root, "sample.png");
    await sharp({ create: { width: 8, height: 6, channels: 3, background: "#ffffff" } }).png().toFile(imagePath);
    const imageBefore = await readFile(imagePath);
    let taxonomyReads = 0;
    const taxonomyService = new TaxonomyService({
      getTaxonomy: async () => {
        taxonomyReads += 1;
        return taxonomy();
      },
    });
    const handlers = registeredHandlers({ taxonomy: taxonomyService, config: config(root) });
    const input = {
      local_path: imagePath,
      tag_selections: [
        { group_id: 1, tag_ids: [20] },
        { group_id: 3, tag_ids: [61] },
      ],
      response_format: "json",
    };

    const first = await handlers.get("gallery_set_local_image_tags")(input);
    const sidecarPath = `${imagePath}.gallery-tags.json`;
    const firstSidecar = await readFile(sidecarPath, "utf8");
    const second = await handlers.get("gallery_set_local_image_tags")(input);
    const secondSidecar = await readFile(sidecarPath, "utf8");
    const imageAfter = await readFile(imagePath);

    assert.equal(first.isError, undefined);
    assert.equal(first.structuredContent.local_only, true);
    assert.equal(first.structuredContent.uploaded, false);
    assert.equal(first.structuredContent.remote_image_updated, false);
    assert.equal(first.structuredContent.changed, true);
    assert.equal(second.structuredContent.changed, false);
    assert.equal(firstSidecar, secondSidecar);
    assert.deepEqual(imageAfter, imageBefore);
    assert.equal(taxonomyReads, 1);

    const document = JSON.parse(firstSidecar);
    assert.equal(document.scope, "local-only");
    assert.deepEqual(document.tag_ids, [20, 61]);
    assert.equal(document.tag_selections[0].tags[0].name, "气质美人");

    const changed = await handlers.get("gallery_set_local_image_tags")({
      ...input,
      tag_selections: [{ group_id: 1, tag_ids: [20] }],
    });
    const changedDocument = JSON.parse(await readFile(sidecarPath, "utf8"));
    assert.equal(changed.structuredContent.changed, true);
    assert.deepEqual(changedDocument.tag_ids, [20]);
    assert.deepEqual(await readFile(imagePath), imageBefore);

    const readResponse = await handlers.get("gallery_get_local_image_tags")({
      local_path: imagePath,
      response_format: "json",
    });
    assert.equal(readResponse.structuredContent.local_only, true);
    assert.equal(readResponse.structuredContent.tags.scope, "local-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local tag batch isolates forbidden paths and never reports an upload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-local-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "gallery-local-outside-"));
  try {
    const insidePath = path.join(root, "inside.png");
    const outsidePath = path.join(outside, "outside.png");
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toFile(insidePath);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toFile(outsidePath);
    const handlers = registeredHandlers({
      taxonomy: new TaxonomyService({ getTaxonomy: async () => taxonomy() }),
      config: config(root),
    });
    const selection = [{ group_id: 1, tag_ids: [20] }];
    const response = await handlers.get("gallery_set_local_image_tags_batch")({
      assignments: [
        { local_path: outsidePath, tag_selections: selection },
        { local_path: insidePath, tag_selections: selection },
      ],
      continue_on_error: true,
      response_format: "json",
    });

    assert.equal(response.structuredContent.local_only, true);
    assert.equal(response.structuredContent.uploaded_count, 0);
    assert.equal(response.structuredContent.remote_updated_count, 0);
    assert.equal(response.structuredContent.success_count, 1);
    assert.equal(response.structuredContent.failure_count, 1);
    assert.equal(response.structuredContent.results[0].code, "LOCAL_PATH_FORBIDDEN");
    assert.equal(response.structuredContent.results[1].success, true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
