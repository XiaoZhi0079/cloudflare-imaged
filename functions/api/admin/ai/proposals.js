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
      if (!["all", "pending", "approved", "rejected", "applied", "failed"].includes(status)) throw Object.assign(new Error("提案状态无效。"), { code: "INVALID_PROPOSAL_STATUS" });
      const page = await repository.listAiImageProposals({ ...options, status, batchId: url.searchParams.get("batch_id") || null });
      return jsonResponse({ requestId, ...page });
    }
    const body = await parseRequestJson(request);
    if (request.method === "POST") {
      const proposal = await repository.submitAiImageProposal({
        id: body?.id ?? crypto.randomUUID(), batchId: body?.batchId, imageId: body?.imageId,
        proposedFileName: body?.proposedFileName, proposedCategoryId: body?.proposedCategoryId,
        proposedTagIds: body?.proposedTagIds, newTagCandidates: body?.newTagCandidates,
        rationale: body?.rationale, confidence: body?.confidence,
      });
      return jsonResponse({ requestId, proposal }, 201);
    }
    if (request.method === "PATCH") {
      const proposals = await repository.reviewAiImageProposals(body?.proposalIds, { status: body?.status, note: body?.note });
      return jsonResponse({ requestId, updatedCount: proposals.length, proposals });
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) { return aiErrorResponse(error, requestId, "AI_PROPOSAL_REQUEST_FAILED"); }
}
