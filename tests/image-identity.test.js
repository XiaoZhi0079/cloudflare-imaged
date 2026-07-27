import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { calculateFileSha256 } from "../public/assets/admin/upload.js";
import { onRequest as imageByIdHandler } from "../functions/api/admin/images/[id].js";
import { onRequest as contentHashesHandler } from "../functions/api/admin/images/content-hashes.js";
import { onRequest as computeContentHashHandler } from "../functions/api/admin/images/content-hashes/compute.js";
import { onRequest as tagAssignmentsHandler } from "../functions/api/admin/images/tag-assignments.js";
import { hashResponseBody } from "../scripts/backfill-image-hashes.mjs";
import { createTestDatabase } from "./helpers/test-database.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function adminRequest(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-gallery-admin-key": "secret",
      ...(options.headers ?? {}),
    },
  });
}

test("identity migration gives every existing image a unique UUID without inventing a content hash", () => {
  const database = new DatabaseSync(":memory:");
  for (let number = 1; number <= 5; number += 1) {
    database.exec(readFileSync(new URL(`../migrations/000${number}_${[
      "baseline",
      "albums",
      "tag_groups",
      "upload_sessions",
      "upload_operations_and_paging",
    ][number - 1]}.sql`, import.meta.url), "utf8"));
  }
  const insert = database.prepare("INSERT INTO images (storage_key, file_name, file_url) VALUES (?, ?, ?)");
  for (let index = 1; index <= 20; index += 1) {
    insert.run(`gallery/${index}.webp`, `${index}.webp`, `/file/gallery/${index}.webp`);
  }
  database.prepare(`
    INSERT INTO upload_sessions (
      id, storage_key, file_name, file_url, content_type, file_size,
      tag_ids, status, image_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 1)
  `).run(
    "6af0b175-3c6b-4a20-a1ab-52b77fbab671",
    "gallery/1.webp",
    "1.webp",
    "/file/gallery/1.webp",
    "image/webp",
    123,
    "[]",
  );

  database.exec(readFileSync(new URL("../migrations/0006_image_identity_and_hash.sql", import.meta.url), "utf8"));
  const rows = database.prepare("SELECT public_id AS publicId, content_sha256 AS contentSha256 FROM images").all();
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((row) => row.publicId)).size, 20);
  assert.ok(rows.every((row) => UUID_PATTERN.test(row.publicId) && row.contentSha256 === null));
  const completedIdentity = database.prepare(`
    SELECT images.public_id AS imagePublicId, upload_sessions.public_id AS sessionPublicId
    FROM upload_sessions
    INNER JOIN images ON images.id = upload_sessions.image_id
  `).get();
  assert.equal(completedIdentity.sessionPublicId, completedIdentity.imagePublicId);
});

test("upload completion preserves the session public ID and content SHA-256 across retries", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const tag = await repository.createTag({ name: "身份测试", isVisible: true });
  const category = (await repository.listCategories())[0];
  const uploadId = "6af0b175-3c6b-4a20-a1ab-52b77fbab671";
  const publicId = "a9e03cb1-6fab-4e08-a623-579287246f30";
  const contentSha256 = createHash("sha256").update("original bytes").digest("hex");
  await repository.reserveUploadSession({
    id: uploadId,
    publicId,
    contentSha256,
    storageKey: "gallery/identity.webp",
    fileName: "identity.webp",
    fileUrl: "/file/gallery/identity.webp",
    contentType: "image/webp",
    fileSize: 14,
    width: 1920,
    height: 1080,
    categoryId: category.id,
    tagIds: [tag.id],
  });

  const first = await repository.completeUploadSession(uploadId);
  const second = await repository.completeUploadSession(uploadId);
  assert.equal(first.image.publicId, publicId);
  assert.equal(first.image.contentSha256, contentSha256);
  assert.equal(second.image.id, first.image.id);
  assert.equal(second.image.publicId, publicId);
});

