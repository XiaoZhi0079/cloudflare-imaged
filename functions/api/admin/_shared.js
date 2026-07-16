import { createGalleryRepository } from "../../../src/server/gallery-repository.js";
import { createGalleryStorage, resolvePublicBaseUrl } from "../../../src/server/gallery-storage.js";
import { classifyFeaturedImage } from "../../../src/shared/featured-image-rules.js";
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

export function parseCompleteOrder(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "排序内容不能为空。" };
  }

  const items = value.map((item) => ({
    id: Number(item?.id),
    sortOrder: Number(item?.sortOrder),
  }));
  const ids = new Set(items.map((item) => item.id));
  const orders = items.map((item) => item.sortOrder).sort((left, right) => left - right);
  const valid = items.every(
    (item) => Number.isInteger(item.id)
      && item.id > 0
      && Number.isInteger(item.sortOrder)
      && item.sortOrder > 0,
  );
  const contiguous = orders.every((order, index) => order === index + 1);

  if (!valid || ids.size !== items.length || !contiguous) {
    return { error: "排序内容无效。" };
  }

  return {
    items: [...items].sort((left, right) => left.sortOrder - right.sortOrder),
  };
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

export function getGalleryStorage(env, request) {
  return createGalleryStorage({
    bucket: env.GALLERY_BUCKET,
    publicBaseUrl: resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request?.url),
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
    featuredEligibility: classifyFeaturedImage(image),
    ...(image.category ? { category: image.category } : {}),
  };
}

export function toPublicImage(image) {
  return {
    id: image.id,
    fileName: image.fileName,
    fileUrl: image.fileUrl,
    width: image.width,
    height: image.height,
    tags: image.tags ?? [],
  };
}

export function toApiAlbum(album) {
  return {
    id: album.id,
    name: album.name,
    slug: album.slug,
    description: album.description,
    coverImageId: album.coverImageId,
    coverImage: album.coverImage ? toApiImage(album.coverImage) : null,
    isHome: album.isHome,
    sortOrder: album.sortOrder,
    imageCount: album.imageCount,
    images: (album.images ?? []).map(toApiImage),
  };
}

export function toPublicAlbum(album) {
  return {
    id: album.id,
    name: album.name,
    slug: album.slug,
    description: album.description,
    isHome: album.isHome,
    imageCount: album.imageCount,
    coverImage: album.coverImage ? toPublicImage(album.coverImage) : null,
    images: (album.images ?? []).map(toPublicImage),
  };
}

export function toPublicAlbumSummary(album) {
  return {
    id: album.id,
    name: album.name,
    slug: album.slug,
    description: album.description,
    isHome: album.isHome,
    imageCount: album.imageCount,
    coverImage: album.coverImage ? toPublicImage(album.coverImage) : null,
  };
}

export function toAdminImage(image) {
  return {
    ...toApiImage(image),
    syncStatus: image.syncStatus ?? "ok",
    note: image.note ?? null,
  };
}
