import test from "node:test";
import assert from "node:assert/strict";

import { GalleryApiClient } from "../dist/services/gallery-client.js";

function config() {
  return {
    baseUrl: "https://gallery.example.com",
    adminKey: "secret-key",
    uploadRoots: [],
    requestTimeoutMs: 1000,
    uploadTimeoutMs: 1000,
    maxFileBytes: 1024,
  };
}

test("Gallery client fetches taxonomy with the admin key", async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/tags")) {
      return Response.json({
        tagGroups: [{ id: 1, name: "衣物", slug: "clothing", sortOrder: 1, tagCount: 1 }],
        tags: [{ id: 2, name: "连衣裙", slug: "dress", sortOrder: 1, isVisible: true, groupId: 1 }],
      });
    }
    return Response.json({ categories: [{ id: 3, name: "气质美人", directorySlug: "elegant-beauty", sortOrder: 1 }] });
  };
  const client = new GalleryApiClient(config(), { fetchImpl, retryDelayMs: 0 });

  const taxonomy = await client.getTaxonomy();

  assert.equal(taxonomy.tags[0].name, "连衣裙");
  assert.equal(taxonomy.categories[0].directorySlug, "elegant-beauty");
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ init }) => init.headers["x-gallery-admin-key"] === "secret-key"));
});

test("Gallery client retries transient JSON failures but not authorization failures", async () => {
  let attempts = 0;
  const transient = new GalleryApiClient(config(), {
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3
        ? Response.json({ error: "temporary" }, { status: 503 })
        : Response.json({ images: [] });
    },
  });
  assert.deepEqual(await transient.listImages(), []);
  assert.equal(attempts, 3);

  let authAttempts = 0;
  const unauthorized = new GalleryApiClient(config(), {
    retryDelayMs: 0,
    fetchImpl: async () => {
      authAttempts += 1;
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    },
  });
  await assert.rejects(() => unauthorized.listImages(), (error) => error.status === 401 && error.retryable === false);
  assert.equal(authAttempts, 1);
});

test("R2 upload receives only signed headers and never the Gallery admin key", async () => {
  let captured;
  const client = new GalleryApiClient(config(), {
    fetchImpl: async (input, init) => {
      captured = { input: String(input), init };
      return new Response(null, { status: 200 });
    },
  });
  await client.putObject({
    uploadId: "6af0b175-3c6b-4a20-a1ab-52b77fbab671",
    storageKey: "gallery/example.png",
    fileName: "example.png",
    fileUrl: "https://gallery.example.com/file/gallery/example.png",
    contentType: "image/png",
    method: "PUT",
    headers: { "content-type": "image/png" },
    uploadUrl: "https://r2.example.com/signed",
  }, Buffer.from([1, 2, 3]));

  assert.equal(captured.input, "https://r2.example.com/signed");
  assert.deepEqual(captured.init.headers, { "content-type": "image/png" });
  assert.equal(captured.init.headers["x-gallery-admin-key"], undefined);
});

test("Gallery client uses server pagination, exact image reads, and heterogeneous tag batches", async () => {
  const requests = [];
  const client = new GalleryApiClient(config(), {
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(init.body) : null;
      requests.push({ url, init, body });
      if (url.pathname.endsWith("/tag-assignments/bulk")) {
        return Response.json({ updatedCount: 2, assignments: body.assignments });
      }
      if (url.pathname.endsWith("/images/42")) {
        return Response.json({ image: { id: 42, fileName: "exact.webp", fileUrl: "/file/exact.webp", width: 1920, height: 1080, tags: [] } });
      }
      return Response.json({ images: [], totalCount: 1698, count: 0, offset: 100, limit: 50, hasMore: true, nextOffset: 150 });
    },
  });

  const page = await client.listImagesPage("dress", 50, 100);
  const image = await client.getImage(42);
  const batch = await client.setImageTagsBatch([
    { imageId: 42, tagIds: [2, 3] },
    { imageId: 43, tagIds: [4] },
  ]);

  assert.equal(page.totalCount, 1698);
  assert.equal(image.id, 42);
  assert.equal(batch.updatedCount, 2);
  assert.equal(requests[0].url.pathname, "/api/admin/images");
  assert.equal(requests[0].url.search, "?query=dress&limit=50&offset=100");
  assert.equal(requests[1].url.pathname, "/api/admin/images/42");
  assert.equal(requests[2].url.pathname, "/api/admin/images/tag-assignments/bulk");
  assert.deepEqual(requests[2].body, {
    assignments: [
      { imageId: 42, tagIds: [2, 3] },
      { imageId: 43, tagIds: [4] },
    ],
  });
});

test("Gallery client renames one image and moves a bounded image set", async () => {
  const requests = [];
  const renamed = { id: 42, publicId: "11111111-1111-4111-8111-111111111111", fileName: "renamed.png", fileUrl: "/file/renamed.png", width: 1, height: 1, tags: [] };
  const client = new GalleryApiClient(config(), {
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(init.body) : null;
      requests.push({ url, init, body });
      if (url.pathname.endsWith("/category-assignments/bulk")) {
        return Response.json({ images: [{ ...renamed, category: { id: 3, name: "目录", directorySlug: "folder", sortOrder: 0 } }], failed: [] });
      }
      return Response.json({ image: renamed });
    },
  });

  assert.equal((await client.renameImage(42, "renamed.png")).fileName, "renamed.png");
  const moved = await client.moveImagesToCategory([42], 3);

  assert.equal(moved.images[0].category.id, 3);
  assert.deepEqual(requests.map(({ url, init, body }) => ({
    path: url.pathname,
    method: init.method,
    body,
  })), [
    { path: "/api/admin/images", method: "PATCH", body: { imageId: 42, fileName: "renamed.png" } },
    { path: "/api/admin/images/category-assignments/bulk", method: "POST", body: { imageIds: [42], categoryId: 3 } },
  ]);
});

test("Gallery client scans a fixed numeric-ID snapshot without OFFSET pagination", async () => {
  const requests = [];
  const client = new GalleryApiClient(config(), {
    retryDelayMs: 0,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      return Response.json({
        snapshotMaxImageId: 2000,
        afterImageId: 100,
        count: 2,
        limit: 50,
        hasMore: true,
        nextAfterImageId: 103,
        items: [
          { imageId: 101, publicId: "11111111-1111-4111-8111-111111111111", contentSha256: "a".repeat(64) },
          { imageId: 103, publicId: "33333333-3333-4333-8333-333333333333", contentSha256: "b".repeat(64) },
        ],
      });
    },
  });

  const first = await client.scanImageIds(0, null, 50);
  const continued = await client.scanImageIds(100, 2000, 50);

  assert.equal(first.snapshotMaxImageId, 2000);
  assert.equal(continued.nextAfterImageId, 103);
  assert.equal(requests[0].search, "?after_id=0&limit=50");
  assert.equal(requests[1].search, "?after_id=100&limit=50&snapshot_max_id=2000");
  assert.ok(requests.every((url) => !url.searchParams.has("offset")));
});
