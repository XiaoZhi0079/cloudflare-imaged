import { getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";

function normalizeAssignments(value) {
  if (!Array.isArray(value)) return [];
  return value.map((assignment) => ({
    imageId: Number(assignment?.imageId),
    expectedStorageKey: String(assignment?.expectedStorageKey ?? "").trim(),
    expectedFileUrl: String(assignment?.expectedFileUrl ?? "").trim(),
    contentSha256: String(assignment?.contentSha256 ?? "").trim().toLowerCase(),
  }));
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const assignments = normalizeAssignments((await parseRequestJson(request))?.assignments);
  if (!assignments.length || assignments.length > 100) {
    return jsonResponse({ error: "每次需要提交 1 至 100 张图片的内容哈希。" }, 400);
  }

  try {
    const updated = await getRepository(env).setImageContentHashes(assignments);
    return jsonResponse({
      updatedCount: updated.length,
      images: updated.map(({ imageId, contentSha256 }) => ({ imageId, contentSha256 })),
    });
  } catch (error) {
    if (["INVALID_CONTENT_SHA256", "INVALID_CONTENT_HASH_ASSIGNMENT", "DUPLICATE_CONTENT_HASH_ASSIGNMENT"].includes(error?.code)) {
      return jsonResponse({ error: "内容哈希提交格式无效。", code: error.code }, 400);
    }
    if (error?.code === "IMAGE_NOT_FOUND") {
      return jsonResponse({ error: "存在已经删除的图片。", code: error.code }, 404);
    }
    if (error?.code === "IMAGE_IDENTITY_CHANGED") {
      return jsonResponse({ error: "图片在计算哈希期间发生了移动，请重新计算。", code: error.code, imageId: error.imageId }, 409);
    }
    if (error?.code === "IMAGE_HASH_VERIFICATION_FAILED") {
      return jsonResponse({ error: "内容哈希写入校验失败。", code: error.code, imageId: error.imageId }, 500);
    }
    throw error;
  }
}
