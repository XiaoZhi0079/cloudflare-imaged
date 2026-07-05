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
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});
