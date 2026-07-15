import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as reorderTagsHandler } from "../functions/api/admin/tags/reorder.js";
import { onRequest as reorderCategoriesHandler } from "../functions/api/admin/categories/reorder.js";
import { createTestDatabase } from "./helpers/test-database.js";

function createTestEnv() {
  return {
    GALLERY_DB: createTestDatabase(),
    GALLERY_ADMIN_KEY: "gallery-secret",
  };
}

function adminRequest(path, items) {
  return new Request(`https://gallery.example.com${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-gallery-admin-key": "gallery-secret",
    },
    body: JSON.stringify({ items }),
  });
}

test("tag reorder handler persists a complete contiguous order", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const alpha = await repository.createTag({ name: "alpha", sortOrder: 1 });
  const bravo = await repository.createTag({ name: "bravo", sortOrder: 2 });
  const charlie = await repository.createTag({ name: "charlie", sortOrder: 3 });

  const response = await reorderTagsHandler({
    env,
    request: adminRequest("/api/admin/tags/reorder", [
      { id: charlie.id, sortOrder: 1 },
      { id: alpha.id, sortOrder: 2 },
      { id: bravo.id, sortOrder: 3 },
    ]),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).tags.map(({ id, sortOrder }) => ({ id, sortOrder })),
    [
      { id: charlie.id, sortOrder: 1 },
      { id: alpha.id, sortOrder: 2 },
      { id: bravo.id, sortOrder: 3 },
    ],
  );
});

test("tag reorder handler rejects duplicate ids and non-contiguous orders", async () => {
  const env = createTestEnv();
  const response = await reorderTagsHandler({
    env,
    request: adminRequest("/api/admin/tags/reorder", [
      { id: 1, sortOrder: 1 },
      { id: 1, sortOrder: 3 },
    ]),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "排序内容无效。" });
});

test("tag reorder handler rejects an incomplete entity set without changing order", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const alpha = await repository.createTag({ name: "alpha", sortOrder: 1 });
  const bravo = await repository.createTag({ name: "bravo", sortOrder: 2 });

  const response = await reorderTagsHandler({
    env,
    request: adminRequest("/api/admin/tags/reorder", [{ id: bravo.id, sortOrder: 1 }]),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "排序内容必须包含全部标签。" });
  assert.deepEqual((await repository.listTags()).map((tag) => tag.id), [alpha.id, bravo.id]);
});

test("category reorder handler persists all categories in the submitted order", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const categories = await repository.listCategories();
  const reversed = [...categories].reverse();

  const response = await reorderCategoriesHandler({
    env,
    request: adminRequest(
      "/api/admin/categories/reorder",
      reversed.map((category, index) => ({ id: category.id, sortOrder: index + 1 })),
    ),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).categories.map(({ id, sortOrder }) => ({ id, sortOrder })),
    reversed.map((category, index) => ({ id: category.id, sortOrder: index + 1 })),
  );
});

test("category reorder handler rejects a non-contiguous order", async () => {
  const env = createTestEnv();
  const response = await reorderCategoriesHandler({
    env,
    request: adminRequest("/api/admin/categories/reorder", [
      { id: 1, sortOrder: 1 },
      { id: 2, sortOrder: 3 },
      { id: 3, sortOrder: 4 },
    ]),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "排序内容无效。" });
});
