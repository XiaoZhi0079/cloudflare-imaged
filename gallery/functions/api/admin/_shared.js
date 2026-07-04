import { createGalleryRepository } from "../../../src/server/gallery-repository.js";
import { createImgBedClient } from "../../../src/server/imgbed-client.js";
import { jsonResponse } from "../../../src/shared/http.js";

function bindStatement(database, sql, params) {
  const statement = database.prepare(sql);

  if (typeof statement.bind === "function") {
    return statement.bind(...params);
  }

  return {
    all: async () => statement.all(...params),
  };
}

export async function allRows(database, sql, params = []) {
  const result = await bindStatement(database, sql, params).all();

  return Array.isArray(result?.results) ? result.results : result;
}

export function requireAdminKey(request, env) {
  const requestKey = request.headers.get("x-gallery-admin-key");

  if (!env.GALLERY_ADMIN_KEY || requestKey !== env.GALLERY_ADMIN_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}

export function getRepository(env) {
  return createGalleryRepository(env.GALLERY_DB);
}

export function getImgBedClient(env) {
  return createImgBedClient({
    baseUrl: env.IMGBED_BASE_URL,
    apiToken: env.IMGBED_API_TOKEN,
    fetchImpl: env.__FETCH ?? fetch,
  });
}

export function toApiTag(tag) {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    sortOrder: Number(tag.sort_order ?? tag.sortOrder ?? 0),
    isVisible: Number(tag.is_visible ?? tag.isVisible ?? 0) === 1,
  };
}

export function toApiImage(image) {
  return {
    id: image.id,
    fileName: image.fileName,
    fileUrl: image.fileUrl,
    width: image.width,
    height: image.height,
    tags: image.tags ?? [],
  };
}

export function toAdminImage(image) {
  return {
    ...toApiImage(image),
    syncStatus: image.syncStatus ?? "ok",
    note: image.note ?? null,
  };
}
