import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PUBLIC_SITE,
  loadPublicBootstrapData,
} from "../public/assets/public-data.js";

test("site response failure falls back without blocking public tags", async () => {
  const fetchImpl = async (url) => {
    if (url === "/api/public/site") {
      return new Response("<!doctype html><title>fallback</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    return Response.json({
      tags: [{ id: 1, name: "人像", slug: "portrait" }],
    });
  };

  const result = await loadPublicBootstrapData(fetchImpl);

  assert.deepEqual(result.site, DEFAULT_PUBLIC_SITE);
  assert.deepEqual(result.tags, [{ id: 1, name: "人像", slug: "portrait" }]);
  assert.deepEqual(result.albums, []);
});

test("album summary failure falls back without blocking tags", async () => {
  const fetchImpl = async (url) => {
    if (url === "/api/public/site") return Response.json(DEFAULT_PUBLIC_SITE);
    if (url === "/api/public/albums") return Response.json({ error: "albums unavailable" }, { status: 500 });
    return Response.json({ tags: [] });
  };
  const result = await loadPublicBootstrapData(fetchImpl);
  assert.deepEqual(result.albums, []);
});

test("public tag failure still rejects bootstrap", async () => {
  const fetchImpl = async (url) => {
    if (url === "/api/public/site") {
      return Response.json({
        issueName: "本期",
        heroCopy: "一句文案",
        issueCount: 0,
        featuredImages: [],
      });
    }

    return Response.json({ error: "tags unavailable" }, { status: 500 });
  };

  await assert.rejects(
    () => loadPublicBootstrapData(fetchImpl),
    /tags unavailable/,
  );
});
