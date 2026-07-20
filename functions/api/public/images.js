import { getRepository, toPublicImage } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  try {
    const url = new URL(request.url);
    const tagSlugs = url.searchParams.getAll("tag").map((slug) => slug.trim()).filter(Boolean);

    if (!tagSlugs.length) {
      return jsonResponse({ error: "Missing tag query parameter" }, 400);
    }

    const repository = getRepository(env);
    const images = await repository.listImagesByTagSlugs(tagSlugs);

    return jsonResponse({
      images: images.map(toPublicImage),
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
