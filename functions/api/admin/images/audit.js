import { getRepository, requireAdminKey, toAdminImage } from "../_shared.js";
import { resolvePublicBaseUrl } from "../../../../src/server/gallery-storage.js";
import {
  createImageStorageAuditService,
} from "../../../../src/server/image-storage-audit.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";

function requireAuditAccess(request, env) {
  const adminFailure = requireAdminKey(request, env);
  if (!adminFailure) return null;
  const auditKey = request.headers.get("x-gallery-audit-key");
  const configuredAuditKey = String(env.GALLERY_AUDIT_KEY ?? "").trim();
  return configuredAuditKey && auditKey === configuredAuditKey
    ? null
    : adminFailure;
}

function auditErrorResponse(error) {
  const code = String(error?.code ?? "IMAGE_STORAGE_AUDIT_FAILED");
  const status = code === "IMAGE_NOT_FOUND"
    ? 404
    : code.startsWith("INVALID_")
      ? 400
      : code === "IMAGE_STORAGE_AUDIT_FAILED"
        ? 500
        : 409;
  const messages = {
    INVALID_IMAGE_ID: "图片编号无效。",
    INVALID_STORAGE_KEY: "R2 对象键无效。",
    IMAGE_NOT_FOUND: "图片记录不存在。",
    REPAIR_DIRECTORY_MISMATCH: "修复对象不在同一分类目录中。",
    REPAIR_EXTENSION_MISMATCH: "修复对象的文件扩展名不一致。",
    CURRENT_OBJECT_STILL_EXISTS: "D1 当前指向的 R2 对象仍存在，不能自动替换。",
    REPAIR_OBJECT_NOT_FOUND: "候选 R2 对象不存在。",
    REPAIR_OBJECT_ALREADY_REFERENCED: "候选 R2 对象已被其他图片记录使用。",
  };
  return jsonResponse({
    error: messages[code] ?? "资源库对账失败。",
    code,
  }, status);
}

export async function onRequest({ env, request }) {
  const authFailure = requireAuditAccess(request, env);
  if (authFailure) return authFailure;

  try {
    const repository = getRepository(env);
    const service = createImageStorageAuditService({
      repository,
      bucket: env.GALLERY_BUCKET,
      publicBaseUrl: resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request.url),
    });

    if (request.method === "GET") {
      return jsonResponse(await service.audit());
    }

    if (request.method === "POST") {
      const body = await parseRequestJson(request);
      if (body?.action !== "repair-record") {
        return jsonResponse({ error: "Unsupported audit action" }, 400);
      }
      const image = await service.repairRecord({
        imageId: body.imageId,
        storageKey: body.storageKey,
      });
      return jsonResponse({ image: toAdminImage(image) });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      service: "gallery-image-storage-audit",
      code: String(error?.code ?? "UNKNOWN").slice(0, 80),
      name: String(error?.name ?? "Error").slice(0, 80),
      message: String(error?.message ?? "unknown error").replace(/\s+/g, " ").slice(0, 240),
    }));
    return auditErrorResponse(error);
  }
}
