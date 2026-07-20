import { buildPublicUrl } from "./gallery-storage.js";

export class ImageStorageAuditError extends Error {
  constructor(message, { code = "IMAGE_STORAGE_AUDIT_FAILED" } = {}) {
    super(message);
    this.name = "ImageStorageAuditError";
    this.code = code;
  }
}

function safeStorageKey(value) {
  const key = String(value ?? "").trim().replace(/^\/+/, "");
  if (!key || /[\u0000-\u001f\u007f\\]/.test(key) || key.includes("../")) {
    throw new ImageStorageAuditError("Invalid storage key", { code: "INVALID_STORAGE_KEY" });
  }
  return key;
}

function directoryOf(key) {
  const parts = key.split("/");
  parts.pop();
  return parts.join("/");
}

function extensionOf(key) {
  const fileName = key.split("/").pop() ?? "";
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index).toLocaleLowerCase("en-US");
}

export async function listR2ObjectMetadata(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const object of page.objects ?? []) {
      objects.push({
        key: object.key,
        size: Number(object.size ?? 0),
        etag: object.etag ?? null,
        uploaded: object.uploaded instanceof Date
          ? object.uploaded.toISOString()
          : object.uploaded ?? null,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export function compareImageStorage(images, objects) {
  const imageKeys = new Set(images.map((image) => image.storageKey));
  const objectKeys = new Set(objects.map((object) => object.key));
  const missingRecords = images
    .filter((image) => !objectKeys.has(image.storageKey))
    .map((image) => ({
      id: image.id,
      storageKey: image.storageKey,
      fileName: image.fileName,
      syncStatus: image.syncStatus ?? "ok",
      note: image.note ?? null,
    }));
  const orphanObjects = objects.filter((object) => !imageKeys.has(object.key));
  const failedRecords = images
    .filter((image) => image.syncStatus && image.syncStatus !== "ok")
    .map((image) => ({
      id: image.id,
      storageKey: image.storageKey,
      fileName: image.fileName,
      syncStatus: image.syncStatus,
      note: image.note ?? null,
    }));
  const suggestions = missingRecords.flatMap((record) => {
    const candidates = orphanObjects.filter(
      (object) => directoryOf(object.key) === directoryOf(record.storageKey)
        && extensionOf(object.key) === extensionOf(record.storageKey),
    );
    return candidates.length === 1
      ? [{ imageId: record.id, missingKey: record.storageKey, existingKey: candidates[0].key }]
      : [];
  });

  return {
    summary: {
      imageRecords: images.length,
      r2Objects: objects.length,
      missingObjects: missingRecords.length,
      orphanObjects: orphanObjects.length,
      failedRecords: failedRecords.length,
      uniqueRepairSuggestions: suggestions.length,
    },
    missingRecords,
    orphanObjects,
    failedRecords,
    suggestions,
  };
}

export function createImageStorageAuditService({ repository, bucket, publicBaseUrl }) {
  if (!repository || !bucket || !publicBaseUrl) {
    throw new TypeError("repository, bucket and publicBaseUrl are required");
  }

  return {
    async audit() {
      const [images, objects] = await Promise.all([
        repository.listImages(),
        listR2ObjectMetadata(bucket),
      ]);
      return compareImageStorage(images, objects);
    },

    async repairRecord({ imageId, storageKey }) {
      const id = Number(imageId);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ImageStorageAuditError("Invalid image id", { code: "INVALID_IMAGE_ID" });
      }
      const candidateKey = safeStorageKey(storageKey);
      const image = await repository.getImageById(id);
      if (!image) {
        throw new ImageStorageAuditError("Image not found", { code: "IMAGE_NOT_FOUND" });
      }
      if (directoryOf(image.storageKey) !== directoryOf(candidateKey)) {
        throw new ImageStorageAuditError("Repair candidate is in another directory", {
          code: "REPAIR_DIRECTORY_MISMATCH",
        });
      }
      if (extensionOf(image.storageKey) !== extensionOf(candidateKey)) {
        throw new ImageStorageAuditError("Repair candidate has another extension", {
          code: "REPAIR_EXTENSION_MISMATCH",
        });
      }

      const [currentObject, candidateObject, existingRecord] = await Promise.all([
        bucket.head(image.storageKey),
        bucket.head(candidateKey),
        repository.getImageByStorageKey(candidateKey),
      ]);
      if (currentObject) {
        throw new ImageStorageAuditError("Current D1 storage key still exists in R2", {
          code: "CURRENT_OBJECT_STILL_EXISTS",
        });
      }
      if (!candidateObject) {
        throw new ImageStorageAuditError("Repair candidate does not exist in R2", {
          code: "REPAIR_OBJECT_NOT_FOUND",
        });
      }
      if (existingRecord && Number(existingRecord.id) !== id) {
        throw new ImageStorageAuditError("Repair candidate belongs to another image", {
          code: "REPAIR_OBJECT_ALREADY_REFERENCED",
        });
      }

      return await repository.updateImageStorage(id, {
        storageKey: candidateKey,
        fileName: candidateKey.split("/").pop(),
        fileUrl: buildPublicUrl(publicBaseUrl, candidateKey),
        syncStatus: "ok",
        note: null,
      });
    },
  };
}
