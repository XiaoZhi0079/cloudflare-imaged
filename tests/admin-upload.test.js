import test from "node:test";
import assert from "node:assert/strict";

import { createUploadRunner, describeUploadFailure, measureImageFile } from "../public/assets/admin/upload.js";

function file(name) {
  return { name, type: "image/webp", size: 10 };
}

test("upload runner retries only failed files", async () => {
  const uploadedNames = [];
  let failedOnce = false;
  const runner = createUploadRunner({
    batchSize: 2,
    requestUploadUrls: async (tasks) => tasks.map((task) => ({
      taskId: task.id,
      uploadUrl: `https://upload.test/${task.file.name}`,
      method: "PUT",
      headers: { "content-type": task.file.type },
      storageKey: `gallery/${task.file.name}`,
      fileName: task.file.name,
    })),
    uploadFile: async (source) => {
      uploadedNames.push(source.name);
      if (source.name === "b" && !failedOnce) {
        failedOnce = true;
        throw new Error("failed");
      }
    },
    completeUploads: async (tasks) => tasks.map((task) => ({ id: task.id })),
  });

  runner.setFiles([file("a"), file("b"), file("c")]);
  await runner.run();
  assert.deepEqual(runner.tasks().map((task) => task.status), ["success", "error", "success"]);
  await runner.retryFailed();
  assert.deepEqual(uploadedNames, ["a", "b", "c", "b"]);
  assert.deepEqual(runner.tasks().map((task) => task.status), ["success", "success", "success"]);
});

test("upload runner batches signing and preserves metadata drafts", async () => {
  const signedBatches = [];
  const runner = createUploadRunner({
    batchSize: 2,
    requestUploadUrls: async (tasks, metadata) => {
      signedBatches.push({ names: tasks.map((task) => task.file.name), metadata });
      return tasks.map((task) => ({ taskId: task.id, storageKey: task.file.name, fileName: task.file.name }));
    },
    uploadFile: async () => {},
    completeUploads: async (tasks) => tasks.map((task) => ({ imageId: task.id })),
  });
  runner.setMetadata({ categoryId: 4, tagIds: [2, 3] });
  runner.setFiles([file("a"), file("b"), file("c")], [{ width: 800, height: 600 }]);
  await runner.run();

  assert.deepEqual(signedBatches.map((batch) => batch.names), [["a", "b"], ["c"]]);
  assert.deepEqual(signedBatches[0].metadata, { categoryId: 4, tagIds: [2, 3] });
  assert.deepEqual(runner.tasks()[0].draft, { name: "a", type: "image/webp", size: 10, width: 800, height: 600 });
  assert.deepEqual(runner.counts(), { total: 3, queued: 0, active: 0, success: 3, error: 0 });
});

test("upload runner retries D1 completion without signing or uploading R2 again", async () => {
  let signingCalls = 0;
  let uploadCalls = 0;
  let completionCalls = 0;
  let capturedUploadId = null;
  const runner = createUploadRunner({
    requestUploadUrls: async (tasks) => {
      signingCalls += 1;
      capturedUploadId = tasks[0].uploadId;
      return [{
        taskId: tasks[0].id,
        uploadId: tasks[0].uploadId,
        storageKey: "gallery/retry.webp",
        fileName: "retry.webp",
      }];
    },
    uploadFile: async () => { uploadCalls += 1; },
    completeUploads: async () => {
      completionCalls += 1;
      if (completionCalls === 1) throw new Error("temporary D1 failure");
      return [{ id: 42 }];
    },
  });

  runner.setFiles([file("retry.webp")]);
  await runner.run();
  assert.equal(runner.tasks()[0].status, "error");
  await runner.retryFailed();

  assert.match(capturedUploadId, /^[0-9a-f-]+$/i);
  assert.equal(runner.tasks()[0].uploadId, capturedUploadId);
  assert.equal(runner.tasks()[0].status, "success");
  assert.equal(signingCalls, 1);
  assert.equal(uploadCalls, 1);
  assert.equal(completionCalls, 2);
});

test("upload runner prepares image dimensions asynchronously and isolates preparation failures", async () => {
  const statusSnapshots = [];
  const signedDrafts = [];
  const runner = createUploadRunner({
    batchSize: 3,
    prepareFile: async (source) => {
      await Promise.resolve();
      if (source.name === "broken") throw new Error("无法读取图片尺寸");
      return source.name === "wide" ? { width: 3840, height: 2160 } : { width: 1080, height: 1920 };
    },
    requestUploadUrls: async (tasks) => {
      signedDrafts.push(...tasks.map((task) => ({ ...task.draft })));
      return tasks.map((task) => ({ taskId: task.id, storageKey: task.file.name, fileName: task.file.name }));
    },
    uploadFile: async () => {},
    completeUploads: async (tasks) => tasks.map((task) => ({ imageId: task.id })),
    onChange: (tasks) => statusSnapshots.push(tasks.map((task) => task.status)),
  });

  runner.setFiles([file("wide"), file("portrait"), file("broken")]);
  const running = runner.run();

  assert.equal(runner.isRunning(), true);
  await running;
  assert.ok(statusSnapshots.some((statuses) => statuses.includes("preparing")));
  assert.deepEqual(signedDrafts.map(({ name, width, height }) => ({ name, width, height })), [
    { name: "wide", width: 3840, height: 2160 },
    { name: "portrait", width: 1080, height: 1920 },
  ]);
  assert.deepEqual(runner.tasks().map((task) => task.status), ["success", "success", "error"]);
  assert.equal(runner.tasks()[2].error, "无法读取图片尺寸");
});

