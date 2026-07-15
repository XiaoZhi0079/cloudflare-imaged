import test from "node:test";
import assert from "node:assert/strict";

import { onRequest as adminCategoriesHandler } from "../functions/api/admin/categories.js";
import { createTestDatabase } from "./helpers/test-database.js";

function createTestEnv() {
  return {
    GALLERY_DB: createTestDatabase(),
    GALLERY_ADMIN_KEY: "gallery-secret",
  };
}

test("admin categories handler lists default categories", async () => {
  const env = createTestEnv();

  const response = await adminCategoriesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/categories", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).categories.map((category) => category.directorySlug), [
    "sexy-beauty",
    "elegant-beauty",
    "scenery",
  ]);
});

test("admin categories handler creates a custom category", async () => {
  const env = createTestEnv();

  const response = await adminCategoriesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/categories", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "静物",
        directorySlug: "still-life",
        sortOrder: 4,
      }),
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    category: {
      id: 4,
      name: "静物",
      directorySlug: "still-life",
      sortOrder: 4,
    },
  });
});

test("admin categories handler updates display name without changing directory slug", async () => {
  const env = createTestEnv();

  const response = await adminCategoriesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/categories", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        id: 1,
        name: "性感佳人",
        sortOrder: 3,
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    category: {
      id: 1,
      name: "性感佳人",
      directorySlug: "sexy-beauty",
      sortOrder: 3,
    },
  });
});
