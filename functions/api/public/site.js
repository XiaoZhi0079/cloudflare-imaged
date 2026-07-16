import { getRepository, toPublicImage } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";
import { classifyFeaturedImage } from "../../../src/shared/featured-image-rules.js";

export async function onRequest({ env }) {
  try {
    const repository = getRepository(env);
    const albums = await repository.listAlbums();
    const home = albums.find((album) => album.isHome) ?? null;
    const featuredImages = (home?.images ?? []).filter((image) => classifyFeaturedImage(image).eligible);

    return jsonResponse({
      issueName: home?.name ?? "图集",
      heroCopy: home?.description ?? "",
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
