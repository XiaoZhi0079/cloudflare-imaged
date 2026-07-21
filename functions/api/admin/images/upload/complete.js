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
      storageKey: String(item?.storageKey ?? "").trim().replace(/^\/+/, ""),
      fileName: String(item?.fileName ?? "").trim(),
      width: normalizeImageDimension(item?.width),
      height: normalizeImageDimension(item?.height),
    }))
    .filter((item) => item.storageKey && item.fileName);
}

function errorDetails(error) {
  return {
    name: String(error?.name ?? "Error").slice(0, 80),
    code: String(error?.code ?? "UNKNOWN").slice(0, 80),
    message: String(error?.message ?? "unknown error").replace(/\s+/g, " ").slice(0, 240),
  };
}

async function handleRequest({ env, request }) {
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
      return jsonResponse({ error: "所选主分类无效。" }, 400);
    }
  }

  if (!category && !String(env.GALLERY_UPLOAD_FOLDER ?? "").trim()) {
    return jsonResponse({ error: "请选择一个主分类。" }, 400);
  }

  const uploadedImageIds = [];
  for (const file of files) {
    const object = typeof env.GALLERY_BUCKET?.head === "function"
      ? await env.GALLERY_BUCKET.head(file.storageKey)
      : null;

    if (!object) {
      return jsonResponse({ error: "存在未完成上传的图片，请重新上传后再提交。" }, 400);
    }

    const image = await repository.upsertImage({
      storageKey: file.storageKey,
      fileName: file.fileName,
      fileUrl: buildPublicUrl(publicBaseUrl, file.storageKey),
      width: file.width,
      height: file.height,
      syncStatus: "ok",
      categoryId: category?.id ?? null,
    });
    await repository.replaceImageTags(image.id, tagIds);
    uploadedImageIds.push(image.id);
  }

  const images = await repository.listImagesByIds(uploadedImageIds);
  const imagesById = new Map(images.map((image) => [image.id, image]));

  return jsonResponse({
    uploadedCount: uploadedImageIds.length,
    images: uploadedImageIds
      .map((imageId) => imagesById.get(imageId))
      .filter(Boolean)
      .map(toApiImage),
  });
}

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    const requestId = context.request.headers.get("cf-ray") ?? crypto.randomUUID();
    console.error(JSON.stringify({
      level: "error",
      service: "gallery-upload-complete",
      requestId,
      error: errorDetails(error),
    }));
    return jsonResponse({
      error: "图片已传入存储，但写入图库失败，请重试失败项。",
      code: "UPLOAD_COMPLETE_FAILED",
      requestId,
    }, 500);
  }
}
