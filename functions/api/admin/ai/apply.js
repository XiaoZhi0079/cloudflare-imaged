import { getGalleryStorage, getRepository, requireAdminKey, toAdminImage } from "../_shared.js";
import { resolvePublicBaseUrl } from "../../../../src/server/gallery-storage.js";
import { createAiOrganizationService } from "../../../../src/server/ai-organization.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";
import { aiErrorResponse } from "./_shared.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env); if (authFailure) return authFailure;
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const body = await parseRequestJson(request);
    const proposalIds = [...new Set((Array.isArray(body?.proposalIds) ? body.proposalIds : []).map(String))];
    if (!proposalIds.length || proposalIds.length > 20) throw Object.assign(new Error("每次请选择 1-20 条已通过提案。"), { code: "INVALID_PROPOSAL_APPLY_BATCH" });
    const repository = getRepository(env);
    const service = createAiOrganizationService({
      repository, storage: getGalleryStorage(env, request),
      publicBaseUrl: resolvePublicBaseUrl(env.GALLERY_PUBLIC_BASE_URL, request.url),
      onError: (details) => console.error(JSON.stringify({ level: "error", service: "gallery-ai-apply", requestId, proposalId: details.proposalId, imageId: details.imageId, code: details.error?.code })),
    });
    const results = [];
    for (const proposalId of proposalIds) {
      try {
        const result = await service.applyProposal(proposalId);
        results.push({ proposalId, ok: true, proposal: result.proposal, image: toAdminImage(result.image), tagIds: result.tagIds });
      } catch (error) {
        results.push({ proposalId, ok: false, code: String(error?.code ?? "AI_PROPOSAL_APPLY_FAILED"), error: String(error?.message ?? error) });
      }
    }
    const failedCount = results.filter((result) => !result.ok).length;
    return jsonResponse({ requestId, appliedCount: results.length - failedCount, failedCount, results });
  } catch (error) { return aiErrorResponse(error, requestId, "AI_PROPOSAL_APPLY_FAILED"); }
}
