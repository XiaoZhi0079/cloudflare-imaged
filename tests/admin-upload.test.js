import test from "node:test";
import assert from "node:assert/strict";

import { createUploadRunner } from "../public/assets/admin/upload.js";

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
