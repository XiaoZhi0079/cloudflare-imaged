import { getRepository, requireAdminKey } from "../../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../../src/shared/http.js";

function normalizeTagIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((tagId) => Number(tagId)).filter((tagId) => Number.isInteger(tagId) && tagId > 0))];
}

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
  const imageIds = normalizeImageIds(body.imageIds ?? []);
  const tagIds = normalizeTagIds(body.tagIds ?? []);

  if (!imageIds.length) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }

  const existingTagIds = new Set(await repository.getExistingTagIds(tagIds));
  const missingTagIds = tagIds.filter((tagId) => !existingTagIds.has(tagId));
  if (missingTagIds.length > 0) {
    return jsonResponse({ error: "存在无效标签，无法完成批量设置。" }, 400);
  }

  const images = await Promise.all(imageIds.map((imageId) => repository.getImageById(imageId)));
  if (images.some((image) => !image)) {
    return jsonResponse({ error: "存在无效图片，无法完成批量设置。" }, 400);
  }

  await repository.replaceImageTagsForImages(imageIds, tagIds);

  return jsonResponse({
    updatedCount: imageIds.length,
    imageIds,
    tagIds,
  });
}
