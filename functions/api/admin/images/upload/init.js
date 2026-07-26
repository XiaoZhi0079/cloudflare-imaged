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
      name: String(item?.name ?? "").trim(),
      type: String(item?.type ?? "").trim(),
      size: Number(item?.size ?? 0),
      width: normalizeImageDimension(item?.width),
      height: normalizeImageDimension(item?.height),
    }))
    .filter((item) => item.name);
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

function sessionMatches(session, expected) {
  return session.storageKey === expected.storageKey
    && session.fileName === expected.fileName
    && session.fileUrl === expected.fileUrl
    && session.contentType === expected.contentType
    && session.fileSize === expected.fileSize
    && session.width === expected.width
    && session.height === expected.height
    && session.categoryId === expected.categoryId
    && sameIds(session.tagIds, expected.tagIds);
}

function conflictResponse(message, details = {}) {
  return jsonResponse({ error: message, code: "UPLOAD_CONFLICT", ...details }, 409);
}

async function resolveSelectedCategory(repository, env, payload) {
  const categoryId = Number(payload?.categoryId);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    const category = await repository.getCategoryById(categoryId);
    if (!category) {
      return { error: "所选目录无效。" };
    }

    return { category, uploadFolder: category.directory_slug };
  }

  const uploadFolder = String(env.GALLERY_UPLOAD_FOLDER ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (uploadFolder) {
    return { category: null, uploadFolder };
  }

  return { error: "请选择一个目录。" };
}

async function handleRequest({ env, request }) {
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

  const uploadPolicy = resolveUploadPolicy(env);
  if (uploadPolicy.error) {
    return jsonResponse({ error: uploadPolicy.error }, 500);
  }

  const payload = await request.json();
  const publicBaseUrl = resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request.url);
  const files = normalizeFileDrafts(payload?.files);
  if (files.length === 0) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }

  if (files.some((file) => !isImageContentType(file.type))) {
    return jsonResponse({ error: "只能上传图片文件。" }, 400);
  }

  if (files.some((file) => !isUploadId(file.uploadId))) {
    return jsonResponse({ error: "上传任务标识无效。" }, 400);
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

  const selectedCategory = await resolveSelectedCategory(repository, env, payload);
  if (selectedCategory.error) {
    return jsonResponse({ error: selectedCategory.error }, 400);
  }

  const uploadDrafts = files.map((file) => {
    const storedFileName = createStoredFileName({ name: file.name }, uploadPolicy.uploadNameType);
    const storageKey = buildStorageKey(selectedCategory.uploadFolder, storedFileName);
    const imageRecord = toImageRecord(storageKey, publicBaseUrl, {
      width: file.width,
      height: file.height,
    });
    return {
      uploadId: file.uploadId ?? crypto.randomUUID(),
      storageKey,
      fileName: imageRecord.fileName,
      fileUrl: imageRecord.fileUrl,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
      width: file.width,
      height: file.height,
      categoryId: selectedCategory.category?.id ?? null,
      tagIds,
    };
  });

  const duplicateUploadIds = uploadDrafts.length !== new Set(uploadDrafts.map((draft) => draft.uploadId)).size;
  const duplicateStorageKeys = uploadDrafts.length !== new Set(uploadDrafts.map((draft) => draft.storageKey)).size;
  if (duplicateUploadIds || duplicateStorageKeys) {
    return conflictResponse("同一批次中存在重复的文件名或上传任务标识。");
  }

  const uploads = [];
  const newlyReservedIds = [];
  try {
    for (const draft of uploadDrafts) {
      const existingSession = await repository.getUploadSessionById(draft.uploadId);
      if (!existingSession && typeof env.GALLERY_BUCKET?.head === "function") {
        const existingObject = await env.GALLERY_BUCKET.head(draft.storageKey);
        if (existingObject) {
          for (const uploadId of newlyReservedIds) await repository.deletePendingUploadSession(uploadId);
          return conflictResponse("存储中已存在同名图片，请更改文件名或恢复已有上传。", {
            uploadId: draft.uploadId,
            storageKey: draft.storageKey,
          });
        }
      }

      const reservation = await repository.reserveUploadSession({
        id: draft.uploadId,
        ...draft,
      });
      if (!reservation.session || !sessionMatches(reservation.session, draft)) {
        for (const uploadId of newlyReservedIds) await repository.deletePendingUploadSession(uploadId);
        return conflictResponse("该文件名或上传任务已被其他图片占用。", {
          uploadId: draft.uploadId,
          storageKey: draft.storageKey,
        });
      }
      if (reservation.session.status !== "pending") {
        for (const uploadId of newlyReservedIds) await repository.deletePendingUploadSession(uploadId);
        return conflictResponse("该上传任务已经完成，不能再次覆盖图片。", {
          uploadId: draft.uploadId,
          storageKey: draft.storageKey,
          imageId: reservation.session.imageId,
        });
      }
      if (!existingSession) newlyReservedIds.push(draft.uploadId);

      const signedUpload = await signDirectUpload({
        ...directUploadConfig,
        key: draft.storageKey,
        contentType: draft.contentType,
      });
      if (signedUpload.error) throw new Error(signedUpload.error);

      uploads.push({
        uploadId: draft.uploadId,
        storageKey: draft.storageKey,
        fileName: draft.fileName,
        fileUrl: draft.fileUrl,
        width: draft.width,
        height: draft.height,
        ...(selectedCategory.category
          ? {
              category: {
                id: selectedCategory.category.id,
                name: selectedCategory.category.name,
                directorySlug: selectedCategory.category.directory_slug,
                sortOrder: Number(selectedCategory.category.sort_order ?? 0),
              },
            }
          : {}),
        contentType: draft.contentType,
        method: "PUT",
        headers: {
          "content-type": draft.contentType,
        },
        uploadUrl: signedUpload.uploadUrl,
      });
    }
  } catch (error) {
    for (const uploadId of newlyReservedIds) await repository.deletePendingUploadSession(uploadId);
    throw error;
  }

  return jsonResponse({
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
