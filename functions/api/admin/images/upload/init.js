import { getRepository, requireAdminKey } from "../../_shared.js";
import {
  findMissingTagIds,
  isImageContentType,
  normalizeImageDimension,
  normalizeTagIds,
  resolveUploadPolicy,
} from "../../../../../src/server/gallery-upload.js";
import {
  buildStorageKey,
  createStoredFileName,
  resolvePublicBaseUrl,
  toImageRecord,
} from "../../../../../src/server/gallery-storage.js";
import { createPresignedPutUrl, resolveR2DirectUploadConfig } from "../../../../../src/server/r2-direct-upload.js";
import { jsonResponse } from "../../../../../src/shared/http.js";

export async function signDirectUpload(options, signer = createPresignedPutUrl) {
  try {
    return { uploadUrl: await signer(options) };
  } catch (error) {
    const name = String(error?.name || "Error").slice(0, 80);
    const message = String(error?.message || "未知运行时错误").replace(/\s+/g, " ").slice(0, 240);
    return { error: `生成 R2 直传地址失败：${name}: ${message}` };
  }
}

function normalizeFileDrafts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      name: String(item?.name ?? "").trim(),
      type: String(item?.type ?? "").trim(),
      size: Number(item?.size ?? 0),
      width: normalizeImageDimension(item?.width),
      height: normalizeImageDimension(item?.height),
    }))
    .filter((item) => item.name);
}

async function resolveSelectedCategory(repository, env, payload) {
  const categoryId = Number(payload?.categoryId);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    const category = await repository.getCategoryById(categoryId);
    if (!category) {
      return { error: "所选目录无效。" };
    }

    return { category, uploadFolder: category.directory_slug };
  }

  const uploadFolder = String(env.GALLERY_UPLOAD_FOLDER ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (uploadFolder) {
    return { category: null, uploadFolder };
  }

  return { error: "请选择一个目录。" };
}

async function handleRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const directUploadConfig = resolveR2DirectUploadConfig(env);
  if (directUploadConfig.error) {
    return jsonResponse({ error: directUploadConfig.error }, 500);
  }

  const uploadPolicy = resolveUploadPolicy(env);
  if (uploadPolicy.error) {
    return jsonResponse({ error: uploadPolicy.error }, 500);
  }

  const payload = await request.json();
  const publicBaseUrl = resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request.url);
  const files = normalizeFileDrafts(payload?.files);
  if (files.length === 0) {
    return jsonResponse({ error: "请至少选择一张图片。" }, 400);
  }

  if (files.some((file) => !isImageContentType(file.type))) {
    return jsonResponse({ error: "只能上传图片文件。" }, 400);
  }

  const tagIds = normalizeTagIds(payload?.tagIds);
  if (tagIds.length === 0) {
    return jsonResponse({ error: "请至少选择一个标签。" }, 400);
  }

  const repository = getRepository(env);
  const missingTagIds = await findMissingTagIds(repository, tagIds);
  if (missingTagIds.length > 0) {
    return jsonResponse({ error: "存在无效标签，无法完成上传。" }, 400);
  }

  const selectedCategory = await resolveSelectedCategory(repository, env, payload);
  if (selectedCategory.error) {
    return jsonResponse({ error: selectedCategory.error }, 400);
  }

  const uploads = [];
  for (const file of files) {
    const storedFileName = createStoredFileName({ name: file.name }, uploadPolicy.uploadNameType);
    const storageKey = buildStorageKey(selectedCategory.uploadFolder, storedFileName);
    const imageRecord = toImageRecord(storageKey, publicBaseUrl, {
      width: file.width,
      height: file.height,
    });
    const contentType = file.type || "application/octet-stream";
    const signedUpload = await signDirectUpload({
      ...directUploadConfig,
      key: storageKey,
      contentType,
    });
    if (signedUpload.error) {
      return jsonResponse({ error: signedUpload.error }, 500);
    }

    uploads.push({
      ...imageRecord,
      ...(selectedCategory.category
        ? {
            category: {
              id: selectedCategory.category.id,
              name: selectedCategory.category.name,
              directorySlug: selectedCategory.category.directory_slug,
              sortOrder: Number(selectedCategory.category.sort_order ?? 0),
            },
          }
        : {}),
      contentType,
      method: "PUT",
      headers: {
        "content-type": contentType,
      },
      uploadUrl: signedUpload.uploadUrl,
    });
  }

  return jsonResponse({
    uploads,
  });
}

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    const name = String(error?.name || "Error").slice(0, 80);
    const message = String(error?.message || "未知运行时错误").replace(/\s+/g, " ").slice(0, 240);
    return jsonResponse({ error: `初始化上传失败：${name}: ${message}` }, 500);
  }
}
