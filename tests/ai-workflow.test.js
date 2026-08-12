import test from "node:test";
import assert from "node:assert/strict";

import { createTestDatabase } from "./helpers/test-database.js";
import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createAiOrganizationService } from "../src/server/ai-organization.js";

test("AI proposals require review and atomically preserve image identity while applying organization", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const [category] = await repository.listCategories();
  const targetCategory = await repository.createCategory({ name: "AI 目录", directorySlug: "ai-directory" });
  const group = await repository.createTagGroup({ name: "AI 衣物" });
  const existingTag = await repository.createTag({ name: "礼服", groupId: group.id });
  const contentSha256 = "ab".repeat(32);
  const image = await repository.upsertImage({
    publicId: "11111111-1111-4111-8111-111111111111", contentSha256,
    storageKey: `${category.directory_slug}/before.png`, fileName: "before.png",
    fileUrl: `https://gallery.test/file/${category.directory_slug}/before.png`, width: 1920, height: 1080,
    categoryId: category.id,
  });
  const batchId = "22222222-2222-4222-8222-222222222222";
  await repository.createAiAnalysisBatch({ id: batchId, name: "synthetic batch", imageIds: [image.id] });
  const submission = await repository.submitAiImageProposal({
    id: "33333333-3333-4333-8333-333333333333", batchId, imageId: image.id,
    proposedFileName: "after.png", proposedCategoryId: targetCategory.id,
    proposedTagIds: [existingTag.id], newTagCandidates: [{ name: "丝绸", groupId: group.id }],
    rationale: "Synthetic test proposal", confidence: 0.9,
  });
  assert.equal(submission.outcome, "proposal_created");
  const proposal = submission.proposal;
  assert.equal(proposal.status, "pending");
  assert.deepEqual(submission.changes.tags.addedIds, [existingTag.id]);
  assert.equal(submission.changes.fileName.to, "after.png");
  assert.equal(submission.changes.directory.toId, targetCategory.id);
  const pendingPage = await repository.listAiImageProposals({ status: "pending" });
  assert.deepEqual(pendingPage.proposals[0].changes.tags.addedIds, [existingTag.id]);
  assert.equal(pendingPage.proposals[0].changes.fileName.to, "after.png");
  assert.equal((await repository.listAiTagCandidates({ status: "pending" })).length, 1);

  await assert.rejects(
    () => repository.applyAiProposalMetadata(proposal.id, { storageKey: "ai-directory/after.png", fileName: "after.png", fileUrl: "https://gallery.test/file/ai-directory/after.png" }),
    (error) => error.code === "AI_PROPOSAL_NOT_APPROVED",
  );
  const [candidate] = await repository.listAiTagCandidates({ status: "pending" });
  await repository.reviewAiTagCandidate(candidate.id, { status: "approved" });
  await repository.reviewAiImageProposals([proposal.id], { status: "approved" });

  const objects = new Set([image.storageKey]);
  const storage = {
    async renameImage(from, to) {
      assert.ok(objects.has(from)); assert.ok(!objects.has(to));
      objects.delete(from); objects.add(to);
      return { storageKey: to, fileName: to.split("/").at(-1), fileUrl: `https://gallery.test/file/${to}` };
    },
  };
  const service = createAiOrganizationService({ repository, storage, publicBaseUrl: "https://gallery.test/file" });
  const result = await service.applyProposal(proposal.id);
  assert.equal(result.image.id, image.id);
  assert.equal(result.image.publicId, image.publicId);
  assert.equal(result.image.contentSha256, contentSha256);
  assert.equal(result.image.storageKey, "ai-directory/after.png");
  assert.equal(result.proposal.status, "applied");
  assert.equal(result.tagIds.length, 2);
  assert.deepEqual(await repository.getImageTagIds(image.id), result.tagIds);
  assert.ok(objects.has("ai-directory/after.png"));
  await assert.rejects(
    () => repository.submitAiImageProposal({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", batchId, imageId: image.id,
      proposedFileName: "after.png", proposedCategoryId: targetCategory.id,
      proposedTagIds: result.tagIds,
    }),
    (error) => error.code === "ANALYSIS_ITEM_ALREADY_APPLIED",
  );
});

