export function normalizeUploadFolder(value) {
  return String(value ?? "gallery").trim().replace(/^\\+|\\+$/g, "").replace(/^\/+|\/+$/g, "") || "gallery";
}

export function sanitizeFileName(fileName) {
  const trimmed = String(fileName ?? "").trim();
  const sanitized = trimmed.replace(/[\\/]+/g, "-").replace(/\s+/g, "-");
  return sanitized || "image";
}

export function getFileExtension(fileName) {
  const normalized = sanitizeFileName(fileName);
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

export function createStoredFileName(file, uploadNameType) {
  const originalName = sanitizeFileName(file?.name ?? "image");
  const extension = getFileExtension(originalName);

  if (uploadNameType === "short") {
    return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}${extension}`;
  }

  if (uploadNameType === "index") {
    return `${Date.now()}${extension}`;
  }

  return originalName;
}

export function buildStorageKey(uploadFolder, fileName) {
  const folder = normalizeUploadFolder(uploadFolder);
  return folder ? `${folder}/${fileName}` : fileName;
}

export function buildPublicUrl(publicBaseUrl, fileId) {
  const origin = String(publicBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!origin) {
    throw new Error("GALLERY_PUBLIC_BASE_URL is required");
  }

  const safePath = fileId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `${origin}/${safePath}`;
}

export function toImageRecord(fileId, publicBaseUrl, imageMeta = {}) {
  return {
    storageKey: fileId,
    fileName: fileId.split("/").pop(),
    fileUrl: buildPublicUrl(publicBaseUrl, fileId),
    width: imageMeta.width ?? null,
    height: imageMeta.height ?? null,
    syncStatus: "ok",
  };
}

function extractHttpMetadata(object) {
  if (object?.httpMetadata) {
    return { ...object.httpMetadata };
  }

  return {};
}

async function copyObject(bucket, fromKey, toKey) {
  const object = await bucket.get(fromKey);
  if (!object?.body) {
    throw new Error(`Stored object not found: ${fromKey}`);
  }

  await bucket.put(toKey, object.body, {
    httpMetadata: extractHttpMetadata(object),
    customMetadata: object.customMetadata ? { ...object.customMetadata } : undefined,
  });
}

export function createGalleryStorage({ bucket, publicBaseUrl }) {
  if (!bucket) {
    throw new Error("GALLERY_BUCKET binding is required");
  }

  return {
    async uploadImage({
      file,
      uploadFolder = "gallery",
      uploadNameType = "origin",
      imageMeta = {},
    }) {
      const storedFileName = createStoredFileName(file, uploadNameType);
      const fileId = buildStorageKey(uploadFolder, storedFileName);
      await bucket.put(fileId, await file.arrayBuffer(), {
        httpMetadata: {
          contentType: String(file?.type ?? "application/octet-stream") || "application/octet-stream",
        },
      });

      return toImageRecord(fileId, publicBaseUrl, imageMeta);
    },

    async renameImage(fileId, newFileId) {
      await copyObject(bucket, fileId, newFileId);
      await bucket.delete(fileId);
      return {
        storageKey: newFileId,
        fileName: newFileId.split("/").pop(),
        fileUrl: buildPublicUrl(publicBaseUrl, newFileId),
        syncStatus: "ok",
      };
    },

    async moveImage(fileId, directory) {
      const fileName = fileId.split("/").pop();
      const targetDirectory = String(directory ?? "").trim().replace(/^\/+|\/+$/g, "");
      const nextFileId = targetDirectory ? `${targetDirectory}/${fileName}` : fileName;
      await copyObject(bucket, fileId, nextFileId);
      await bucket.delete(fileId);
      return {
        storageKey: nextFileId,
        fileName,
        fileUrl: buildPublicUrl(publicBaseUrl, nextFileId),
        syncStatus: "ok",
      };
    },

    async deleteImage(fileId) {
      await bucket.delete(fileId);
      return true;
    },
  };
}
