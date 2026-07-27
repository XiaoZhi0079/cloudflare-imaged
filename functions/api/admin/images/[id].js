import { getRepository, requireAdminKey, toAdminImage } from "../_shared.js";
import { jsonResponse } from "../../../../src/shared/http.js";

export async function onRequest({ env, request, params }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const identifier = String(params?.id ?? "").trim();
  const imageId = Number(identifier);
  const publicIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isNumericId = Number.isInteger(imageId) && imageId > 0;
  if (!isNumericId && !publicIdPattern.test(identifier)) {
    return jsonResponse({ error: "Invalid image ID" }, 400);
  }
  const repository = getRepository(env);
  const image = isNumericId
    ? await repository.getImageById(imageId)
    : await repository.getImageByPublicId(identifier);
  if (!image) {
    return jsonResponse({ error: "Image not found", code: "IMAGE_NOT_FOUND" }, 404);
  }
  return jsonResponse({ image: toAdminImage(image) });
}
