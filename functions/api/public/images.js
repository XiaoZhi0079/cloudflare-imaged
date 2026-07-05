import { getRepository, toApiImage } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  try {
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
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}