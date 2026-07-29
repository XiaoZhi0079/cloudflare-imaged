import { getRepository, requireAdminKey, toApiImage } from "../../_shared.js";
import {
  findMissingTagIds,
  normalizeImageDimension,
  normalizeTagIds,
} from "../../../../../src/server/gallery-upload.js";
import { buildPublicUrl, resolvePublicBaseUrl } from "../../../../../src/server/gallery-storage.js";
import { jsonResponse } from "../../../../../src/shared/http.js";

function normalizeCompletedFiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      uploadId: String(item?.uploadId ?? "").trim() || null,
      storageKey: String(item?.storageKey ?? "").trim().replace(/^\/+/, ""),
      fileName: String(item?.fileName ?? "").trim(),
      width: normalizeImageDimension(item?.width),
      height: normalizeImageDimension(item?.height),
    }))
    .filter((item) => item.storageKey && item.fileName);
}

function isUploadId(value) {
  return value === null || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function sessionMatchesCompletion(session, file, expected = {}) {
  return session.storageKey === file.storageKey
    && session.fileName === file.fileName
    && session.width === file.width
    && session.height === file.height
    && (expected.categoryId === undefined || session.categoryId === expected.categoryId)
    && (expected.tagIds === undefined || sameIds(session.tagIds, expected.tagIds));
}

function writeLog(level, data) {
  const method = level === "error" ? "error" : "info";
  console[method](JSON.stringify({ level, service: "gallery-upload-complete", ...data }));
}

function conflictResponse(message, requestId, details = {}) {
  return jsonResponse({
    error: message,
    code: "UPLOAD_CONFLICT",
    requestId,
    ...details,
  }, 409);
}

function duplicateContentResponse(duplicates, requestId) {
  return jsonResponse({
    error: duplicates.length === 1
      ? "这张图片与图库中已有图片内容完全相同，已跳过上传。"
      : `发现 ${duplicates.length} 张内容重复的图片，已跳过上传。`,
    code: "DUPLICATE_IMAGE_CONTENT",
    requestId,
    duplicates,
  }, 409);
}

function errorDetails(error) {
  return {
    name: String(error?.name ?? "Error").slice(0, 80),
    code: String(error?.code ?? "UNKNOWN").slice(0, 80),
    message: String(error?.message ?? "unknown error").replace(/\s+/g, " ").slice(0, 240),
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

  const payload = await request.json();
  const publicBaseUrl = resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request.url);
  const files = normalizeCompletedFiles(payload?.files);
  if (files.length === 0) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }
  if (files.length > 50) {
    return jsonResponse({ error: "每次最多完成 50 张图片。" }, 400);
  }

  if (files.some((file) => !isUploadId(file.uploadId))) {
    return jsonResponse({ error: "上传任务标识无效。", requestId }, 400);
  }

  const repository = getRepository(env);
  const hasExpectedTags = Array.isArray(payload?.tagIds);
  const tagIds = hasExpectedTags ? normalizeTagIds(payload.tagIds) : undefined;
  if (hasExpectedTags && tagIds.length === 0) {
    return jsonResponse({ error: "请至少选择一个标签。" }, 400);
  }
  if (tagIds) {
    const missingTagIds = await findMissingTagIds(repository, tagIds);
    if (missingTagIds.length > 0) {
      return jsonResponse({ error: "存在无效标签，无法完成上传。" }, 400);
    }
  }

  let category;
  const categoryId = Number(payload?.categoryId);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    category = await repository.getCategoryById(categoryId);
    if (!category) {
      return jsonResponse({ error: "所选目录无效。" }, 400);
    }
  } else if (Object.prototype.hasOwnProperty.call(payload ?? {}, "categoryId")) {
    category = null;
  }

  if (files.some((file) => !file.uploadId) && (!tagIds || (category === undefined && !String(env.GALLERY_UPLOAD_FOLDER ?? "").trim()))) {
    return jsonResponse({ error: "旧版恢复请求必须提供目录和标签。" }, 400);
  }

  const objects = await Promise.all(files.map((file) => (
    typeof env.GALLERY_BUCKET?.head === "function"
      ? env.GALLERY_BUCKET.head(file.storageKey)
      : null
  )));
  const missingObjectIndex = objects.findIndex((object) => !object);
  if (missingObjectIndex >= 0) {
    const file = files[missingObjectIndex];
    writeLog("error", {
      requestId,
      phase: "r2-head",
      uploadId: file.uploadId,
      storageKey: file.storageKey,
      durationMs: Date.now() - startedAt,
      error: { code: "UPLOAD_OBJECT_MISSING" },
    });
    return jsonResponse({
      error: "存在未完成上传的图片，请重新上传后再提交。",
      code: "UPLOAD_OBJECT_MISSING",
      requestId,
    }, 400);
  }

  const requestedUploadIds = files.map((file) => file.uploadId).filter(Boolean);
  const existingSessions = await repository.getUploadSessionsByIds(requestedUploadIds);
  const sessionsById = new Map(existingSessions.map((session) => [session.id, session]));
  const sessions = [];
  for (const [index, file] of files.entries()) {
    let session = file.uploadId ? sessionsById.get(file.uploadId) : null;
    if (!session && !file.uploadId) {
      session = await repository.getUploadSessionByStorageKey(file.storageKey);
    }
    if (!session && !file.uploadId) {
      const recoveryId = crypto.randomUUID();
      const reservation = await repository.reserveUploadSession({
        id: recoveryId,
        storageKey: file.storageKey,
        fileName: file.fileName,
        fileUrl: buildPublicUrl(publicBaseUrl, file.storageKey),
        contentType: objects[index].httpMetadata?.contentType ?? "application/octet-stream",
        fileSize: Number(objects[index].size ?? 0),
        width: file.width,
        height: file.height,
        categoryId: category?.id ?? null,
        tagIds,
        operationId: crypto.randomUUID(),
      });
      session = reservation.session;
    }

    const expected = {
      ...(category !== undefined ? { categoryId: category?.id ?? null } : {}),
      ...(tagIds ? { tagIds } : {}),
    };
    if (!session || !sessionMatchesCompletion(session, file, expected)) {
      writeLog("error", {
        requestId,
        phase: "session-validation",
        uploadId: file.uploadId ?? session?.id ?? null,
        storageKey: file.storageKey,
        operationId: session?.operationId ?? null,
        clientItemId: session?.clientItemId ?? null,
        expectedTagCount: tagIds?.length ?? session?.tagIds.length ?? 0,
        actualTagCount: session?.tagIds.length ?? 0,
        durationMs: Date.now() - startedAt,
        error: { code: "UPLOAD_CONFLICT" },
      });
      return conflictResponse("上传任务与文件、目录或标签不匹配，已拒绝覆盖。", requestId, {
        uploadId: file.uploadId ?? session?.id ?? null,
        storageKey: file.storageKey,
      });
    }
    sessions.push(session);
  }

  let results;
  try {
    results = await repository.completeUploadSessions(sessions.map((session) => session.id));
    for (const result of results) {
      writeLog("info", {
        requestId,
        phase: "verified",
        operationId: result.session.operationId,
        clientItemId: result.session.clientItemId,
        uploadId: result.session.id,
        storageKey: result.session.storageKey,
        imageId: result.image.id,
        expectedTagCount: result.expectedTagIds.length,
        actualTagCount: result.actualTagIds.length,
        idempotent: result.idempotent,
        durationMs: Date.now() - startedAt,
      });
    }
  } catch (error) {
    writeLog("error", {
      requestId,
      phase: error?.code === "IMAGE_TAG_VERIFICATION_FAILED" ? "tag-verification" : "database-commit",
      uploadId: error?.uploadId ?? null,
      imageId: error?.imageId ?? null,
      expectedTagCount: error?.expectedTagIds?.length ?? null,
      actualTagCount: error?.actualTagIds?.length ?? null,
      durationMs: Date.now() - startedAt,
      error: errorDetails(error),
    });
    if (error?.code === "UPLOAD_STORAGE_CONFLICT") {
      return conflictResponse("该存储位置已属于另一张图片，已拒绝覆盖。", requestId);
    }
    if (error?.code === "DUPLICATE_IMAGE_CONTENT") {
      const imagesByHash = new Map((error.duplicates ?? [])
        .map((image) => [image.contentSha256, image]));
      const duplicateSessions = sessions.filter((session) => imagesByHash.has(session.contentSha256));
      const duplicates = duplicateSessions.map((session) => {
        const existingImage = imagesByHash.get(session.contentSha256);
        return {
          uploadId: session.id,
          clientItemId: session.clientItemId,
          fileName: session.fileName,
          contentSha256: session.contentSha256,
          reason: "existing_image",
          existingImage: {
            id: existingImage.id,
            publicId: existingImage.publicId,
            fileName: existingImage.fileName,
            fileUrl: existingImage.fileUrl,
          },
        };
      });
      if (duplicates.length) {
        try {
          const storageOwners = await Promise.all(
            duplicateSessions.map((session) => repository.getImageByStorageKey(session.storageKey)),
          );
          await repository.deletePendingUploadSessions(duplicateSessions.map((session) => session.id));
          if (typeof env.GALLERY_BUCKET?.delete === "function") {
            await Promise.all(duplicateSessions
              .filter((session, index) => !storageOwners[index])
              .map((session) => env.GALLERY_BUCKET.delete(session.storageKey)));
          }
        } catch (cleanupError) {
          writeLog("error", {
            requestId,
            phase: "duplicate-cleanup",
            durationMs: Date.now() - startedAt,
            error: errorDetails(cleanupError),
          });
        }
        return duplicateContentResponse(duplicates, requestId);
      }
    }
    throw error;
  }

  return jsonResponse({
    uploadedCount: results.length,
    images: results.map((result) => toApiImage(result.image)),
  });
}

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    const requestId = context.request.headers.get("cf-ray") ?? crypto.randomUUID();
    writeLog("error", {
      requestId,
      phase: "request",
      error: errorDetails(error),
    });
    return jsonResponse({
      error: "图片已传入存储，但写入图库失败，请重试失败项。",
      code: "UPLOAD_COMPLETE_FAILED",
      requestId,
    }, 500);
  }
}