test("admin exact reads accept public IDs and expose hashes only in the admin shape", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const hash = "a".repeat(64);
  const image = await repository.upsertImage({
    publicId: "a9e03cb1-6fab-4e08-a623-579287246f30",
    contentSha256: hash,
    storageKey: "gallery/exact.webp",
    fileName: "exact.webp",
    fileUrl: "/file/gallery/exact.webp",
    width: 1920,
    height: 1080,
  });
  const response = await imageByIdHandler({
    env: { GALLERY_DB: database, GALLERY_ADMIN_KEY: "secret" },
    request: adminRequest(`https://gallery.example/api/admin/images/${image.publicId}`),
    params: { id: image.publicId },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.image.id, image.id);
  assert.equal(payload.image.publicId, image.publicId);
  assert.equal(payload.image.contentSha256, hash);

  const tag = await repository.createTag({ name: "永久标识", isVisible: true });
  const assignment = await tagAssignmentsHandler({
    env: { GALLERY_DB: database, GALLERY_ADMIN_KEY: "secret" },
    request: adminRequest("https://gallery.example/api/admin/images/tag-assignments", {
      method: "POST",
      body: JSON.stringify({ publicId: image.publicId, tagIds: [tag.id] }),
    }),
  });
  assert.equal(assignment.status, 200);
  assert.deepEqual((await assignment.json()).tagIds, [tag.id]);
});

test("content hash batches reject stale file identity and then verify an exact update", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const image = await repository.upsertImage({
    storageKey: "gallery/hash.webp",
    fileName: "hash.webp",
    fileUrl: "/file/gallery/hash.webp",
    width: 1920,
    height: 1080,
  });
  const contentSha256 = "b".repeat(64);
  const submit = (expectedStorageKey) => contentHashesHandler({
    env: { GALLERY_DB: database, GALLERY_ADMIN_KEY: "secret" },
    request: adminRequest("https://gallery.example/api/admin/images/content-hashes", {
      method: "POST",
      body: JSON.stringify({
        assignments: [{
          imageId: image.id,
          expectedStorageKey,
          expectedFileUrl: image.fileUrl,
          contentSha256,
        }],
      }),
    }),
  });

  const stale = await submit("gallery/moved.webp");
  assert.equal(stale.status, 409);
  assert.equal((await repository.getImageById(image.id)).contentSha256, null);
  const saved = await submit(image.storageKey);
  assert.equal(saved.status, 200);
  assert.equal((await repository.getImageById(image.id)).contentSha256, contentSha256);
});

test("Cloudflare-side hashing reads R2 bytes once and is idempotent", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const image = await repository.upsertImage({
    storageKey: "gallery/cloudflare-hash.webp",
    fileName: "cloudflare-hash.webp",
    fileUrl: "/file/gallery/cloudflare-hash.webp",
    width: 1920,
    height: 1080,
  });
  const bytes = new TextEncoder().encode("R2 internal bytes");
  let reads = 0;
  const env = {
    GALLERY_DB: database,
    GALLERY_ADMIN_KEY: "secret",
    GALLERY_BUCKET: {
      async get(key) {
        assert.equal(key, image.storageKey);
        reads += 1;
        return { size: bytes.byteLength, async arrayBuffer() { return bytes.buffer; } };
      },
    },
  };
  const invoke = () => computeContentHashHandler({
    env,
    request: adminRequest("https://gallery.example/api/admin/images/content-hashes/compute", {
      method: "POST",
      body: JSON.stringify({
        imageId: image.id,
        expectedStorageKey: image.storageKey,
        expectedFileUrl: image.fileUrl,
      }),
    }),
  });

  const first = await invoke();
  const second = await invoke();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).contentSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal((await second.json()).idempotent, true);
  assert.equal(reads, 1);
});

test("browser hashing uses the exact file bytes", async () => {
  const bytes = new TextEncoder().encode("gallery exact bytes");
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(await calculateFileSha256(new Blob([bytes])), expected);
  assert.equal(await hashResponseBody(new Response(bytes)), expected);
});
