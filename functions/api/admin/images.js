import { getGalleryStorage, getRepository, requireAdminKey, toAdminImage } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  const repository = getRepository(env);

  if (request.method === "GET") {
    const images = await repository.listImages();

    return jsonResponse({
      images: images.map(toAdminImage),
    });
  }

  if (request.method === "PATCH") {
    const body = await parseRequestJson(request);
    const imageId = Number(body?.imageId);
    const nextFileName = String(body?.fileName ?? "").trim();
    const nextDirectory = String(body?.directory ?? "").trim();

    if (!Number.isInteger(imageId) || imageId <= 0) {
      return jsonResponse({ error: "imageId is required" }, 400);
    }

    if (!nextFileName && !nextDirectory) {
      return jsonResponse({ error: "fileName or directory is required" }, 400);
    }

    const image = await repository.getImageById(imageId);
    if (!image) {
      return jsonResponse({ error: "Image not found" }, 404);
    }

    const storage = getGalleryStorage(env);

    if (nextDirectory) {
      try {
        const moved = await storage.moveImage(image.storageKey, nextDirectory);
        const updated = await repository.updateImage(imageId, {
          storageKey: moved.storageKey,
          fileName: moved.fileName,
          fileUrl: moved.fileUrl,
          syncStatus: "ok",
          note: null,
        });

        return jsonResponse({ image: toAdminImage(updated) });
      } catch {
        await repository.updateImageSyncState(imageId, {
          syncStatus: "move_failed",
          note: "底层文件移动失败，图片仍保留在原始目录中。",
        });

        return jsonResponse({
          error: "底层文件移动失败，图片已标记为待修复。",
          imageId,
        }, 502);
      }
    }

    const parts = image.storageKey.split("/");
    parts[parts.length - 1] = nextFileName;
    const newFileId = parts.join("/");

    try {
      const renamed = await storage.renameImage(image.storageKey, newFileId);
      const updated = await repository.updateImage(imageId, {
        storageKey: renamed.storageKey,
        fileName: renamed.fileName,
        fileUrl: renamed.fileUrl,
        syncStatus: "ok",
        note: null,
      });

      return jsonResponse({ image: toAdminImage(updated) });
    } catch {
      await repository.updateImageSyncState(imageId, {
        syncStatus: "rename_failed",
        note: "底层文件重命名失败，图片仍保留原始文件名。",
      });

      return jsonResponse({
        error: "底层文件重命名失败，图片已标记为待修复。",
        imageId,
      }, 502);
    }
  }

  if (request.method === "DELETE") {
    const body = await parseRequestJson(request);
    const imageId = Number(body?.imageId);
    if (!Number.isInteger(imageId) || imageId <= 0) {
      return jsonResponse({ error: "imageId is required" }, 400);
    }

    const image = await repository.getImageById(imageId);
    if (!image) {
      return jsonResponse({ error: "Image not found" }, 404);
    }

    const storage = getGalleryStorage(env);

    try {
      await storage.deleteImage(image.storageKey);
    } catch {
      await repository.updateImageSyncState(imageId, {
        syncStatus: "delete_failed",
        note: "底层文件删除失败，图片仍保留在资源库中。",
      });

      return jsonResponse({
        error: "底层文件删除失败，图片已标记为待修复。",
        imageId,
      }, 502);
    }

    await repository.deleteImage(imageId);
    return jsonResponse({ deletedImageId: imageId });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