test("image measurement falls back without blocking when decoding fails", async () => {
  const dimensions = await measureImageFile(file("broken"), {
    createBitmap: async () => { throw new Error("decode failed"); },
    ImageCtor: null,
    URLImpl: null,
  });
  assert.deepEqual(dimensions, { width: null, height: null });
});

test("upload failures summarize Cloudflare HTML responses instead of exposing the page source", async () => {
  const response = new Response(`<!DOCTYPE html>
    <html><head><title>storage.example | 524: A timeout occurred</title></head>
    <body>Cloudflare Ray ID: abc123</body></html>`, {
    status: 524,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cf-ray": "abc123-HKG",
    },
  });

  assert.equal(
    await describeUploadFailure(response, "photo.webp"),
    "图片直传失败：photo.webp（HTTP 524，storage.example | 524: A timeout occurred，Ray ID abc123-HKG）",
  );
});

test("upload runner skips an existing duplicate while continuing the rest of the signing batch", async () => {
  let signingCalls = 0;
  const runner = createUploadRunner({
    requestUploadUrls: async (tasks) => {
      signingCalls += 1;
      if (signingCalls === 1) {
        const error = new Error("duplicate");
        error.payload = {
          code: "DUPLICATE_IMAGE_CONTENT",
          duplicates: [{
            uploadId: tasks[0].uploadId,
            contentSha256: tasks[0].draft.contentSha256,
            reason: "existing_image",
            existingImage: { id: 42, fileName: "existing.webp" },
          }],
        };
        throw error;
      }
      return tasks.map((task) => ({
        taskId: task.id,
        uploadId: task.uploadId,
        storageKey: task.file.name,
        fileName: task.file.name,
      }));
    },
    uploadFile: async () => {},
    completeUploads: async (tasks) => tasks.map((task) => ({ id: task.id })),
  });
  runner.setFiles([file("duplicate.webp"), file("new.webp")], [
    { width: 1920, height: 1080 },
    { width: 1920, height: 1080 },
  ]);
  const [duplicate, fresh] = runner.tasks();
  duplicate.draft.contentSha256 = "a".repeat(64);
  fresh.draft.contentSha256 = "b".repeat(64);

  await runner.run();

  const tasks = runner.tasks();
  assert.equal(signingCalls, 2);
  assert.equal(tasks[0].status, "error");
  assert.equal(tasks[0].errorCode, "DUPLICATE_IMAGE_CONTENT");
  assert.equal(tasks[0].retryable, false);
  assert.match(tasks[0].error, /existing\.webp.*#42/);
  assert.equal(tasks[1].status, "success");
  await runner.retryFailed();
  assert.equal(signingCalls, 2, "permanent duplicate failures must not be retried");
});

test("upload runner skips a completion-time duplicate and completes unaffected uploaded files", async () => {
  let completionCalls = 0;
  let uploadCalls = 0;
  const runner = createUploadRunner({
    requestUploadUrls: async (tasks) => tasks.map((task) => ({
      taskId: task.id,
      uploadId: task.uploadId,
      storageKey: task.file.name,
      fileName: task.file.name,
    })),
    uploadFile: async () => { uploadCalls += 1; },
    completeUploads: async (tasks) => {
      completionCalls += 1;
      if (completionCalls === 1) {
        const error = new Error("duplicate");
        error.payload = {
          code: "DUPLICATE_IMAGE_CONTENT",
          duplicates: [{
            uploadId: tasks[0].uploadId,
            reason: "existing_image",
            existingImage: { id: 7, fileName: "already-there.webp" },
          }],
        };
        throw error;
      }
      return tasks.map((task) => ({ id: task.id }));
    },
  });
  runner.setFiles([file("duplicate.webp"), file("new.webp")]);

  await runner.run();

  assert.equal(uploadCalls, 2);
  assert.equal(completionCalls, 2);
  assert.deepEqual(runner.tasks().map((task) => task.status), ["error", "success"]);
  assert.equal(runner.tasks()[0].errorCode, "DUPLICATE_IMAGE_CONTENT");
});
