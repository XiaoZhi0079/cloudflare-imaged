import { getImgBedClient, getRepository, requireAdminKey, toApiImage } from "../_shared.js";
import { jsonResponse } from "../../../../src/shared/http.js";

const ALLOWED_UPLOAD_CHANNELS = new Set(["telegram", "cfr2"]);
const ALLOWED_NAME_TYPES = new Set(["default", "origin", "index", "short"]);

function isFileLike(value) {
  return value && typeof value.name === "string" && typeof value.arrayBuffer === "function";
}

function parseJsonField(formData, fieldName, fallback) {
  const raw = formData.get(fieldName);
  if (raw === null || raw === undefined || raw === "") {
    return fallback;
  }

  return JSON.parse(String(raw));
}

function normalizeTagIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((tagId) => Number(tagId)).filter((tagId) => Number.isInteger(tagId) && tagId > 0))];
}

async function findMissingTagIds(repository, tagIds) {
  const existingTagIds = new Set(await repository.getExistingTagIds(tagIds));
  return tagIds.filter((tagId) => !existingTagIds.has(tagId));
}

function normalizeUploadChannel(value) {
  const normalized = String(value ?? "telegram").trim() || "telegram";
  return ALLOWED_UPLOAD_CHANNELS.has(normalized) ? normalized : null;
}

function normalizeUploadFolder(value) {
  return String(value ?? "gallery").trim().replace(/^\\+|\\+$/g, "").replace(/^\/+|\/+$/g, "") || "gallery";
}

function normalizeUploadNameType(value) {
  const normalized = String(value ?? "origin").trim() || "origin";
  return ALLOWED_NAME_TYPES.has(normalized) ? normalized : null;
}

function resolveUploadPolicy(env) {
  const uploadChannel = normalizeUploadChannel(env.GALLERY_UPLOAD_CHANNEL);
  if (!uploadChannel) {
    return { error: "??????????????????" };
  }

  const uploadNameType = normalizeUploadNameType(env.GALLERY_UPLOAD_NAME_TYPE);
  if (!uploadNameType) {
    return { error: "??????????????????" };
  }

  return {
    uploadChannel,
    uploadNameType,
    uploadFolder: normalizeUploadFolder(env.GALLERY_UPLOAD_FOLDER),
  };
}

function isImageFile(file) {
  return String(file?.type ?? "").startsWith("image/");
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const uploadPolicy = resolveUploadPolicy(env);
  if (uploadPolicy.error) {
    return jsonResponse({ error: uploadPolicy.error }, 500);
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter(isFileLike);
  if (files.length === 0) {
    return jsonResponse({ error: "??????????" }, 400);
  }

  if (files.some((file) => !isImageFile(file))) {
    return jsonResponse({ error: "??????????" }, 400);
  }

  const tagIds = normalizeTagIds(parseJsonField(formData, "tagIds", []));
  if (tagIds.length === 0) {
    return jsonResponse({ error: "??????????" }, 400);
  }

  const filesMeta = parseJsonField(formData, "filesMeta", []);

  const repository = getRepository(env);
  const missingTagIds = await findMissingTagIds(repository, tagIds);
  if (missingTagIds.length > 0) {
    return jsonResponse({ error: "????????????????????" }, 400);
  }

  const client = getImgBedClient(env);
  const uploadedImageIds = [];

  for (const [index, file] of files.entries()) {
    const imageMeta = Array.isArray(filesMeta) ? filesMeta[index] ?? {} : {};
    const record = await client.uploadImage({
      file,
      uploadChannel: uploadPolicy.uploadChannel,
      uploadNameType: uploadPolicy.uploadNameType,
      uploadFolder: uploadPolicy.uploadFolder,
      imageMeta: {
        width: Number(imageMeta?.width) || null,
        height: Number(imageMeta?.height) || null,
      },
    });

    const image = await repository.upsertImage(record);
    await repository.replaceImageTags(image.id, tagIds);
    uploadedImageIds.push(image.id);
  }

  const images = await repository.listImages();
  const imagesById = new Map(images.map((image) => [image.id, image]));

  return jsonResponse({
    uploadedCount: uploadedImageIds.length,
    images: uploadedImageIds
      .map((imageId) => imagesById.get(imageId))
      .filter(Boolean)
      .map(toApiImage),
  });
}
