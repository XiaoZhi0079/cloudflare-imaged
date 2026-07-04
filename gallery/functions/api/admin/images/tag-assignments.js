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
  const tagIds = normalizeTagIds(body.tagIds ?? []);
  const existingTagIds = new Set(await repository.getExistingTagIds(tagIds));
  const missingTagIds = tagIds.filter((tagId) => !existingTagIds.has(tagId));

  if (missingTagIds.length > 0) {
    return jsonResponse({ error: "?????????????????" }, 400);
  }

  await repository.replaceImageTags(body.imageId, tagIds);

  return jsonResponse({
    imageId: body.imageId,
    tagIds,
  });
}
