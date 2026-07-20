import { getRepository, toPublicImage } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";
import { classifyFeaturedImage } from "../../../src/shared/featured-image-rules.js";

export async function onRequest({ env }) {
  try {
    const repository = getRepository(env);
    const albums = await repository.listAlbums();
    const home = albums.find((album) => album.isHome) ?? null;
    const eligibleImages = (home?.images ?? []).filter((image) => classifyFeaturedImage(image).eligible);
    const coverImageId = Number(home?.coverImageId);
    const featuredImages = eligibleImages.sort((left, right) => {
      if (Number(left.id) === coverImageId) return -1;
      if (Number(right.id) === coverImageId) return 1;
      return 0;
    });

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