test("resubmitting one proposal does not inflate tag candidate occurrence counts", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const [category] = await repository.listCategories();
  const group = await repository.createTagGroup({ name: "AI 场景" });
  const image = await repository.upsertImage({ storageKey: "scenery/candidate.png", fileName: "candidate.png", fileUrl: "https://gallery.test/file/scenery/candidate.png", categoryId: category.id });
  const batchId = "44444444-4444-4444-8444-444444444444";
  await repository.createAiAnalysisBatch({ id: batchId, name: "retry batch", imageIds: [image.id] });
  const input = { id: "55555555-5555-4555-8555-555555555555", batchId, imageId: image.id, proposedFileName: "candidate.png", proposedCategoryId: category.id, newTagCandidates: [{ name: "露台", groupId: group.id }] };
  await repository.submitAiImageProposal(input);
  await repository.submitAiImageProposal({ ...input, id: "66666666-6666-4666-8666-666666666666" });
  const [candidate] = await repository.listAiTagCandidates({ status: "pending" });
  assert.equal(candidate.occurrenceCount, 1);
});

test("identical AI analysis is recorded as no change without entering review", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const [category] = await repository.listCategories();
  const group = await repository.createTagGroup({ name: "AI 无变化" });
  const tag = await repository.createTag({ name: "现有标签", groupId: group.id });
  const image = await repository.upsertImage({
    storageKey: `${category.directory_slug}/same.png`, fileName: "same.png",
    fileUrl: `https://gallery.test/file/${category.directory_slug}/same.png`, categoryId: category.id,
  });
  await repository.replaceImageTags(image.id, [tag.id]);
  const batchId = "77777777-7777-4777-8777-777777777777";
  await repository.createAiAnalysisBatch({ id: batchId, name: "no change batch", imageIds: [image.id] });

  const result = await repository.submitAiImageProposal({
    id: "88888888-8888-4888-8888-888888888888", batchId, imageId: image.id,
    proposedFileName: "same.png", proposedCategoryId: category.id,
    proposedTagIds: [tag.id], newTagCandidates: [], rationale: "Already correct", confidence: 1,
  });

  assert.equal(result.outcome, "no_change");
  assert.equal(result.proposal, null);
  assert.equal((await repository.listAiImageProposals({ status: "pending" })).totalCount, 0);
  const batch = await repository.getAiAnalysisBatch(batchId);
  assert.equal(batch.noChangeCount, 1);
  assert.equal(batch.pendingCount, 0);
});

test("resubmitting a pending proposal as unchanged removes its review card and orphan candidate", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const [category] = await repository.listCategories();
  const group = await repository.createTagGroup({ name: "AI 撤回" });
  const image = await repository.upsertImage({ storageKey: "gallery/withdraw.png", fileName: "withdraw.png", fileUrl: "https://gallery.test/file/gallery/withdraw.png", categoryId: category.id });
  const batchId = "99999999-9999-4999-8999-999999999999";
  await repository.createAiAnalysisBatch({ id: batchId, name: "withdraw batch", imageIds: [image.id] });
  await repository.submitAiImageProposal({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", batchId, imageId: image.id,
    proposedFileName: "changed.png", proposedCategoryId: category.id,
    newTagCandidates: [{ name: "临时候选", groupId: group.id }],
  });
  assert.equal((await repository.listAiTagCandidates({ status: "pending" })).length, 1);

  const result = await repository.submitAiImageProposal({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", batchId, imageId: image.id,
    proposedFileName: "withdraw.png", proposedCategoryId: category.id,
    proposedTagIds: [], newTagCandidates: [],
  });

  assert.equal(result.outcome, "no_change");
  assert.equal((await repository.listAiImageProposals({ status: "all" })).totalCount, 0);
  assert.equal((await repository.listAiTagCandidates({ status: "pending" })).length, 0);
});

test("a missing-tag candidate remains reviewable even when stored metadata is unchanged", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const [category] = await repository.listCategories();
  const group = await repository.createTagGroup({ name: "AI 新概念" });
  const image = await repository.upsertImage({ storageKey: "gallery/concept.png", fileName: "concept.png", fileUrl: "https://gallery.test/file/gallery/concept.png", categoryId: category.id });
  const batchId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await repository.createAiAnalysisBatch({ id: batchId, name: "candidate-only batch", imageIds: [image.id] });

  const result = await repository.submitAiImageProposal({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", batchId, imageId: image.id,
    proposedFileName: "concept.png", proposedCategoryId: category.id,
    proposedTagIds: [], newTagCandidates: [{ name: "新视觉元素", groupId: group.id }],
  });

  assert.equal(result.outcome, "proposal_created");
  assert.equal(result.changes.candidateTagIds.length, 1);
  assert.equal((await repository.listAiImageProposals({ status: "pending" })).totalCount, 1);
});
