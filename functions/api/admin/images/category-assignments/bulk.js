import {
  getGalleryStorage,
  getRepository,
  requireAdminKey,
  toAdminImage,
} from "../../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../../src/shared/http.js";

function normalizeImageIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(Number)
        .filter((imageId) => Number.isInteger(imageId) && imageId > 0),
    ),
  ];
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await parseRequestJson(request);
  const imageIds = normalizeImageIds(body.imageIds);
  const categoryId = Number(body.categoryId);
  if (!imageIds.length || !Number.isInteger(categoryId) || categoryId <= 0) {
    return jsonResponse({ error: "imageIds 和 categoryId 均为必填项。" }, 400);
  }

  const repository = getRepository(env);
  const category = await repository.getCategoryById(categoryId);
  if (!category) {
    return jsonResponse({ error: "所选目录无效。" }, 400);
  }

  const images = await Promise.all(imageIds.map((imageId) => repository.getImageById(imageId)));
  if (images.some((image) => !image)) {
    return jsonResponse({ error: "存在无效图片，无法完成批量分类。" }, 400);
  }

  const storage = getGalleryStorage(env, request);
  const succeeded = [];
  const failed = [];

  for (const image of images) {
    try {
      const moved = await storage.moveImage(image.storageKey, category.directory_slug);
      const updated = await repository.updateImage(image.id, {
        storageKey: moved.storageKey,
        fileName: moved.fileName,
        fileUrl: moved.fileUrl,
        categoryId: category.id,
        syncStatus: "ok",
        note: null,
      });
      succeeded.push(toAdminImage(updated));
    } catch {
      await repository.updateImageSyncState(image.id, {
        syncStatus: "move_failed",
        note: "批量移动分类时底层文件移动失败。",
      });
      failed.push({ imageId: image.id, error: "底层文件移动失败。" });
    }
  }

  return jsonResponse({ images: succeeded, failed });
}
