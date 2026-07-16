import { getRepository, requireAdminKey, toApiAlbum } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";

function statusFor(error) {
  const message = String(error?.message ?? error);
  if (/unique constraint/i.test(message)) return 409;
  if (/required|must|unknown|duplicates|cover image/i.test(message)) return 400;
  return 500;
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  const repository = getRepository(env);

  try {
    if (request.method === "GET") {
      return jsonResponse({ albums: (await repository.listAlbums()).map(toApiAlbum) });
    }
    const body = await parseRequestJson(request);
    if (request.method === "POST") {
      const album = await repository.createAlbum(body ?? {});
      return jsonResponse({ album: toApiAlbum(album) }, 201);
    }
    if (!Number.isInteger(body?.id) || body.id <= 0) {
      return jsonResponse({ error: "Album id is required" }, 400);
    }
    if (request.method === "PATCH") {
      const album = await repository.updateAlbum(body.id, body);
      return album
        ? jsonResponse({ album: toApiAlbum(album) })
        : jsonResponse({ error: "Album not found" }, 404);
    }
    if (request.method === "DELETE") {
      const deleted = await repository.deleteAlbum(body.id);
      return deleted
        ? jsonResponse({ deletedAlbumId: body.id })
        : jsonResponse({ error: "Album not found" }, 404);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    const status = statusFor(error);
    if (status === 500) throw error;
    return jsonResponse({ error: String(error?.message ?? error) }, status);
  }
}
