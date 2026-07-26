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

export function createStoredFileName(file, uploadNameType, uniqueId = "") {
  const originalName = sanitizeFileName(file?.name ?? "image");
  const extension = getFileExtension(originalName);

  if (uploadNameType === "original-unique") {
    const stem = extension ? originalName.slice(0, -extension.length) : originalName;
    const suffix = String(uniqueId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)
      || crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    return `${stem}--${suffix}${extension}`;
  }

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

export function resolvePublicBaseUrl(configuredBaseUrl, requestUrl) {
  const configured = String(configuredBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  if (requestUrl) {
    return `${new URL(requestUrl).origin}/file`;
  }
  throw new Error("GALLERY_PUBLIC_BASE_URL is required");
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

export class GalleryStorageError extends Error {
  constructor(message, { code = "STORAGE_OPERATION_FAILED", status = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GalleryStorageError";
    this.code = code;
    this.status = status;
  }
}

async function getObjectMetadata(bucket, key) {
  if (typeof bucket.head === "function") {
    return await bucket.head(key);
  }
  return await bucket.get(key);
}

async function copyObjectThroughBinding(bucket, fromKey, toKey) {
  const object = await bucket.get(fromKey);
  if (!object?.body) {
    throw new GalleryStorageError(`Stored object not found: ${fromKey}`, {
      code: "SOURCE_OBJECT_NOT_FOUND",
      status: 409,
    });
  }

  await bucket.put(toKey, object.body, {
    httpMetadata: extractHttpMetadata(object),
    customMetadata: object.customMetadata ? { ...object.customMetadata } : undefined,
  });
}

async function relocateObject(bucket, fromKey, toKey, serverSideCopy, { allowExistingTarget = false } = {}) {
  if (fromKey === toKey) {
    const current = await getObjectMetadata(bucket, fromKey);
    if (!current) {
      throw new GalleryStorageError(`Stored object not found: ${fromKey}`, {
        code: "SOURCE_OBJECT_NOT_FOUND",
        status: 409,
      });
    }
    return;
  }

  const [source, target] = await Promise.all([
    getObjectMetadata(bucket, fromKey),
    getObjectMetadata(bucket, toKey),
  ]);
  if (!source && target) {
    if (allowExistingTarget) return;
    throw new GalleryStorageError("Source is missing while target already exists", {
      code: "RELOCATION_STATE_AMBIGUOUS",
      status: 409,
    });
  }
  if (!source) {
    throw new GalleryStorageError(`Stored object not found: ${fromKey}`, {
      code: "SOURCE_OBJECT_NOT_FOUND",
      status: 409,
    });
  }
  if (target) {
    throw new GalleryStorageError(`Target object already exists: ${toKey}`, {
      code: "TARGET_OBJECT_EXISTS",
      status: 409,
    });
  }

  try {
    if (serverSideCopy) {
      await serverSideCopy(fromKey, toKey);
    } else {
      await copyObjectThroughBinding(bucket, fromKey, toKey);
    }
  } catch (error) {
    if (error instanceof GalleryStorageError) throw error;
    throw new GalleryStorageError("Stored object copy failed", {
      code: error?.code ?? "OBJECT_COPY_FAILED",
      status: Number(error?.status) === 409 ? 409 : 502,
      cause: error,
    });
  }

  const copied = await getObjectMetadata(bucket, toKey);
  if (!copied || (Number.isFinite(Number(source.size)) && Number(source.size) !== Number(copied.size))) {
    await bucket.delete(toKey).catch(() => {});
    throw new GalleryStorageError("Copied object verification failed", {
      code: "OBJECT_COPY_VERIFICATION_FAILED",
      status: 502,
    });
  }

  try {
    await bucket.delete(fromKey);
  } catch (error) {
    await bucket.delete(toKey).catch(() => {});
    throw new GalleryStorageError("Source object cleanup failed", {
      code: "SOURCE_OBJECT_DELETE_FAILED",
      status: 502,
      cause: error,
    });
  }
}

export function createGalleryStorage({ bucket, publicBaseUrl, serverSideCopy }) {
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

    async renameImage(fileId, newFileId, options) {
      await relocateObject(bucket, fileId, newFileId, serverSideCopy, options);
      return {
        storageKey: newFileId,
        fileName: newFileId.split("/").pop(),
        fileUrl: buildPublicUrl(publicBaseUrl, newFileId),
        syncStatus: "ok",
      };
    },

    async moveImage(fileId, directory, options) {
      const fileName = fileId.split("/").pop();
      const targetDirectory = String(directory ?? "").trim().replace(/^\/+|\/+$/g, "");
      const nextFileId = targetDirectory ? `${targetDirectory}/${fileName}` : fileName;
      await relocateObject(bucket, fileId, nextFileId, serverSideCopy, options);
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
