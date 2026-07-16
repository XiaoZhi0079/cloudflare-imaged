import { getRepository, toPublicAlbum } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  try {
    const repository = getRepository(env);
    const slug = new URL(request.url).searchParams.get("slug");
    if (slug) {
      const album = await repository.getAlbumBySlug(slug);
      return album
        ? jsonResponse({ album: toPublicAlbum(album) })
        : jsonResponse({ error: "Album not found" }, 404);
    }
    return jsonResponse({ albums: (await repository.listAlbums()).map(toPublicAlbum) });
  } catch (error) {
    return jsonResponse({ error: String(error?.message ?? error) }, 500);
  }
}
