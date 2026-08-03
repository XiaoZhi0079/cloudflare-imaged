import test from "node:test";
import assert from "node:assert/strict";

import { createTestDatabase } from "./helpers/test-database.js";
import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as sessionsHandler } from "../functions/api/admin/images/upload/sessions.js";

test("upload session status survives a new request and exposes phase diagnostics", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const [category] = await repository.listCategories();
  const tagGroup = await repository.createTagGroup({ name: "tracking group" });
  const tag = await repository.createTag({ name: "tracking tag", groupId: tagGroup.id });
  const uploadId = "77777777-7777-4777-8777-777777777777";
  const operationId = "88888888-8888-4888-8888-888888888888";
  await repository.reserveUploadSession({
    id: uploadId, publicId: "99999999-9999-4999-8999-999999999999", contentSha256: "cd".repeat(32),
    storageKey: "scenery/tracking.png", fileName: "tracking.png", fileUrl: "https://gallery.test/file/scenery/tracking.png",
    contentType: "image/png", fileSize: 68, width: 1, height: 1, categoryId: category.id,
    tagIds: [tag.id], operationId, clientItemId: "synthetic-1",
  });
  await repository.updateUploadSessionPhase([uploadId], { phase: "failed", errorCode: "SYNTHETIC_FAILURE", errorMessage: "generated test failure" });
  const bucket = { head: async (key) => key === "scenery/tracking.png" ? { size: 68 } : null, delete: async () => {} };
  const response = await sessionsHandler({
    env: { GALLERY_DB: database, GALLERY_BUCKET: bucket, GALLERY_ADMIN_KEY: "secret" },
    request: new Request(`https://gallery.test/api/admin/images/upload/sessions?operation_id=${operationId}`, { headers: { "x-gallery-admin-key": "secret" } }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sessions[0].phase, "failed");
  assert.equal(payload.sessions[0].errorCode, "SYNTHETIC_FAILURE");
  assert.equal(payload.sessions[0].objectPresent, true);
  assert.equal(payload.sessions[0].operationId, operationId);
});
