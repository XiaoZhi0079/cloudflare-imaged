import { getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse } from "../../../../src/shared/http.js";

function integerParameter(searchParams, name, { defaultValue, min, max = Number.MAX_SAFE_INTEGER }) {
  const raw = searchParams.get(name);
  if (raw === null) return defaultValue;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

async function handleRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const afterImageId = integerParameter(url.searchParams, "after_id", { defaultValue: 0, min: 0 });
  const limit = integerParameter(url.searchParams, "limit", { defaultValue: 50, min: 1, max: 100 });
  const snapshotMaxImageId = url.searchParams.has("snapshot_max_id")
    ? integerParameter(url.searchParams, "snapshot_max_id", { defaultValue: null, min: 0 })
    : null;
  if (afterImageId === null || limit === null || (url.searchParams.has("snapshot_max_id") && snapshotMaxImageId === null)) {
    return jsonResponse({
      error: "after_id and snapshot_max_id must be non-negative integers; limit must be between 1 and 100.",
      code: "INVALID_IMAGE_SCAN_CURSOR",
    }, 400);
  }
  if (snapshotMaxImageId !== null && afterImageId > snapshotMaxImageId) {
    return jsonResponse({
      error: "after_id must not exceed snapshot_max_id.",
      code: "INVALID_IMAGE_SCAN_CURSOR",
    }, 400);
  }

  const result = await getRepository(env).scanImageIds({ afterImageId, snapshotMaxImageId, limit });
  return jsonResponse(result);
}

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    const requestId = context.request.headers.get("cf-ray") ?? crypto.randomUUID();
    console.error(JSON.stringify({
      level: "error",
      service: "gallery-admin-image-scan",
      event: "image_id_scan_failed",
      requestId,
      error: {
        name: String(error?.name ?? "Error").slice(0, 80),
        message: String(error?.message ?? "unknown error").replace(/\s+/g, " ").slice(0, 240),
      },
    }));
    return jsonResponse({
      error: "图片编号扫描失败，请稍后重试。",
      code: "ADMIN_IMAGE_ID_SCAN_FAILED",
      requestId,
    }, 500);
  }
}
