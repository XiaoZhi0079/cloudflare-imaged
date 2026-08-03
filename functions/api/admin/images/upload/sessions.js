import { getRepository, requireAdminKey } from "../../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../../src/shared/http.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES = new Set(["reserved", "object_uploaded", "database_commit", "failed"]);

function publicSession(session, objectPresent = null) {
  return {
    uploadId: session.id,
    operationId: session.operationId,
    clientItemId: session.clientItemId,
    publicId: session.publicId,
    contentSha256: session.contentSha256,
    fileName: session.fileName,
    storageKey: session.storageKey,
    width: session.width,
    height: session.height,
    categoryId: session.categoryId,
    tagIds: session.tagIds,
    status: session.status,
    phase: session.phase,
    errorCode: session.errorCode,
    errorMessage: session.errorMessage,
    durationMs: session.durationMs,
    imageId: session.imageId,
    objectPresent,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
  };
}

async function objectPresence(env, sessions) {
  if (typeof env.GALLERY_BUCKET?.head !== "function") return sessions.map(() => null);
  return await Promise.all(sessions.map(async (session) => {
    if (session.status === "completed") return true;
    try {
      return Boolean(await env.GALLERY_BUCKET.head(session.storageKey));
    } catch {
      return null;
    }
  }));
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const repository = getRepository(env);

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const operationId = String(url.searchParams.get("operation_id") ?? "").trim();
      const uploadIds = String(url.searchParams.get("upload_ids") ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);
      if (!operationId && !uploadIds.length) {
        return jsonResponse({ error: "operation_id or upload_ids is required", code: "UPLOAD_SESSION_QUERY_REQUIRED", requestId }, 400);
      }
      if ((operationId && !UUID_PATTERN.test(operationId)) || uploadIds.some((id) => !UUID_PATTERN.test(id))) {
        return jsonResponse({ error: "上传任务标识无效。", code: "INVALID_UPLOAD_ID", requestId }, 400);
      }
      const sessions = operationId
        ? await repository.listUploadSessionsByOperation(operationId)
        : await repository.getUploadSessionsByIds(uploadIds.slice(0, 50));
      const presence = await objectPresence(env, sessions);
      return jsonResponse({
        requestId,
        operationId: operationId || sessions[0]?.operationId || null,
        sessions: sessions.map((session, index) => publicSession(session, presence[index])),
      });
    }

    if (request.method === "PATCH") {
      const body = await parseRequestJson(request);
      const uploadIds = Array.isArray(body?.uploadIds) ? body.uploadIds.map(String) : [];
      const phase = String(body?.phase ?? "");
      if (!uploadIds.length || uploadIds.length > 50 || uploadIds.some((id) => !UUID_PATTERN.test(id)) || !PHASES.has(phase)) {
        return jsonResponse({ error: "上传状态参数无效。", code: "INVALID_UPLOAD_PHASE", requestId }, 400);
      }
      const sessions = await repository.updateUploadSessionPhase(uploadIds, {
        phase,
        errorCode: body?.errorCode ? String(body.errorCode).slice(0, 80) : null,
        errorMessage: body?.errorMessage ? String(body.errorMessage).replace(/\s+/g, " ").slice(0, 240) : null,
      });
      return jsonResponse({ requestId, sessions: sessions.map((session) => publicSession(session)) });
    }

    if (request.method === "DELETE") {
      const body = await parseRequestJson(request);
      const uploadIds = Array.isArray(body?.uploadIds) ? body.uploadIds.map(String) : [];
      if (!uploadIds.length || uploadIds.length > 50 || uploadIds.some((id) => !UUID_PATTERN.test(id))) {
        return jsonResponse({ error: "上传任务标识无效。", code: "INVALID_UPLOAD_ID", requestId }, 400);
      }
      const sessions = (await repository.getUploadSessionsByIds(uploadIds))
        .filter((session) => session.status === "pending");
      if (typeof env.GALLERY_BUCKET?.delete === "function") {
        await Promise.all(sessions.map((session) => env.GALLERY_BUCKET.delete(session.storageKey)));
      }
      const deletedCount = await repository.deletePendingUploadSessions(sessions.map((session) => session.id));
      return jsonResponse({ requestId, deletedCount, uploadIds: sessions.map((session) => session.id) });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      service: "gallery-upload-sessions",
      requestId,
      code: String(error?.code ?? "UPLOAD_SESSION_STATUS_FAILED"),
      message: String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240),
    }));
    return jsonResponse({
      error: "读取或更新上传任务失败，请稍后重试。",
      code: String(error?.code ?? "UPLOAD_SESSION_STATUS_FAILED"),
      requestId,
    }, 500);
  }
}
