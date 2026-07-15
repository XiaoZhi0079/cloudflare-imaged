import { getRepository, toPublicImage } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env }) {
  try {
    const repository = getRepository(env);
    const settings = await repository.getSiteSettings();
    const featuredImages = await repository.listFeaturedImages();

    return jsonResponse({
      issueName: settings.issueName,
      heroCopy: settings.heroCopy,
      issueCount: featuredImages.length,
      featuredImages: featuredImages.map(toPublicImage),
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
