import { getRepository, requireAdminKey } from "../../_shared.js";
import {
  findMissingTagIds,
  isImageContentType,
  normalizeImageDimension,
  normalizeTagIds,
  resolveUploadPolicy,
} from "../../../../../src/server/gallery-upload.js";
import {
  buildStorageKey,
  createStoredFileName,
  resolvePublicBaseUrl,
  toImageRecord,
} from "../../../../../src/server/gallery-storage.js";
import { createPresignedPutUrl, resolveR2DirectUploadConfig } from "../../../../../src/server/r2-direct-upload.js";
import { jsonResponse } from "../../../../../src/shared/http.js";

export async function signDirectUpload(options, signer = createPresignedPutUrl) {
  try {
    return { uploadUrl: await signer(options) };
  } catch (error) {
    const name = String(error?.name || "Error").slice(0, 80);
    const message = String(error?.message || "未知运行时错误").replace(/\s+/g, " ").slice(0, 240);
    return { error: `生成 R2 直传地址失败：${name}: ${message}` };
  }
}

function normalizeFileDrafts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      uploadId: String(item?.uploadId ?? "").trim() || null,
      clientItemId: String(item?.clientItemId ?? "").trim() || null,
      contentSha256: String(item?.contentSha256 ?? "").trim().toLowerCase(),
      name: String(item?.name ?? "").trim(),
      type: String(item?.type ?? "").trim(),
      size: Number(item?.size ?? 0),
      width: normalizeImageDimension(item?.width),
      height: normalizeImageDimension(item?.height),
      categoryId: Number(item?.categoryId),
      tagIds: Array.isArray(item?.tagIds) ? normalizeTagIds(item.tagIds) : null,
    }))
    .filter((item) => item.name);
}

