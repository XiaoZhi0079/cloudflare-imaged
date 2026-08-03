import { jsonResponse } from "../../../../src/shared/http.js";

export function aiErrorResponse(error, requestId, fallbackCode = "AI_WORKFLOW_FAILED") {
  const code = String(error?.code ?? fallbackCode);
  const status = code.endsWith("NOT_FOUND") || code === "IMAGE_NOT_FOUND" ? 404
    : code.includes("CONFLICT") || code.includes("NOT_APPROVED") || code.includes("UNRESOLVED") ? 409
      : code.startsWith("INVALID") || code.includes("TOO_MANY") ? 400 : 500;
  console.error(JSON.stringify({
    level: "error", service: "gallery-ai-workflow", requestId, code,
    message: String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240),
  }));
  return jsonResponse({
    error: status >= 500 ? "AI 整理操作失败，请稍后重试。" : String(error?.message ?? "请求无法完成。"),
    code, requestId,
    ...(error?.missingImageIds ? { missingImageIds: error.missingImageIds } : {}),
    ...(error?.candidateIds ? { candidateIds: error.candidateIds } : {}),
  }, status);
}

export function pageOptions(url, { defaultLimit = 50 } = {}) {
  const limit = Number(url.searchParams.get("limit") ?? defaultLimit);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error("limit/offset 参数无效。"), { code: "INVALID_PAGINATION" });
  }
  return { limit, offset };
}
