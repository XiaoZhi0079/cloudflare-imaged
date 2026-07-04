import { getImgBedClient, getRepository, requireAdminKey, toAdminImage } from "./_shared.js";
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

    const client = getImgBedClient(env);

    if (nextDirectory) {
      try {
        const moved = await client.moveImage(image.imgbedFileId, nextDirectory);
        const updated = await repository.updateImage(imageId, {
          imgbedFileId: moved.imgbedFileId,
          fileName: moved.fileName,
          fileUrl: moved.fileUrl,
          syncStatus: "ok",
          note: null,
        });

        return jsonResponse({ image: toAdminImage(updated) });
      } catch {
        await repository.updateImageSyncState(imageId, {
          syncStatus: "move_failed",
          note: "\u5e95\u5c42\u6587\u4ef6\u79fb\u52a8\u5931\u8d25\uff0c\u56fe\u7247\u4ecd\u4fdd\u7559\u5728\u539f\u59cb\u76ee\u5f55\u4e2d\u3002",
        });

        return jsonResponse({
          error: "\u5e95\u5c42\u6587\u4ef6\u79fb\u52a8\u5931\u8d25\uff0c\u56fe\u7247\u5df2\u6807\u8bb0\u4e3a\u5f85\u4fee\u590d\u3002",
          imageId,
        }, 502);
      }
    }

    const parts = image.imgbedFileId.split("/");
    parts[parts.length - 1] = nextFileName;
    const newFileId = parts.join("/");

    try {
      const renamed = await client.renameImage(image.imgbedFileId, newFileId);
      const updated = await repository.updateImage(imageId, {
        imgbedFileId: renamed.imgbedFileId,
        fileName: renamed.fileName,
        fileUrl: renamed.fileUrl,
        syncStatus: "ok",
        note: null,
      });

      return jsonResponse({ image: toAdminImage(updated) });
    } catch {
      await repository.updateImageSyncState(imageId, {
        syncStatus: "rename_failed",
        note: "\u5e95\u5c42\u6587\u4ef6\u91cd\u547d\u540d\u5931\u8d25\uff0c\u56fe\u7247\u4ecd\u4fdd\u7559\u539f\u59cb\u6587\u4ef6\u540d\u3002",
      });

      return jsonResponse({
        error: "\u5e95\u5c42\u6587\u4ef6\u91cd\u547d\u540d\u5931\u8d25\uff0c\u56fe\u7247\u5df2\u6807\u8bb0\u4e3a\u5f85\u4fee\u590d\u3002",
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

    const client = getImgBedClient(env);

    try {
      await client.deleteImage(image.imgbedFileId);
    } catch {
      await repository.updateImageSyncState(imageId, {
        syncStatus: "delete_failed",
        note: "\u5e95\u5c42\u6587\u4ef6\u5220\u9664\u5931\u8d25\uff0c\u56fe\u7247\u4ecd\u4fdd\u7559\u5728\u8d44\u6e90\u5e93\u4e2d\u3002",
      });

      return jsonResponse({
        error: "\u5e95\u5c42\u6587\u4ef6\u5220\u9664\u5931\u8d25\uff0c\u56fe\u7247\u5df2\u6807\u8bb0\u4e3a\u5f85\u4fee\u590d\u3002",
        imageId,
      }, 502);
    }

    await repository.deleteImage(imageId);
    return jsonResponse({ deletedImageId: imageId });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
