import test from "node:test";
import assert from "node:assert/strict";

import {
  AdminApiError,
  AdminUnauthorizedError,
  createAdminApiClient,
} from "../public/assets/admin/api-client.js";
import {
  ADMIN_KEY_STORAGE_KEY,
  createAdminKeyStore,
  verifyAdminKey,
} from "../public/assets/admin/auth.js";

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("admin key store persists trimmed values and clears them", () => {
  const storage = fakeStorage();
  const store = createAdminKeyStore(storage);
  store.set(" gallery-secret ");
  assert.equal(store.get(), "gallery-secret");
  assert.equal(storage.getItem(ADMIN_KEY_STORAGE_KEY), "gallery-secret");
  store.clear();
  assert.equal(store.get(), "");
});

test("api client sends the admin key and parses JSON", async () => {
  let receivedHeaders;
  const client = createAdminApiClient({
    getKey: () => "gallery-secret",
    fetchImpl: async (_url, init) => {
      receivedHeaders = init.headers;
      return new Response('{"tags":[]}', { status: 200 });
    },
  });

  assert.deepEqual(await client.request("/api/admin/tags"), { tags: [] });
  assert.equal(receivedHeaders.get("x-gallery-admin-key"), "gallery-secret");
});

test("api client clears auth on 401", async () => {
  let unauthorized = false;
  const client = createAdminApiClient({
    getKey: () => "secret",
    onUnauthorized: () => { unauthorized = true; },
    fetchImpl: async () => new Response('{"error":"Unauthorized"}', { status: 401 }),
  });

  await assert.rejects(() => client.request("/api/admin/tags"), AdminUnauthorizedError);
  assert.equal(unauthorized, true);
});

test("api client surfaces non-JSON error text", async () => {
  const client = createAdminApiClient({
    getKey: () => "secret",
    fetchImpl: async () => new Response("upstream unavailable", { status: 502 }),
  });

  await assert.rejects(
    () => client.request("/api/admin/images"),
    (error) => error instanceof AdminApiError
      && error.status === 502
      && error.message === "upstream unavailable",
  );
});

test("verifyAdminKey reuses returned tags", async () => {
  const calls = [];
  const tags = [{ id: 1, name: "人像" }];
  const client = {
    async request(path) {
      calls.push(path);
      return { tags };
    },
  };

  assert.equal(await verifyAdminKey(client), tags);
  assert.deepEqual(calls, ["/api/admin/tags"]);
});
