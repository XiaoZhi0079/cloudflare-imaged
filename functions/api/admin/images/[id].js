import { getRepository, requireAdminKey, toAdminImage } from "../_shared.js";
import { jsonResponse } from "../../../../src/shared/http.js";

export async function onRequest({ env, request, params }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const imageId = Number(params?.id);
  if (!Number.isInteger(imageId) || imageId <= 0) {
    return jsonResponse({ error: "Invalid image ID" }, 400);
  }
  const image = await getRepository(env).getImageById(imageId);
  if (!image) {
    return jsonResponse({ error: "Image not found", code: "IMAGE_NOT_FOUND" }, 404);
  }
  return jsonResponse({ image: toAdminImage(image) });
}
