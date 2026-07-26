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

function normalizeAssignments(value) {
  if (!Array.isArray(value)) return [];
  return value.map((assignment) => ({
    imageId: Number(assignment?.imageId),
    tagIds: normalizeTagIds(assignment?.tagIds ?? []),
  }));
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
  const heterogeneous = Array.isArray(body.assignments);
  const assignments = heterogeneous
    ? normalizeAssignments(body.assignments)
    : normalizeImageIds(body.imageIds ?? []).map((imageId) => ({
        imageId,
        tagIds: normalizeTagIds(body.tagIds ?? []),
      }));

  if (!assignments.length) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }
  if (assignments.length > 100) {
    return jsonResponse({ error: "每次最多设置 100 张图片。" }, 400);
  }
  if (assignments.some((assignment) => !Number.isInteger(assignment.imageId) || assignment.imageId <= 0)) {
    return jsonResponse({ error: "存在无效图片 ID。" }, 400);
  }
  if (new Set(assignments.map((assignment) => assignment.imageId)).size !== assignments.length) {
    return jsonResponse({ error: "同一张图片不能重复出现。" }, 400);
  }

  let verified;
  try {
    verified = await repository.replaceImageTagAssignments(assignments);
  } catch (error) {
    if (error?.code === "IMAGE_NOT_FOUND") {
      return jsonResponse({ error: "存在无效图片，无法完成批量设置。", code: error.code }, 404);
    }
    if (error?.code === "TAG_NOT_FOUND") {
      return jsonResponse({ error: "存在无效标签，无法完成批量设置。", code: error.code }, 400);
    }
    if (error?.code === "IMAGE_TAG_VERIFICATION_FAILED") {
      return jsonResponse({ error: "批量标签写入校验失败。", code: error.code, imageId: error.imageId }, 500);
    }
    throw error;
  }

  if (heterogeneous) {
    return jsonResponse({
      updatedCount: verified.length,
      assignments: verified,
    });
  }

  const imageIds = verified.map((assignment) => assignment.imageId);
  const tagIds = verified[0]?.tagIds ?? [];

  return jsonResponse({
    updatedCount: imageIds.length,
    imageIds,
    tagIds,
  });
}
