import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { RemoteImageCacheService } from "../dist/services/remote-image-cache-service.js";

const FIRST_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PUBLIC_ID = "22222222-2222-4222-8222-222222222222";

function config(remoteCacheRoot) {
  return {
    baseUrl: "https://gallery.example.com",
    adminKey: "test-key",
    uploadRoots: [],
    remoteCacheRoot,
    remoteCacheConcurrency: 2,
    requestTimeoutMs: 1000,
    uploadTimeoutMs: 1000,
    maxFileBytes: 1024 * 1024,
    uploadConcurrency: 4,
    uploadChunkSize: 20,
  };
}

function galleryImage({ id, publicId, contentSha256, fileName = `${id}.png`, fileUrl = `https://gallery.example.com/file/${id}.png` }) {
  return {
    id,
    publicId,
    contentSha256,
    fileName,
    fileUrl,
    width: 2,
    height: 3,
    tags: [],
  };
}

async function samplePng() {
  return await sharp({ create: { width: 2, height: 3, channels: 3, background: "#2266aa" } }).png().toBuffer();
}

test("remote cache keys records by permanent ID and content by SHA-256", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const bytes = await samplePng();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const images = new Map([
      [1, galleryImage({ id: 1, publicId: FIRST_PUBLIC_ID, contentSha256: hash })],
      [2, galleryImage({ id: 2, publicId: SECOND_PUBLIC_ID, contentSha256: hash })],
    ]);
    let downloads = 0;
    const service = new RemoteImageCacheService({
      async getImage(identifier) {
        const image = [...images.values()].find((item) => item.id === identifier || item.publicId === identifier);
        assert.ok(image);
        return image;
      },
    }, config(root), {
      fetchImpl: async () => {
        downloads += 1;
        return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
      },
    });

    const first = await service.cache(1, "vision-v1", false, true);
    assert.equal(first.downloaded, true);
    assert.equal(first.cache_hit, false);
    assert.equal(first.content_sha256, hash);
    assert.equal(first.should_analyze, true);
    assert.equal(downloads, 1);
    assert.deepEqual(await readFile(first.local_path), bytes);

    images.set(1, galleryImage({
      id: 1,
      publicId: FIRST_PUBLIC_ID,
      contentSha256: hash,
      fileName: "renamed.png",
      fileUrl: "https://gallery.example.com/file/renamed.png",
    }));
    const renamed = await service.cache(FIRST_PUBLIC_ID, "vision-v1", false, true);
    assert.equal(renamed.downloaded, false);
    assert.equal(renamed.image_mapping_reused, true);
    assert.equal(downloads, 1, "a remote rename must not download or reprocess unchanged content");

    const marked = await service.markAnalyzed(1, hash, "vision-v1", "proposal:1", true);
    assert.equal(marked.changed, true);
    assert.equal(marked.analysis_status, "analyzed");

    const corrected = await service.markAnalyzed(1, hash, "vision-v1", "proposal:corrected", true);
    assert.equal(corrected.changed, true);
    assert.equal(corrected.reference_changed, true);
    assert.equal(corrected.result_reference, "proposal:corrected");
    const unchanged = await service.markAnalyzed(1, hash, "vision-v1", undefined, true);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.result_reference, "proposal:corrected", "omitting the reference must preserve it");
    const cleared = await service.markAnalyzed(1, hash, "vision-v1", null, true);
    assert.equal(cleared.changed, true);
    assert.equal(cleared.result_reference, null);

    const duplicate = await service.cache(2, "vision-v1", false, true);
    assert.equal(duplicate.downloaded, false);
    assert.equal(duplicate.content_object_reused, true);
    assert.equal(duplicate.duplicate_content, true);
    assert.deepEqual(duplicate.duplicate_public_ids, [FIRST_PUBLIC_ID]);
    assert.equal(duplicate.should_analyze, false, "analysis is reused only for byte-identical content and the same version");
    assert.equal(downloads, 1, "the duplicate record must reuse the SHA-addressed object");

    const newerRules = await service.getStatus(2, "vision-v2");
    assert.equal(newerRules.cache_status, "cached");
    assert.equal(newerRules.analysis_status, "pending");
    assert.equal(newerRules.should_analyze, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote cache repairs damaged objects by downloading verified bytes again", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const bytes = await samplePng();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const image = galleryImage({ id: 1, publicId: FIRST_PUBLIC_ID, contentSha256: hash });
    let downloads = 0;
    const service = new RemoteImageCacheService({ getImage: async () => image }, config(root), {
      fetchImpl: async () => {
        downloads += 1;
        return new Response(bytes, { status: 200 });
      },
    });

    const first = await service.cache(1, "vision-v1", false, true);
    await writeFile(first.local_path, Buffer.from("damaged"));
    const repaired = await service.cache(1, "vision-v1", false, true);

    assert.equal(repaired.downloaded, true);
    assert.equal(downloads, 2);
    assert.deepEqual(await readFile(repaired.local_path), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote cache refuses content that disagrees with Gallery's hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const bytes = await samplePng();
    const image = galleryImage({ id: 1, publicId: FIRST_PUBLIC_ID, contentSha256: "a".repeat(64) });
    const service = new RemoteImageCacheService({ getImage: async () => image }, config(root), {
      fetchImpl: async () => new Response(bytes, { status: 200 }),
    });

    await assert.rejects(
      () => service.cache(1, "vision-v1", false, true),
      (error) => error.code === "REMOTE_IMAGE_HASH_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote cache rejects cross-origin image URLs before downloading", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const bytes = await samplePng();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const image = galleryImage({
      id: 1,
      publicId: FIRST_PUBLIC_ID,
      contentSha256: hash,
      fileUrl: "https://other.example.com/file/1.png",
    });
    let downloads = 0;
    const service = new RemoteImageCacheService({ getImage: async () => image }, config(root), {
      fetchImpl: async () => {
        downloads += 1;
        return new Response(bytes, { status: 200 });
      },
    });

    await assert.rejects(
      () => service.cache(1, "vision-v1", false, true),
      (error) => error.code === "REMOTE_IMAGE_URL_FORBIDDEN"
        && error.details?.expected_origin === "https://gallery.example.com"
        && error.details?.actual_origin === "https://other.example.com",
    );
    assert.equal(downloads, 0, "a forbidden origin must be rejected before fetch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzed state requires a matching cached hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const bytes = await samplePng();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const image = galleryImage({ id: 1, publicId: FIRST_PUBLIC_ID, contentSha256: hash });
    const service = new RemoteImageCacheService({ getImage: async () => image }, config(root), {
      fetchImpl: async () => new Response(bytes, { status: 200 }),
    });

    await assert.rejects(
      () => service.markAnalyzed(1, hash, "vision-v1", undefined, true),
      (error) => error.code === "REMOTE_IMAGE_NOT_CACHED",
    );
    await service.cache(1, "vision-v1", false, true);
    await assert.rejects(
      () => service.markAnalyzed(1, "b".repeat(64), "vision-v1", undefined, true),
      (error) => error.code === "REMOTE_CACHE_HASH_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote cache requires explicit visual-analysis authorization before network access", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const bytes = await samplePng();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const image = galleryImage({ id: 1, publicId: FIRST_PUBLIC_ID, contentSha256: hash });
    let downloads = 0;
    const service = new RemoteImageCacheService({ getImage: async () => image }, config(root), {
      fetchImpl: async () => {
        downloads += 1;
        return new Response(bytes, { status: 200 });
      },
    });

    await assert.rejects(
      () => service.cache(1, "vision-v1"),
      (error) => error.code === "VISUAL_ANALYSIS_NOT_AUTHORIZED",
    );
    assert.equal(downloads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote cache refuses images without a valid Gallery content hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const image = galleryImage({ id: 1, publicId: FIRST_PUBLIC_ID, contentSha256: null });
    let downloads = 0;
    const service = new RemoteImageCacheService({ getImage: async () => image }, config(root), {
      fetchImpl: async () => {
        downloads += 1;
        return new Response(await samplePng(), { status: 200 });
      },
    });

    await assert.rejects(
      () => service.cache(1, "vision-v1", false, true),
      (error) => error.code === "REMOTE_IMAGE_HASH_MISSING",
    );
    assert.equal(downloads, 0, "missing identity hashes must fail before cache reuse or download");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote cache batches bound concurrency and return actionable status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-remote-cache-"));
  try {
    const images = new Map();
    const bytesById = new Map();
    for (let id = 1; id <= 4; id += 1) {
      const bytes = await sharp({
        create: { width: 2, height: 3, channels: 3, background: { r: id * 30, g: id * 20, b: id * 10 } },
      }).png().toBuffer();
      const publicId = `0000000${id}-0000-4000-8000-00000000000${id}`;
      const hash = createHash("sha256").update(bytes).digest("hex");
      images.set(id, galleryImage({ id, publicId, contentSha256: hash }));
      bytesById.set(id, bytes);
    }
    let active = 0;
    let maximumActive = 0;
    const service = new RemoteImageCacheService({
      async getImage(identifier) {
        const image = [...images.values()].find((item) => item.id === identifier || item.publicId === identifier);
        assert.ok(image);
        return image;
      },
    }, config(root), {
      fetchImpl: async (input) => {
        const id = Number(new URL(input).pathname.match(/(\d+)\.png$/)?.[1]);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return new Response(bytesById.get(id), { status: 200 });
      },
    });
    const items = [...images.values()].map((image) => ({
      clientItemId: `item-${image.id}`,
      identifier: image.publicId,
    }));

    const cached = await service.cacheBatch(items, "vision-v1", {
      forceRefresh: false,
      continueOnError: true,
      resultDetail: "all",
    }, true);
    assert.equal(cached.total_count, 4);
    assert.equal(cached.failed_count, 0);
    assert.equal(cached.pending_analysis_count, 4);
    assert.ok(maximumActive > 1);
    assert.ok(maximumActive <= 2, `expected at most 2 concurrent downloads, got ${maximumActive}`);

    const status = await service.getStatusBatch(items, "vision-v1", "actionable");
    assert.equal(status.total_count, 4);
    assert.equal(status.actionable_count, 4);
    assert.equal(status.items.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
