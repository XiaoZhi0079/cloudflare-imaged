import { getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";
import { aiErrorResponse, pageOptions } from "./_shared.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env); if (authFailure) return authFailure;
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const repository = getRepository(env);
  try {
    if (request.method === "GET") {
      const url = new URL(request.url); const options = pageOptions(url);
      const status = url.searchParams.get("status") ?? "pending";
      const candidates = await repository.listAiTagCandidates({ ...options, status });
      return jsonResponse({ requestId, candidates, ...options });
    }
    if (request.method === "PATCH") {
      const body = await parseRequestJson(request);
      const candidate = await repository.reviewAiTagCandidate(body?.candidateId, { status: body?.status });
      return candidate ? jsonResponse({ requestId, candidate }) : jsonResponse({ error: "Candidate not found", code: "AI_TAG_CANDIDATE_NOT_FOUND", requestId }, 404);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) { return aiErrorResponse(error, requestId, "AI_CANDIDATE_REQUEST_FAILED"); }
}
