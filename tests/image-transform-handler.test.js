import test from "node:test";
import assert from "node:assert/strict";

import { createImageTransformHandler } from "../functions/img/[[path]].js";

function request(url, accept = "") {
  return new Request(url, { headers: accept ? { accept } : {} });
}

test("image transform rejects invalid widths and traversal without fetching", async () => {
  let fetchCount = 0;
  const handler = createImageTransformHandler({
    fetchImpl: async () => { fetchCount += 1; return new Response(); },
  });

  const invalidWidth = await handler({
    request: request("https://gallery.example/img/gallery/one.webp?w=777"),
    params: { path: ["gallery", "one.webp"] },
  });
  const traversal = await handler({
    request: request("https://gallery.example/img/secret.webp?w=640"),
    params: { path: ["..", "secret.webp"] },
  });

  assert.equal(invalidWidth.status, 400);
  assert.equal(traversal.status, 400);
  assert.equal(fetchCount, 0);
});

test("image transform fetches only the same-origin file route with reviewed options", async () => {
  const calls = [];
  const handler = createImageTransformHandler({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response("variant", { status: 200, headers: { "content-type": "image/avif" } });
    },
  });

  const response = await handler({
    request: request(
      "https://gallery.example/img/gallery/night%20sky.webp?w=1280",
      "image/avif,image/webp,image/*",
    ),
    params: { path: ["gallery", "night sky.webp"] },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gallery.example/file/gallery/night%20sky.webp");
  assert.deepEqual(calls[0].options, {
    cf: { image: { fit: "scale-down", width: 1280, quality: 82, format: "avif" } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/avif");
  assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400, stale-while-revalidate=604800");
  assert.equal(await response.text(), "variant");
});

test("image transform accepts Cloudflare catch-all paths delivered as a string", async () => {
  const calls = [];
  const handler = createImageTransformHandler({
    fetchImpl: async (url) => { calls.push(String(url)); return new Response("ok"); },
  });

  const response = await handler({
    request: request("https://gallery.example/img/gallery/one.webp?w=640"),
    params: { path: "gallery/one.webp" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://gallery.example/file/gallery/one.webp"]);
});

test("image transform negotiates webp and otherwise preserves source format", async () => {
  const formats = [];
  const handler = createImageTransformHandler({
    fetchImpl: async (_url, options) => {
      formats.push(options.cf.image.format ?? null);
      return new Response("ok");
    },
  });

  await handler({
    request: request("https://gallery.example/img/gallery/one.png?w=640", "image/webp,image/*"),
    params: { path: ["gallery", "one.png"] },
  });
  await handler({
    request: request("https://gallery.example/img/gallery/one.png?w=640", "image/png,image/*"),
    params: { path: ["gallery", "one.png"] },
  });

  assert.deepEqual(formats, ["webp", null]);
});

test("image transform failures redirect to the original without long caching", async () => {
  for (const fetchImpl of [
    async () => new Response("unavailable", { status: 502 }),
    async () => { throw new Error("transform unavailable"); },
  ]) {
    const handler = createImageTransformHandler({ fetchImpl });
    const response = await handler({
      request: request("https://gallery.example/img/gallery/one.webp?w=960"),
      params: { path: ["gallery", "one.webp"] },
    });

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://gallery.example/file/gallery/one.webp");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
