import { createGalleryRepository } from "../../../src/server/gallery-repository.js";
import { createGalleryStorage } from "../../../src/server/gallery-storage.js";
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

export function getGalleryStorage(env) {
  return createGalleryStorage({
    bucket: env.GALLERY_BUCKET,
    publicBaseUrl: env.GALLERY_PUBLIC_BASE_URL,
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

export function toApiCategory(category) {
  return {
    id: category.id,
    name: category.name,
    directorySlug: category.directory_slug ?? category.directorySlug,
    sortOrder: Number(category.sort_order ?? category.sortOrder ?? 0),
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
    ...(image.category ? { category: image.category } : {}),
  };
}

export function toAdminImage(image) {
  return {
    ...toApiImage(image),
    syncStatus: image.syncStatus ?? "ok",
    note: image.note ?? null,
  };
}
