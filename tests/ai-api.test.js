import test from "node:test";
import assert from "node:assert/strict";

import { createTestDatabase } from "./helpers/test-database.js";
import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as proposalsHandler } from "../functions/api/admin/ai/proposals.js";

function context(database, body) {
  return {
    env: { GALLERY_DB: database, GALLERY_ADMIN_KEY: "secret" },
    request: new Request("https://gallery.test/api/admin/ai/proposals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gallery-admin-key": "secret" },
      body: JSON.stringify(body),
    }),
  };
}

test("AI proposal API returns 200 for no change and 201 only for a review card", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const [category] = await repository.listCategories();
  const image = await repository.upsertImage({
    storageKey: `${category.directory_slug}/api.png`, fileName: "api.png",
    fileUrl: `https://gallery.test/file/${category.directory_slug}/api.png`, categoryId: category.id,
  });
  const noChangeBatch = "11111111-1111-4111-8111-111111111111";
  const changedBatch = "22222222-2222-4222-8222-222222222222";
  await repository.createAiAnalysisBatch({ id: noChangeBatch, name: "API no change", imageIds: [image.id] });
  await repository.createAiAnalysisBatch({ id: changedBatch, name: "API change", imageIds: [image.id] });

  const unchanged = await proposalsHandler(context(database, {
    batchId: noChangeBatch, imageId: image.id, proposedFileName: "api.png",
    proposedCategoryId: category.id, proposedTagIds: [], newTagCandidates: [],
  }));
  const changed = await proposalsHandler(context(database, {
    batchId: changedBatch, imageId: image.id, proposedFileName: "renamed.png",
    proposedCategoryId: category.id, proposedTagIds: [], newTagCandidates: [],
  }));

  assert.equal(unchanged.status, 200);
  assert.equal((await unchanged.json()).outcome, "no_change");
  assert.equal(changed.status, 201);
  assert.equal((await changed.json()).outcome, "proposal_created");
});
