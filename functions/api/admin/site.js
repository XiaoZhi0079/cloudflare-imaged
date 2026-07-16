import { getRepository, requireAdminKey, toApiImage } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";

async function buildSitePayload(repository) {
  const albums = await repository.listAlbums();
  const home = albums.find((album) => album.isHome) ?? null;
  const featuredImages = home?.images ?? [];

  return {
    issueName: home?.name ?? "图集",
    heroCopy: home?.description ?? "",
    issueCount: featuredImages.length,
    featuredImages: featuredImages.map(toApiImage),
    featuredImageIds: featuredImages.map((image) => image.id),
  };
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  const repository = getRepository(env);

  if (request.method === "GET") {
    return jsonResponse(await buildSitePayload(repository));
  }

  if (request.method === "PATCH") {
    const body = await parseRequestJson(request);
    const hasIssueName = Object.prototype.hasOwnProperty.call(body ?? {}, "issueName");
    const hasHeroCopy = Object.prototype.hasOwnProperty.call(body ?? {}, "heroCopy");
    const hasFeatured = Object.prototype.hasOwnProperty.call(body ?? {}, "featuredImageIds");

    if (!hasIssueName && !hasHeroCopy && !hasFeatured) {
      return jsonResponse({ error: "No site settings to update." }, 400);
    }

    try {
      await repository.updateSiteConfiguration({
        ...(hasIssueName ? { issueName: body.issueName } : {}),
        ...(hasHeroCopy ? { heroCopy: body.heroCopy } : {}),
        ...(hasFeatured ? { featuredImageIds: body.featuredImageIds } : {}),
      });
      const home = (await repository.listAlbums()).find((album) => album.isHome);
      if (home) {
        await repository.updateAlbum(home.id, {
          ...(hasIssueName ? { name: body.issueName } : {}),
          ...(hasHeroCopy ? { description: body.heroCopy } : {}),
          ...(hasFeatured ? { imageIds: body.featuredImageIds } : {}),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("required")
        || message.includes("must be")
        || message.includes("must contain")
        || message.includes("duplicates")
        || message.includes("unknown image ids")
      ) {
        return jsonResponse({ error: message }, 400);
      }
      throw error;
    }

    return jsonResponse(await buildSitePayload(repository));
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
