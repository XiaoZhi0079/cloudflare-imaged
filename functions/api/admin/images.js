import { getGalleryStorage, getRepository, requireAdminKey, toAdminImage } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";
import { createImageRelocationService } from "../../../src/server/image-relocation.js";

function errorDetails(error) {
  return {
    name: String(error?.name ?? "Error").slice(0, 80),
    code: String(error?.code ?? "UNKNOWN").slice(0, 80),
    message: String(error?.message ?? "unknown error").replace(/\s+/g, " ").slice(0, 240),
  };
}

function logImageMutationError(details) {
  console.error(JSON.stringify({
    level: "error",
    service: "gallery-image-mutation",
    ...details,
    error: errorDetails(details.error),
    rollbackError: details.rollbackError ? errorDetails(details.rollbackError) : undefined,
  }));
}

function relocationResponse(error, imageId) {
  const code = String(error?.code ?? "IMAGE_RELOCATION_FAILED");
  const status = code === "INVALID_FILE_NAME" || code === "INVALID_DIRECTORY"
    ? 400
    : code === "TARGET_OBJECT_EXISTS" || code === "SOURCE_OBJECT_NOT_FOUND" || code === "RELOCATION_STATE_AMBIGUOUS"
      ? 409
      : code === "PENDING_STATE_FAILED" || error?.repairRequired
        ? 503
        : 502;
  const message = code === "TARGET_OBJECT_EXISTS"
    ? "目标文件名已存在，请换一个名称。"
    : code === "SOURCE_OBJECT_NOT_FOUND" || code === "RELOCATION_STATE_AMBIGUOUS"
      ? "R2 对象状态与系统记录不一致，请先执行资源库对账。"
    : code === "INVALID_FILE_NAME"
      ? "文件名包含不支持的字符。"
      : code === "INVALID_DIRECTORY"
        ? "目录名称无效。"
        : error?.repairRequired
          ? "文件已移动但元数据修复失败，请先执行资源库对账。"
          : "底层文件操作失败，系统已保留同步状态。";
  return jsonResponse({
    error: message,
    code,
    imageId,
    repairRequired: Boolean(error?.repairRequired),
  }, status);
}

async function handleRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  const repository = getRepository(env);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const paginated = ["query", "file_name", "limit", "offset"].some((name) => url.searchParams.has(name));
    if (paginated) {
      if (url.searchParams.has("query") && url.searchParams.has("file_name")) {
        return jsonResponse({ error: "query and file_name cannot be combined" }, 400);
      }
      const query = url.searchParams.get("query") ?? "";
      const fileNameQuery = url.searchParams.has("file_name") ? url.searchParams.get("file_name") ?? "" : null;
      if (query.length > 200 || (fileNameQuery !== null && fileNameQuery.length > 200)) {
        return jsonResponse({ error: "search text must not exceed 200 characters" }, 400);
      }
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50;
      const offset = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return jsonResponse({ error: "limit must be an integer between 1 and 100" }, 400);
      }
      if (!Number.isInteger(offset) || offset < 0) {
        return jsonResponse({ error: "offset must be a non-negative integer" }, 400);
      }
      const page = await repository.listImagesPage({
        query,
        fileNameQuery,
        limit,
        offset,
      });
      return jsonResponse({
        ...page,
        images: page.images.map(toAdminImage),
      });
    }

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

    const storage = getGalleryStorage(env, request);
    const relocation = createImageRelocationService({
      repository,
      storage,
      onError: logImageMutationError,
    });

    if (nextDirectory) {
      try {
        const updated = await relocation.move(image, nextDirectory);

        return jsonResponse({ image: toAdminImage(updated) });
      } catch (error) {
        logImageMutationError({ event: "image_move_failed", imageId, error });
        return relocationResponse(error, imageId);
      }
    }

    try {
      const updated = await relocation.rename(image, nextFileName);

      return jsonResponse({ image: toAdminImage(updated) });
    } catch (error) {
      logImageMutationError({ event: "image_rename_failed", imageId, error });
      return relocationResponse(error, imageId);
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

    const storage = getGalleryStorage(env, request);

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

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    const requestId = context.request.headers.get("cf-ray") ?? crypto.randomUUID();
    const isRead = context.request.method === "GET";
    console.error(JSON.stringify({
      level: "error",
      service: "gallery-admin-images",
      event: isRead ? "image_list_failed" : "image_request_failed",
      requestId,
      error: errorDetails(error),
    }));
    return jsonResponse({
      error: isRead ? "图片库加载失败，请稍后重试。" : "图片库操作失败，请稍后重试。",
      code: isRead ? "ADMIN_IMAGES_READ_FAILED" : "ADMIN_IMAGES_REQUEST_FAILED",
      requestId,
    }, 500);
  }
}
