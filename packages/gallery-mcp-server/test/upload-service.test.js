import test from "node:test";
import assert from "node:assert/strict";

import { GalleryApiError } from "../dist/errors.js";
import { uploadOneImage } from "../dist/services/upload-service.js";

test("upload service keeps signing, R2 PUT, and D1 completion in order", async () => {
  const calls = [];
  const descriptor = {
    uploadId: "6af0b175-3c6b-4a20-a1ab-52b77fbab671",
    publicId: "a9e03cb1-6fab-4e08-a623-579287246f30",
    storageKey: "elegant-beauty/example.png",
    fileName: "example.png",
    fileUrl: "https://gallery.example.com/file/elegant-beauty/example.png",
    contentType: "image/png",
    method: "PUT",
    headers: { "content-type": "image/png" },
    uploadUrl: "https://r2.example.com/private-signed-url",
  };
  const api = {
    initUpload: async (files, categoryId, tagIds) => {
      calls.push(["init", files, categoryId, tagIds]);
      return [descriptor];
    },
    putObject: async (upload, bytes) => {
      calls.push(["put", upload.storageKey, bytes.length]);
    },
    completeUpload: async (files, categoryId, tagIds) => {
      calls.push(["complete", files, categoryId, tagIds]);
      return [{ id: 42, fileName: "example.png", fileUrl: descriptor.fileUrl, width: 2, height: 3, tags: ["连衣裙"] }];
    },
  };
  const file = {
    absolutePath: "D:/allowed/example.png",
    name: "example.png",
    type: "image/png",
    size: 3,
    width: 2,
    height: 3,
    contentSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    bytes: Buffer.from([1, 2, 3]),
  };

  const result = await uploadOneImage(api, file, {
    directoryId: 4,
    tagIds: [2],
    tagSelections: [{ groupId: 1, tagIds: [2] }],
  });

  assert.deepEqual(calls.map((call) => call[0]), ["init", "put", "complete"]);
  assert.equal(calls[0][1][0].contentSha256, file.contentSha256);
  assert.equal(result.image.id, 42);
  assert.equal(result.storageKey, "elegant-beauty/example.png");
  assert.equal("uploadUrl" in result, false);
});

test("upload service returns safe completion parameters after R2 succeeds", async () => {
  const descriptor = {
    uploadId: "6af0b175-3c6b-4a20-a1ab-52b77fbab671",
    publicId: "a9e03cb1-6fab-4e08-a623-579287246f30",
    storageKey: "elegant-beauty/recover.png",
    fileName: "recover.png",
    fileUrl: "https://gallery.example.com/file/elegant-beauty/recover.png",
    contentType: "image/png",
    method: "PUT",
    headers: { "content-type": "image/png" },
    uploadUrl: "https://r2.example.com/secret-signed-url",
  };
  const api = {
    initUpload: async () => [descriptor],
    putObject: async () => undefined,
    completeUpload: async () => { throw new Error("temporary"); },
  };
  const file = {
    absolutePath: "D:/allowed/recover.png",
    name: "recover.png",
    type: "image/png",
    size: 3,
    width: 2,
    height: 3,
    contentSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    bytes: Buffer.from([1, 2, 3]),
  };

  await assert.rejects(
    () => uploadOneImage(api, file, {
      directoryId: 4,
      tagIds: [2],
      tagSelections: [{ groupId: 1, tagIds: [2] }],
    }),
    (error) => {
      assert.equal(error.code, "UPLOAD_COMPLETION_REQUIRED");
      assert.equal(error.retryable, true);
      assert.deepEqual(error.details.resume_parameters, {
        upload_id: "6af0b175-3c6b-4a20-a1ab-52b77fbab671",
        storage_key: "elegant-beauty/recover.png",
        file_name: "recover.png",
        width: 2,
        height: 3,
        directory_id: 4,
        tag_selections: [{ group_id: 1, tag_ids: [2] }],
      });
      assert.doesNotMatch(JSON.stringify(error.details), /secret-signed-url/);
      return true;
    },
  );
});

test("upload service preserves completion duplicate details without suggesting resume", async () => {
  const descriptor = {
    uploadId: "6af0b175-3c6b-4a20-a1ab-52b77fbab671",
    publicId: "a9e03cb1-6fab-4e08-a623-579287246f30",
    storageKey: "elegant-beauty/duplicate.png",
    fileName: "duplicate.png",
    fileUrl: "https://gallery.example.com/file/elegant-beauty/duplicate.png",
    contentType: "image/png",
    method: "PUT",
    headers: { "content-type": "image/png" },
    uploadUrl: "https://r2.example.com/private-signed-url",
  };
  const duplicate = {
    uploadId: descriptor.uploadId,
    clientItemId: "duplicate-item",
    contentSha256: "a".repeat(64),
    reason: "existing_image",
    existingImage: {
      id: 77,
      publicId: "11111111-1111-4111-8111-111111111111",
      fileName: "existing.png",
      fileUrl: "https://gallery.example.com/file/existing.png",
    },
  };
  const api = {
    initUpload: async () => [descriptor],
    putObject: async () => undefined,
    completeUpload: async () => {
      throw new GalleryApiError("Image content already exists.", {
        status: 409,
        code: "DUPLICATE_IMAGE_CONTENT",
        retryable: false,
        details: { duplicates: [duplicate] },
      });
    },
  };
  const file = {
    absolutePath: "D:/allowed/duplicate.png",
    name: "duplicate.png",
    type: "image/png",
    size: 3,
    width: 2,
    height: 3,
    contentSha256: "a".repeat(64),
    bytes: Buffer.from([1, 2, 3]),
  };

  await assert.rejects(
    () => uploadOneImage(api, file, {
      directoryId: 4,
      tagIds: [2],
      tagSelections: [{ groupId: 1, tagIds: [2] }],
    }, { clientItemId: "duplicate-item" }),
    (error) => {
      assert.equal(error.code, "DUPLICATE_IMAGE_CONTENT");
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details.duplicates, [duplicate]);
      assert.equal(error.details.resume_parameters, undefined);
      return true;
    },
  );
});
