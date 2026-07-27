import { getRepository, requireAdminKey } from "../../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../../src/shared/http.js";

const MAX_HASH_BYTES = 64 * 1024 * 1024;

function toHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await parseRequestJson(request);
  const imageId = Number(body?.imageId);
  const expectedStorageKey = String(body?.expectedStorageKey ?? "").trim();
  const expectedFileUrl = String(body?.expectedFileUrl ?? "").trim();
  if (!Number.isInteger(imageId) || imageId <= 0 || !expectedStorageKey || !expectedFileUrl) {
    return jsonResponse({ error: "图片身份参数无效。", code: "INVALID_IMAGE_IDENTITY" }, 400);
  }

  const repository = getRepository(env);
  const image = await repository.getImageById(imageId);
  if (!image) {
    return jsonResponse({ error: "图片不存在。", code: "IMAGE_NOT_FOUND" }, 404);
  }
  if (image.storageKey !== expectedStorageKey || image.fileUrl !== expectedFileUrl) {
    return jsonResponse({ error: "图片在计算哈希前发生了移动。", code: "IMAGE_IDENTITY_CHANGED" }, 409);
  }
  if (image.contentSha256) {
    return jsonResponse({
      imageId,
      publicId: image.publicId,
      contentSha256: image.contentSha256,
      idempotent: true,
    });
  }

  const object = await env.GALLERY_BUCKET.get(image.storageKey);
  if (!object) {
    return jsonResponse({ error: "R2 原始文件不存在。", code: "IMAGE_OBJECT_MISSING" }, 409);
  }
  if (Number(object.size ?? 0) > MAX_HASH_BYTES) {
    return jsonResponse({ error: "图片过大，需使用本地流式补全。", code: "IMAGE_HASH_STREAMING_REQUIRED" }, 413);
  }

  const contentSha256 = toHex(await crypto.subtle.digest("SHA-256", await object.arrayBuffer()));
  try {
    await repository.setImageContentHashes([{
      imageId,
      expectedStorageKey,
      expectedFileUrl,
      contentSha256,
    }]);
  } catch (error) {
    if (error?.code === "IMAGE_IDENTITY_CHANGED") {
      return jsonResponse({ error: "图片在计算哈希期间发生了移动。", code: error.code, imageId }, 409);
    }
    throw error;
  }

  return jsonResponse({
    imageId,
    publicId: image.publicId,
    contentSha256,
    idempotent: false,
  });
}
