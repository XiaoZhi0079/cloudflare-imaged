import test from "node:test";
import assert from "node:assert/strict";

import { GalleryApiError } from "../dist/errors.js";
import { TaxonomyService } from "../dist/services/taxonomy-service.js";
import { taxonomyView } from "../dist/tools/taxonomy-tools.js";

function taxonomy(overrides = {}) {
  return {
    tagGroups: [
      { id: 1, name: "衣物", slug: "clothing", sortOrder: 1, tagCount: 1 },
      { id: 3, name: "场景", slug: "scene", sortOrder: 2, tagCount: 1 },
    ],
    tags: [
      { id: 2, name: "连衣裙", slug: "dress", sortOrder: 1, isVisible: true, groupId: 1 },
      { id: 4, name: "海边", slug: "beach", sortOrder: 1, isVisible: true, groupId: 3 },
    ],
    categories: [{ id: 7, name: "精选", directorySlug: "featured", sortOrder: 1 }],
    ...overrides,
  };
}

test("ensure operations reuse existing groups and tags without mutation", async () => {
  let mutations = 0;
  const api = {
    getTaxonomy: async () => taxonomy(),
    createTagGroup: async () => { mutations += 1; },
    createTag: async () => { mutations += 1; },
  };
  const service = new TaxonomyService(api, 0);

  assert.equal((await service.ensureTagGroup("衣物")).created, false);
  assert.equal((await service.ensureTag("连衣裙", 1)).created, false);
  assert.equal(mutations, 0);
});

test("ensure tag resolves a concurrent duplicate creation by refreshing taxonomy", async () => {
  let reads = 0;
  const api = {
    getTaxonomy: async () => {
      reads += 1;
      return reads === 1
        ? taxonomy({ tags: [] })
        : taxonomy({ tags: [{ id: 7, name: "比基尼", slug: "bikini", sortOrder: 2, isVisible: true, groupId: 1 }] });
    },
    createTag: async () => {
      throw new GalleryApiError("标签已存在。", { status: 409 });
    },
  };
  const service = new TaxonomyService(api, 0);

  const result = await service.ensureTag("比基尼", 1);

  assert.equal(result.created, false);
  assert.equal(result.tag.id, 7);
  assert.equal(reads, 2);
});

test("grouped selections validate parent-child relationships and flatten for the Gallery API", async () => {
  const service = new TaxonomyService({ getTaxonomy: async () => taxonomy() }, 0);

  const tagIds = await service.validateUploadSelection(7, [
    { groupId: 1, tagIds: [2] },
    { groupId: 3, tagIds: [4] },
  ]);

  assert.deepEqual(tagIds, [2, 4]);
});

test("grouped selections reject mismatched, duplicate, and unknown taxonomy IDs", async () => {
  const service = new TaxonomyService({ getTaxonomy: async () => taxonomy() }, 0);

  await assert.rejects(
    () => service.validateTagSelections([{ groupId: 3, tagIds: [2] }]),
    (error) => error.code === "TAG_GROUP_MISMATCH",
  );
  await assert.rejects(
    () => service.validateTagSelections([
      { groupId: 1, tagIds: [2] },
      { groupId: 1, tagIds: [2] },
    ]),
    (error) => error.code === "DUPLICATE_TAG_GROUP_SELECTION",
  );
  await assert.rejects(
    () => service.validateTagSelections([{ groupId: 1, tagIds: [999] }]),
    (error) => error.code === "TAG_NOT_FOUND",
  );
  await assert.rejects(
    () => service.validateUploadSelection(999, [{ groupId: 1, tagIds: [2] }]),
    (error) => error.code === "DIRECTORY_NOT_FOUND",
  );
});

test("taxonomy MCP view distinguishes upload directories from tag groups", () => {
  const view = taxonomyView(taxonomy());

  assert.equal(view.directories[0].directory_slug, "featured");
  assert.equal(view.tag_groups[0].tags[0].name, "连衣裙");
  assert.equal("categories" in view, false);
});
