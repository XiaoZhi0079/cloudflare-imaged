import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { GalleryApiError, GalleryMcpError } from "../dist/errors.js";
import { processUploadManifest } from "../dist/services/manifest-service.js";

async function createImage(filePath, color) {
  await sharp({ create: { width: 3, height: 2, channels: 3, background: color } }).png().toFile(filePath);
}

function config(root) {
  return {
    baseUrl: "https://gallery.example.com",
    adminKey: "test-key",
    uploadRoots: [root],
    requestTimeoutMs: 1000,
    uploadTimeoutMs: 1000,
    maxFileBytes: 1024 * 1024,
    uploadConcurrency: 2,
    uploadChunkSize: 20,
  };
}

function manifestItem(clientItemId, localPath, directoryId = 7, tagId = 2) {
  return {
    clientItemId,
    localPath,
    directoryId,
    tagSelections: [{ groupId: 1, tagIds: [tagId] }],
  };
}

test("manifest dry run validates every image without calling upload APIs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-manifest-"));
  try {
    const first = path.join(root, "first.png");
    const second = path.join(root, "second.png");
    await createImage(first, "#ffffff");
    await createImage(second, "#000000");
    let uploadCalls = 0;
    const api = {
      initUpload: async () => { uploadCalls += 1; return []; },
      putObject: async () => { uploadCalls += 1; },
      completeUpload: async () => { uploadCalls += 1; return []; },
    };
    const taxonomy = {
      validateUploadSelection: async (_directoryId, selections) => selections.flatMap((item) => item.tagIds),
    };

    const result = await processUploadManifest(
      { api, taxonomy, config: config(root) },
      [manifestItem("first", first), manifestItem("second", second, 8, 4)],
      { continueOnError: true, dryRun: true, resultDetail: "all" },
    );

    assert.equal(uploadCalls, 0);
    assert.equal(result.total_count, 2);
    assert.equal(result.failed_count, 0);
    assert.equal(result.skipped_count, 2);
    assert.ok(result.items.every((item) => item.code === "DRY_RUN"));
    assert.deepEqual(result.items.map((item) => [item.width, item.height]), [[3, 2], [3, 2]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest isolates upload failures and preserves per-item selections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-manifest-"));
  try {
    const first = path.join(root, "first.png");
    const second = path.join(root, "second.png");
    await createImage(first, "#ffffff");
    await createImage(second, "#000000");
    const initSelections = [];
    const api = {
      initUpload: async (files, directoryId, tagIds, options) => {
        initSelections.push({ files, directoryId, tagIds, options });
        return files.map((file) => ({
          uploadId: file.uploadId,
          operationId: options.operationId,
          clientItemId: file.clientItemId,
          storageKey: `directory-${file.categoryId}/${file.name}`,
          fileName: file.name,
          fileUrl: `https://gallery.example.com/file/${file.name}`,
          contentType: "image/png",
          method: "PUT",
          headers: { "content-type": "image/png" },
          uploadUrl: `https://r2.example.com/${file.name}`,
        }));
      },
      putObject: async (upload) => {
        if (upload.fileName === "first.png") {
          throw new GalleryMcpError("Synthetic R2 failure.", { code: "R2_UPLOAD_FAILED", retryable: true });
        }
      },
      completeUpload: async (files, directoryId, tagIds) => files.map((file) => ({
        id: 42,
        fileName: file.fileName,
        fileUrl: `https://gallery.example.com/file/${file.fileName}`,
        width: file.width,
        height: file.height,
        tags: [],
        completionCategoryId: directoryId,
        completionTagIds: tagIds,
      })),
    };
    const taxonomy = {
      validateUploadSelection: async (_directoryId, selections) => selections.flatMap((item) => item.tagIds),
    };

    const result = await processUploadManifest(
      { api, taxonomy, config: config(root) },
      [manifestItem("first", first, 7, 2), manifestItem("second", second, 8, 4)],
      { continueOnError: true, dryRun: false, resultDetail: "all" },
    );

    assert.equal(result.uploaded_count, 1);
    assert.equal(result.failed_count, 1);
    assert.deepEqual(result.items.map((item) => item.status), ["failed", "uploaded"]);
    assert.equal(initSelections.length, 1);
    assert.equal(initSelections[0].directoryId, null);
    assert.equal(initSelections[0].tagIds, null);
    assert.equal(initSelections[0].options.namingStrategy, "original-unique");
    assert.deepEqual(
      initSelections[0].files.map((file) => [file.name, file.categoryId, file.tagIds]),
      [["first.png", 7, [2]], ["second.png", 8, [4]]],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest bounds concurrent R2 uploads and omits successful records by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-manifest-"));
  try {
    const paths = [];
    for (let index = 0; index < 5; index += 1) {
      const filePath = path.join(root, `image-${index}.png`);
      await createImage(filePath, index % 2 ? "#ffffff" : "#000000");
      paths.push(filePath);
    }

    let activePuts = 0;
    let maximumActivePuts = 0;
    const initBatchSizes = [];
    const completeBatchSizes = [];
    const api = {
      initUpload: async (files, _directoryId, _tagIds, options) => {
        initBatchSizes.push(files.length);
        return files.map((file) => ({
          uploadId: file.uploadId,
          operationId: options.operationId,
          clientItemId: file.clientItemId,
          storageKey: `directory-${file.categoryId}/${file.name}`,
          fileName: file.name,
          fileUrl: `https://gallery.example.com/file/${file.name}`,
          contentType: "image/png",
          method: "PUT",
          headers: { "content-type": "image/png" },
          uploadUrl: `https://r2.example.com/${file.name}`,
        }));
      },
      putObject: async () => {
        activePuts += 1;
        maximumActivePuts = Math.max(maximumActivePuts, activePuts);
        await new Promise((resolve) => setTimeout(resolve, 15));
        activePuts -= 1;
      },
      completeUpload: async (files, directoryId, tagIds) => {
        assert.equal(directoryId, null);
        assert.equal(tagIds, null);
        completeBatchSizes.push(files.length);
        return files.map((file, index) => ({
          id: index + 1,
          fileName: file.fileName,
          fileUrl: `https://gallery.example.com/file/${file.fileName}`,
          width: file.width,
          height: file.height,
          tags: ["tag"],
        }));
      },
    };
    const taxonomy = {
      validateUploadSelection: async (_directoryId, selections) => selections.flatMap((item) => item.tagIds),
    };
    const boundedConfig = { ...config(root), uploadConcurrency: 2, uploadChunkSize: 3 };

    const result = await processUploadManifest(
      { api, taxonomy, config: boundedConfig },
      paths.map((filePath, index) => manifestItem(`item-${index}`, filePath)),
      { continueOnError: true, dryRun: false },
    );

    assert.equal(result.uploaded_count, 5);
    assert.equal(result.failed_count, 0);
    assert.deepEqual(initBatchSizes, [3, 2]);
    assert.deepEqual(completeBatchSizes, [3, 2]);
    assert.equal(maximumActivePuts, 2);
    assert.deepEqual(result.failures, []);
    assert.equal("items" in result, false);
    assert.doesNotMatch(JSON.stringify(result), /fileUrl|storage_key|image-0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest skips same-batch duplicate items and initializes the remaining files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-manifest-"));
  try {
    const first = path.join(root, "first.png");
    const duplicate = path.join(root, "duplicate.png");
    const third = path.join(root, "third.png");
    await createImage(first, "#ffffff");
    await copyFile(first, duplicate);
    await createImage(third, "#000000");

    const initBatches = [];
    let initAttempt = 0;
    const api = {
      initUpload: async (files, _directoryId, _tagIds, options) => {
        initAttempt += 1;
        initBatches.push(files.map((file) => file.clientItemId));
        if (initAttempt === 1) {
          const repeated = files.find((file) => file.clientItemId === "duplicate");
          throw new GalleryApiError("Duplicate content in this batch.", {
            status: 409,
            code: "DUPLICATE_IMAGE_CONTENT",
            retryable: false,
            details: {
              duplicates: [{
                uploadId: repeated.uploadId,
                clientItemId: repeated.clientItemId,
                fileName: repeated.name,
                contentSha256: repeated.contentSha256,
                reason: "same_batch",
              }],
            },
          });
        }
        return files.map((file) => ({
          uploadId: file.uploadId,
          operationId: options.operationId,
          clientItemId: file.clientItemId,
          storageKey: `directory-${file.categoryId}/${file.name}`,
          fileName: file.name,
          fileUrl: `https://gallery.example.com/file/${file.name}`,
          contentType: "image/png",
          method: "PUT",
          headers: { "content-type": "image/png" },
          uploadUrl: `https://r2.example.com/${file.name}`,
        }));
      },
      putObject: async () => undefined,
      completeUpload: async (files) => files.map((file, index) => ({
        id: index + 1,
        fileName: file.fileName,
        fileUrl: `https://gallery.example.com/file/${file.fileName}`,
        width: file.width,
        height: file.height,
        tags: ["tag"],
      })),
    };
    const taxonomy = {
      validateUploadSelection: async (_directoryId, selections) => selections.flatMap((item) => item.tagIds),
    };

    const result = await processUploadManifest(
      { api, taxonomy, config: config(root) },
      [
        manifestItem("first", first),
        manifestItem("duplicate", duplicate),
        manifestItem("third", third),
      ],
      { continueOnError: false, dryRun: false, resultDetail: "all" },
    );

    assert.deepEqual(initBatches, [
      ["first", "duplicate", "third"],
      ["first", "third"],
    ]);
    assert.equal(result.uploaded_count, 2);
    assert.equal(result.failed_count, 0);
    assert.equal(result.duplicate_count, 1);
    assert.deepEqual(result.items.map((item) => item.status), ["uploaded", "skipped", "uploaded"]);
    assert.equal(result.items[1].code, "DUPLICATE_IMAGE_CONTENT");
    assert.equal(result.items[1].duplicate.reason, "same_batch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest skips a completion-race duplicate without returning resume parameters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-manifest-"));
  try {
    const first = path.join(root, "first.png");
    const second = path.join(root, "second.png");
    await createImage(first, "#ffffff");
    await createImage(second, "#000000");

    let completionAttempt = 0;
    const completionBatches = [];
    const api = {
      initUpload: async (files, _directoryId, _tagIds, options) => files.map((file) => ({
        uploadId: file.uploadId,
        operationId: options.operationId,
        clientItemId: file.clientItemId,
        storageKey: `directory-${file.categoryId}/${file.name}`,
        fileName: file.name,
        fileUrl: `https://gallery.example.com/file/${file.name}`,
        contentType: "image/png",
        method: "PUT",
        headers: { "content-type": "image/png" },
        uploadUrl: `https://r2.example.com/${file.name}`,
      })),
      putObject: async () => undefined,
      completeUpload: async (files) => {
        completionAttempt += 1;
        completionBatches.push(files.map((file) => file.fileName));
        if (completionAttempt === 1) {
          throw new GalleryApiError("Image content already exists.", {
            status: 409,
            code: "DUPLICATE_IMAGE_CONTENT",
            retryable: false,
            details: {
              duplicates: [{
                uploadId: files[0].uploadId,
                clientItemId: "first",
                reason: "existing_image",
                existingImage: {
                  id: 77,
                  publicId: "11111111-1111-4111-8111-111111111111",
                  fileName: "existing.png",
                  fileUrl: "https://gallery.example.com/file/existing.png",
                },
              }],
            },
          });
        }
        return files.map((file) => ({
          id: 88,
          fileName: file.fileName,
          fileUrl: `https://gallery.example.com/file/${file.fileName}`,
          width: file.width,
          height: file.height,
          tags: ["tag"],
        }));
      },
    };
    const taxonomy = {
      validateUploadSelection: async (_directoryId, selections) => selections.flatMap((item) => item.tagIds),
    };

    const result = await processUploadManifest(
      { api, taxonomy, config: config(root) },
      [manifestItem("first", first), manifestItem("second", second)],
      { continueOnError: false, dryRun: false, resultDetail: "all" },
    );

    assert.deepEqual(completionBatches, [["first.png", "second.png"], ["second.png"]]);
    assert.equal(result.uploaded_count, 1);
    assert.equal(result.failed_count, 0);
    assert.equal(result.duplicate_count, 1);
    assert.equal(result.items[0].status, "skipped");
    assert.equal(result.items[0].phase, "complete");
    assert.equal(result.items[0].duplicate.existingImage.id, 77);
    assert.equal(result.items[0].resume_parameters, undefined);
    assert.equal(result.items[1].status, "uploaded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
