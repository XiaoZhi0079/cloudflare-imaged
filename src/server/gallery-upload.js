const ALLOWED_NAME_TYPES = new Set(["default", "origin", "index", "short"]);

export function normalizeTagIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((tagId) => Number(tagId)).filter((tagId) => Number.isInteger(tagId) && tagId > 0))];
}

export async function findMissingTagIds(repository, tagIds) {
  const existingTagIds = new Set(await repository.getExistingTagIds(tagIds));
  return tagIds.filter((tagId) => !existingTagIds.has(tagId));
}

export function normalizeUploadFolder(value) {
  return String(value ?? "gallery").trim().replace(/^\\+|\\+$/g, "").replace(/^\/+|\/+$/g, "") || "gallery";
}

export function normalizeUploadNameType(value) {
  const normalized = String(value ?? "origin").trim() || "origin";
  return ALLOWED_NAME_TYPES.has(normalized) ? normalized : null;
}

export function resolveUploadPolicy(env) {
  const uploadNameType = normalizeUploadNameType(env.GALLERY_UPLOAD_NAME_TYPE);
  if (!uploadNameType) {
    return { error: "无效的上传文件命名策略。" };
  }

  return {
    uploadNameType,
    uploadFolder: normalizeUploadFolder(env.GALLERY_UPLOAD_FOLDER),
  };
}

export function isImageContentType(value) {
  return String(value ?? "").startsWith("image/");
}

export function normalizeImageDimension(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}
