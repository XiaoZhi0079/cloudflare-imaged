import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/file/[[path]].js";

function createMockBucket() {
  const objects = new Map();

  return {
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, {
        body: new Uint8Array(bytes),
        httpMetadata: { ...(options.httpMetadata ?? {}) },
      });
    },
    async get(key) {
      const entry = objects.get(key);
      if (!entry) {
        return null;
      }

      return {
        body: new Uint8Array(entry.body),
        httpEtag: entry.httpMetadata.etag ?? '"gallery-etag"',
        httpMetadata: { ...(entry.httpMetadata ?? {}) },
        writeHttpMetadata(headers) {
          if (entry.httpMetadata.contentType) {
            headers.set("content-type", entry.httpMetadata.contentType);
          }
        },
      };
    },
  };
}

test("file handler serves images from the gallery bucket", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp" },
  });

  const response = await onRequest({
    env: { GALLERY_BUCKET: bucket },
    params: { path: ["gallery", "campus-01.webp"] },
    request: new Request("https://gallery.example.com/file/gallery/campus-01.webp"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600, must-revalidate");
  assert.equal(response.headers.get("etag"), '"gallery-etag"');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("file handler returns 304 when the R2 etag already matches", async () => {
  const bucket = createMockBucket();
  await bucket.put("gallery/campus-01.webp", new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/webp", etag: '"version-2"' },
  });

  const response = await onRequest({
    env: { GALLERY_BUCKET: bucket },
    params: { path: ["gallery", "campus-01.webp"] },
    request: new Request("https://gallery.example.com/file/gallery/campus-01.webp", {
      headers: { "if-none-match": '"version-2"' },
    }),
  });

  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), '"version-2"');
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600, must-revalidate");
  assert.equal(await response.text(), "");
});

test("file handler prevents browsers from caching missing objects", async () => {
  const response = await onRequest({
    env: { GALLERY_BUCKET: createMockBucket() },
    params: { path: ["gallery", "missing.webp"] },
    request: new Request("https://gallery.example.com/file/gallery/missing.webp"),
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});
