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

function sessionMatchesCompletion(session, file, categoryId, tagIds) {
  return session.storageKey === file.storageKey
    && session.fileName === file.fileName
    && session.width === file.width
    && session.height === file.height
    && session.categoryId === categoryId
    && sameIds(session.tagIds, tagIds);
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

function errorDetails(error) {
  return {
    name: String(error?.name ?? "Error").slice(0, 80),
    code: String(error?.code ?? "UNKNOWN").slice(0, 80),
    message: String(error?.message ?? "unknown error").replace(/\s+/g, " ").slice(0, 240),
  };
}

async function handleRequest({ env, request }) {
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

  if (files.some((file) => !isUploadId(file.uploadId))) {
    return jsonResponse({ error: "上传任务标识无效。", requestId }, 400);
  }

  const tagIds = normalizeTagIds(payload?.tagIds);
  if (tagIds.length === 0) {
    return jsonResponse({ error: "请至少选择一个标签。" }, 400);
  }

  const repository = getRepository(env);
  const missingTagIds = await findMissingTagIds(repository, tagIds);
  if (missingTagIds.length > 0) {
    return jsonResponse({ error: "存在无效标签，无法完成上传。" }, 400);
  }

  let category = null;
  const categoryId = Number(payload?.categoryId);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    category = await repository.getCategoryById(categoryId);
    if (!category) {
      return jsonResponse({ error: "所选目录无效。" }, 400);
    }
  }

  if (!category && !String(env.GALLERY_UPLOAD_FOLDER ?? "").trim()) {
    return jsonResponse({ error: "请选择一个目录。" }, 400);
  }

  const uploadedImages = [];
  for (const file of files) {
    const object = typeof env.GALLERY_BUCKET?.head === "function"
      ? await env.GALLERY_BUCKET.head(file.storageKey)
      : null;

    if (!object) {
      writeLog("error", {
        requestId,
        phase: "r2-head",
        uploadId: file.uploadId,
        storageKey: file.storageKey,
        error: { code: "UPLOAD_OBJECT_MISSING" },
      });
      return jsonResponse({
        error: "存在未完成上传的图片，请重新上传后再提交。",
        code: "UPLOAD_OBJECT_MISSING",
        requestId,
      }, 400);
    }

    let session = file.uploadId
      ? await repository.getUploadSessionById(file.uploadId)
      : await repository.getUploadSessionByStorageKey(file.storageKey);

    if (!session && !file.uploadId) {
      const recoveryId = crypto.randomUUID();
      const reservation = await repository.reserveUploadSession({
        id: recoveryId,
        storageKey: file.storageKey,
        fileName: file.fileName,
        fileUrl: buildPublicUrl(publicBaseUrl, file.storageKey),
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
        fileSize: Number(object.size ?? 0),
        width: file.width,
        height: file.height,
        categoryId: category?.id ?? null,
        tagIds,
      });
      session = reservation.session;
    }

    if (!session || !sessionMatchesCompletion(session, file, category?.id ?? null, tagIds)) {
      writeLog("error", {
        requestId,
        phase: "session-validation",
        uploadId: file.uploadId ?? session?.id ?? null,
        storageKey: file.storageKey,
        expectedTagIds: tagIds,
        actualTagIds: session?.tagIds ?? [],
        error: { code: "UPLOAD_CONFLICT" },
      });
      return conflictResponse("上传任务与文件、目录或标签不匹配，已拒绝覆盖。", requestId, {
        uploadId: file.uploadId ?? session?.id ?? null,
        storageKey: file.storageKey,
      });
    }

    try {
      const result = await repository.completeUploadSession(session.id);
      if (!result) {
        return conflictResponse("上传任务不存在或已失效。", requestId, {
          uploadId: session.id,
          storageKey: file.storageKey,
        });
      }
      writeLog("info", {
        requestId,
        phase: "verified",
        uploadId: session.id,
        storageKey: file.storageKey,
        imageId: result.image.id,
        expectedTagIds: result.expectedTagIds,
        actualTagIds: result.actualTagIds,
        idempotent: result.idempotent,
      });
      uploadedImages.push(result.image);
    } catch (error) {
      writeLog("error", {
        requestId,
        phase: error?.code === "UPLOAD_TAG_VERIFICATION_FAILED" ? "tag-verification" : "database-commit",
        uploadId: session.id,
        storageKey: file.storageKey,
        imageId: error?.imageId ?? null,
        expectedTagIds: error?.expectedTagIds ?? session.tagIds,
        actualTagIds: error?.actualTagIds ?? [],
        error: errorDetails(error),
      });
      if (error?.code === "UPLOAD_STORAGE_CONFLICT") {
        return conflictResponse("该存储位置已属于另一张图片，已拒绝覆盖。", requestId, {
          uploadId: session.id,
          storageKey: file.storageKey,
        });
      }
      throw error;
    }
  }

  return jsonResponse({
    uploadedCount: uploadedImages.length,
    images: uploadedImages.map(toApiImage),
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
