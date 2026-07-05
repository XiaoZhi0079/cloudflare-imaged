import { getRepository, requireAdminKey } from "../../_shared.js";
import {
  findMissingTagIds,
  isImageContentType,
  normalizeImageDimension,
  normalizeTagIds,
  resolveUploadPolicy,
} from "../../../../../src/server/gallery-upload.js";
import { buildStorageKey, createStoredFileName, toImageRecord } from "../../../../../src/server/gallery-storage.js";
import { createPresignedPutUrl, resolveR2DirectUploadConfig } from "../../../../../src/server/r2-direct-upload.js";
import { jsonResponse } from "../../../../../src/shared/http.js";

function normalizeFileDrafts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      name: String(item?.name ?? "").trim(),
      type: String(item?.type ?? "").trim(),
      size: Number(item?.size ?? 0),
      width: normalizeImageDimension(item?.width),
      height: normalizeImageDimension(item?.height),
    }))
    .filter((item) => item.name);
}

export async function onRequest({ env, request }) {
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
  const files = normalizeFileDrafts(payload?.files);
  if (files.length === 0) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }

  if (files.some((file) => !isImageContentType(file.type))) {
    return jsonResponse({ error: "只能上传图片文件。" }, 400);
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

  const uploads = [];
  for (const file of files) {
    const storedFileName = createStoredFileName({ name: file.name }, uploadPolicy.uploadNameType);
    const storageKey = buildStorageKey(uploadPolicy.uploadFolder, storedFileName);
    const imageRecord = toImageRecord(storageKey, env.GALLERY_PUBLIC_BASE_URL, {
      width: file.width,
      height: file.height,
    });
    const contentType = file.type || "application/octet-stream";
    const uploadUrl = await createPresignedPutUrl({
      ...directUploadConfig,
      key: storageKey,
      contentType,
    });

    uploads.push({
      ...imageRecord,
      contentType,
      method: "PUT",
      headers: {
        "content-type": contentType,
      },
      uploadUrl,
    });
  }

  return jsonResponse({
    uploads,
  });
}
