import { getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";

function normalizeTagIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((tagId) => Number(tagId)).filter((tagId) => Number.isInteger(tagId) && tagId > 0))];
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
  const imageId = Number(body?.imageId);
  if (!Number.isInteger(imageId) || imageId <= 0) {
    return jsonResponse({ error: "imageId is required" }, 400);
  }
  const tagIds = normalizeTagIds(body.tagIds ?? []);

  let assignment;
  try {
    assignment = await repository.replaceImageTags(imageId, tagIds);
  } catch (error) {
    if (error?.code === "IMAGE_NOT_FOUND") {
      return jsonResponse({ error: "Image not found", code: error.code }, 404);
    }
    if (error?.code === "TAG_NOT_FOUND") {
      return jsonResponse({ error: "存在无效标签，无法完成设置。", code: error.code }, 400);
    }
    if (error?.code === "IMAGE_TAG_VERIFICATION_FAILED") {
      return jsonResponse({ error: "图片标签写入校验失败。", code: error.code, imageId }, 500);
    }
    throw error;
  }

  return jsonResponse({
    imageId: assignment.imageId,
    tagIds: assignment.tagIds,
  });
}
