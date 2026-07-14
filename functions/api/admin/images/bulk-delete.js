import { getGalleryStorage, getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";

function normalizeImageIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((imageId) => Number(imageId)).filter((imageId) => Number.isInteger(imageId) && imageId > 0))];
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
  const repository = getRepository(env);
  const storage = getGalleryStorage(env, request);
  const imageIds = normalizeImageIds(body.imageIds ?? []);

  if (!imageIds.length) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }

  const images = await Promise.all(imageIds.map((imageId) => repository.getImageById(imageId)));
  if (images.some((image) => !image)) {
    return jsonResponse({ error: "存在无效图片，无法完成批量删除。" }, 400);
  }

  for (const image of images) {
    try {
      await storage.deleteImage(image.storageKey);
    } catch {
      await repository.updateImageSyncState(image.id, {
        syncStatus: "delete_failed",
        note: "底层文件删除失败，图片仍保留在资源库中。",
      });

      return jsonResponse({
        error: "批量删除中断：存在底层文件删除失败的图片。",
        imageId: image.id,
      }, 502);
    }
  }

  for (const image of images) {
    await repository.deleteImage(image.id);
  }

  return jsonResponse({
    deletedCount: imageIds.length,
    imageIds,
  });
}
