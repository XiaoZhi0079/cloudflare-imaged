import { getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";
import { aiErrorResponse, pageOptions } from "./_shared.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env); if (authFailure) return authFailure;
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const repository = getRepository(env);
  try {
    if (request.method === "GET") {
      const options = pageOptions(new URL(request.url), { defaultLimit: 20 });
      return jsonResponse({ requestId, batches: await repository.listAiAnalysisBatches(options), ...options });
    }
    if (request.method === "POST") {
      const body = await parseRequestJson(request);
      const batch = await repository.createAiAnalysisBatch({
        id: body?.id ?? crypto.randomUUID(), name: body?.name,
        imageIds: body?.imageIds, snapshotMaxImageId: body?.snapshotMaxImageId ?? null,
        operationId: body?.operationId ?? null, source: body?.source ?? "mcp",
      });
      return jsonResponse({ requestId, batch }, 201);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) { return aiErrorResponse(error, requestId, "AI_BATCH_REQUEST_FAILED"); }
}