function isUploadId(value) {
  return value === null || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isContentSha256(value) {
  return /^[0-9a-f]{64}$/.test(value);
}

function normalizedIds(value) {
  return [...value].map(Number).sort((left, right) => left - right);
}

function sameIds(left, right) {
  const normalizedLeft = normalizedIds(left);
  const normalizedRight = normalizedIds(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

function sessionMatches(session, expected) {
  return session.publicId === expected.publicId
    && session.contentSha256 === expected.contentSha256
    && session.storageKey === expected.storageKey
    && session.fileName === expected.fileName
    && session.fileUrl === expected.fileUrl
    && session.contentType === expected.contentType
    && session.fileSize === expected.fileSize
    && session.width === expected.width
    && session.height === expected.height
    && session.categoryId === expected.categoryId
    && sameIds(session.tagIds, expected.tagIds)
    && session.operationId === expected.operationId
    && session.clientItemId === expected.clientItemId;
}

function conflictResponse(message, details = {}) {
  return jsonResponse({ error: message, code: "UPLOAD_CONFLICT", ...details }, 409);
}

function duplicateContentResponse(duplicates, details = {}) {
  const count = duplicates.length;
  const reasons = new Set(duplicates.map((item) => item.reason));
  const error = reasons.size === 1 && reasons.has("same_batch")
    ? count === 1
      ? "本次选择中有两张内容完全相同的图片，将保留第一张并跳过后续重复项。"
      : `本次选择中有 ${count} 张重复图片，将保留每组第一张并跳过后续重复项。`
    : reasons.size === 1 && reasons.has("upload_in_progress")
      ? count === 1
        ? "相同图片正在上传中，本次重复任务已跳过。"
        : `${count} 张相同图片正在上传中，本次重复任务已跳过。`
      : count === 1
        ? "这张图片与图库中已有图片内容完全相同，已跳过上传。"
        : `发现 ${count} 张内容重复的图片，已跳过上传。`;
  return jsonResponse({
    error,
    code: "DUPLICATE_IMAGE_CONTENT",
    duplicates,
    ...details,
  }, 409);
}

function duplicateItem(file, { reason, existingImage = null, pendingSession = null } = {}) {
  return {
    uploadId: file.uploadId ?? null,
    clientItemId: file.clientItemId ?? null,
    fileName: file.name,
    contentSha256: file.contentSha256,
    reason,
    ...(existingImage ? {
      existingImage: {
        id: existingImage.id,
        publicId: existingImage.publicId,
        fileName: existingImage.fileName,
        fileUrl: existingImage.fileUrl,
      },
    } : {}),
    ...(pendingSession ? {
      pendingUploadId: pendingSession.id,
      pendingFileName: pendingSession.fileName,
    } : {}),
  };
}

async function handleRequest({ env, request }) {
  const startedAt = Date.now();
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const directUploadConfig = resolveR2DirectUploadConfig(env);
  if (directUploadConfig.error) {
    return jsonResponse({ error: directUploadConfig.error }, 500);
  }

  const payload = await request.json();
  const uploadPolicy = resolveUploadPolicy(env, payload?.namingStrategy);
  if (uploadPolicy.error) {
    return jsonResponse({ error: uploadPolicy.error }, 400);
  }
  const publicBaseUrl = resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request.url);
  const files = normalizeFileDrafts(payload?.files);
  if (files.length === 0) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }
  if (files.length > 50) {
    return jsonResponse({ error: "每次最多初始化 50 张图片。" }, 400);
  }

  if (files.some((file) => !isImageContentType(file.type))) {
    return jsonResponse({ error: "只能上传图片文件。" }, 400);
  }

  if (files.some((file) => !isUploadId(file.uploadId))) {
    return jsonResponse({ error: "上传任务标识无效。" }, 400);
  }
  if (files.some((file) => !isContentSha256(file.contentSha256))) {
    return jsonResponse({ error: "每张图片都必须提供有效的 SHA-256 内容哈希。" }, 400);
  }

  const seenContentHashes = new Set();
  const repeatedFiles = [];
  for (const file of files) {
    if (seenContentHashes.has(file.contentSha256)) {
      repeatedFiles.push(file);
    } else {
      seenContentHashes.add(file.contentSha256);
    }
  }
  if (repeatedFiles.length) {
    return duplicateContentResponse(
      repeatedFiles.map((file) => duplicateItem(file, { reason: "same_batch" })),
      { requestId },
    );
  }

  const repository = getRepository(env);
  const existingImages = await repository.getImagesByContentHashes(files.map((file) => file.contentSha256));
  if (existingImages.length) {
    const imagesByHash = new Map(existingImages.map((image) => [image.contentSha256, image]));
    return duplicateContentResponse(
      files
        .filter((file) => imagesByHash.has(file.contentSha256))
        .map((file) => duplicateItem(file, {
          reason: "existing_image",
          existingImage: imagesByHash.get(file.contentSha256),
        })),
      { requestId },
    );
  }

  const globalTagIds = normalizeTagIds(payload?.tagIds);
  const fileTagIds = files.map((file) => file.tagIds ?? globalTagIds);
  if (fileTagIds.some((tagIds) => tagIds.length === 0)) {
    return jsonResponse({ error: "请为每张图片至少选择一个标签。" }, 400);
  }
  const allTagIds = normalizeTagIds(fileTagIds.flat());
  const missingTagIds = await findMissingTagIds(repository, allTagIds);
  if (missingTagIds.length > 0) {
    return jsonResponse({ error: "存在无效标签，无法完成上传。" }, 400);
  }

  const globalCategoryId = Number(payload?.categoryId);
  const selectedCategoryIds = files.map((file) => (
    Number.isInteger(file.categoryId) && file.categoryId > 0
      ? file.categoryId
      : globalCategoryId
  ));
  const requestedCategoryIds = [...new Set(selectedCategoryIds.filter((categoryId) => (
    Number.isInteger(categoryId) && categoryId > 0
  )))];
  const categories = await repository.getCategoriesByIds(requestedCategoryIds);
  const categoriesById = new Map(categories.map((category) => [Number(category.id), category]));
  if (requestedCategoryIds.some((categoryId) => !categoriesById.has(categoryId))) {
    return jsonResponse({ error: "所选目录无效。" }, 400);
  }
  const fallbackFolder = String(env.GALLERY_UPLOAD_FOLDER ?? "").trim().replace(/^\/+|\/+$/g, "");
  const categorySelections = selectedCategoryIds.map((categoryId) => {
    const category = categoriesById.get(categoryId) ?? null;
    return category
      ? { category, uploadFolder: category.directory_slug }
      : fallbackFolder
        ? { category: null, uploadFolder: fallbackFolder }
        : null;
  });
  if (categorySelections.some((selection) => !selection)) {
    return jsonResponse({ error: "请选择一个目录。" }, 400);
  }

  const identifiedFiles = files.map((file) => ({
    ...file,
    uploadId: file.uploadId ?? crypto.randomUUID(),
  }));
  const existingSessions = await repository.getUploadSessionsByIds(identifiedFiles.map((file) => file.uploadId));
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));
  const operationId = String(payload?.operationId ?? "").trim()
    || identifiedFiles[0]?.uploadId
    || crypto.randomUUID();
  if (!isUploadId(operationId)) {
    return jsonResponse({ error: "上传操作标识无效。" }, 400);
  }
  const uploadDrafts = identifiedFiles.map((file, index) => {
    const uploadId = file.uploadId;
    const publicId = existingById.get(uploadId)?.publicId ?? crypto.randomUUID();
    const selectedCategory = categorySelections[index];
    const storedFileName = createStoredFileName(
      { name: file.name },
      uploadPolicy.uploadNameType,
      uploadId,
    );
    const storageKey = buildStorageKey(selectedCategory.uploadFolder, storedFileName);
    const imageRecord = toImageRecord(storageKey, publicBaseUrl, {
      width: file.width,
      height: file.height,
    });
    return {
      uploadId,
      publicId,
      contentSha256: file.contentSha256,
      operationId,
      clientItemId: file.clientItemId,
      storageKey,
      fileName: imageRecord.fileName,
      fileUrl: imageRecord.fileUrl,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
      width: file.width,
      height: file.height,
      categoryId: selectedCategory.category?.id ?? null,
      tagIds: fileTagIds[index],
      category: selectedCategory.category,
    };
  });

  const duplicateUploadIds = uploadDrafts.length !== new Set(uploadDrafts.map((draft) => draft.uploadId)).size;
  const duplicateStorageKeys = uploadDrafts.length !== new Set(uploadDrafts.map((draft) => draft.storageKey)).size;
  if (duplicateUploadIds || duplicateStorageKeys) {
    return conflictResponse("同一批次中存在重复的文件名或上传任务标识。");
  }

  if (typeof env.GALLERY_BUCKET?.head === "function") {
    const existingObjects = await Promise.all(uploadDrafts.map((draft) => (
      existingById.has(draft.uploadId) ? null : env.GALLERY_BUCKET.head(draft.storageKey)
    )));
    const conflictIndex = existingObjects.findIndex(Boolean);
    if (conflictIndex >= 0) {
      const draft = uploadDrafts[conflictIndex];
      return conflictResponse("存储中已存在同名图片，请更改文件名或恢复已有上传。", {
        uploadId: draft.uploadId,
        publicId: draft.publicId,
        storageKey: draft.storageKey,
      });
    }
  }

  const reservations = await repository.reserveUploadSessions(uploadDrafts.map((draft) => ({
    id: draft.uploadId,
    ...draft,
  })));
  const contentConflicts = reservations.flatMap((reservation, index) => {
    const draft = uploadDrafts[index];
    if (reservation.session) return [];
    if (reservation.existingContentImage) {
      return [duplicateItem(identifiedFiles[index], {
        reason: "existing_image",
        existingImage: reservation.existingContentImage,
      })];
    }
    if (reservation.contentSession && reservation.contentSession.id !== draft.uploadId) {
      return [duplicateItem(identifiedFiles[index], {
        reason: "upload_in_progress",
        pendingSession: reservation.contentSession,
      })];
    }
    return [];
  });
  if (contentConflicts.length) {
    return duplicateContentResponse(contentConflicts, { requestId });
  }
  for (const [index, draft] of uploadDrafts.entries()) {
      const reservation = reservations[index];
      if (!reservation.session || !sessionMatches(reservation.session, draft)) {
        return conflictResponse("该文件名或上传任务已被其他图片占用。", {
          uploadId: draft.uploadId,
          storageKey: draft.storageKey,
        });
      }
      if (reservation.session.status !== "pending") {
        return conflictResponse("该上传任务已经完成，不能再次覆盖图片。", {
          uploadId: draft.uploadId,
          storageKey: draft.storageKey,
          imageId: reservation.session.imageId,
        });
      }
  }

  const newlyReservedIds = uploadDrafts
    .filter((draft) => !existingById.has(draft.uploadId))
    .map((draft) => draft.uploadId);
  let signedUploads;
  try {
    signedUploads = await Promise.all(uploadDrafts.map(async (draft) => {
      const signed = await signDirectUpload({
        ...directUploadConfig,
        key: draft.storageKey,
        contentType: draft.contentType,
      });
      if (signed.error) throw new Error(signed.error);
      return signed;
    }));
  } catch (error) {
    await repository.deletePendingUploadSessions(newlyReservedIds);
    throw error;
  }

  const uploads = uploadDrafts.map((draft, index) => ({
        uploadId: draft.uploadId,
        publicId: draft.publicId,
        storageKey: draft.storageKey,
        fileName: draft.fileName,
        fileUrl: draft.fileUrl,
        width: draft.width,
        height: draft.height,
        operationId: draft.operationId,
        clientItemId: draft.clientItemId,
        ...(draft.category
          ? {
              category: {
                id: draft.category.id,
                name: draft.category.name,
                directorySlug: draft.category.directory_slug,
                sortOrder: Number(draft.category.sort_order ?? 0),
              },
            }
          : {}),
        contentType: draft.contentType,
        method: "PUT",
        headers: {
          "content-type": draft.contentType,
        },
        uploadUrl: signedUploads[index].uploadUrl,
      }));

  console.info(JSON.stringify({
    level: "info",
    service: "gallery-upload-init",
    phase: "reserved",
    requestId,
    operationId,
    uploadCount: uploads.length,
    durationMs: Date.now() - startedAt,
  }));
  return jsonResponse({
    operationId,
    uploads,
  });
}

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    const name = String(error?.name || "Error").slice(0, 80);
    const message = String(error?.message || "未知运行时错误").replace(/\s+/g, " ").slice(0, 240);
    return jsonResponse({ error: `初始化上传失败：${name}: ${message}` }, 500);
  }
}
