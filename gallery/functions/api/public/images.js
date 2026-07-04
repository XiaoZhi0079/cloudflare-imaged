import { getRepository, toApiImage } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const tagSlug = url.searchParams.get("tag");

  if (!tagSlug) {
    return jsonResponse({ error: "Missing tag query parameter" }, 400);
  }

  const repository = getRepository(env);
  const images = await repository.listImagesByTagSlug(tagSlug);

  return jsonResponse({
    images: images.map(toApiImage),
  });
}
