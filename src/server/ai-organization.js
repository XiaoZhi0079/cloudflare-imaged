import { buildPublicUrl } from "./gallery-storage.js";
import { validateManagedFileName } from "./image-relocation.js";

export class AiProposalApplyError extends Error {
  constructor(message, { code = "AI_PROPOSAL_APPLY_FAILED", cause, repairRequired = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AiProposalApplyError";
    this.code = code;
    this.repairRequired = repairRequired;
  }
}

function targetStorageKey(proposal) {
  const fileName = validateManagedFileName(proposal.proposedFileName);
  const directory = String(proposal.proposedCategoryDirectorySlug ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!directory) throw new AiProposalApplyError("The proposed category has no storage directory.", { code: "INVALID_PROPOSAL_DIRECTORY" });
  return { fileName, storageKey: `${directory}/${fileName}` };
}

export function createAiOrganizationService({ repository, storage, publicBaseUrl, onError } = {}) {
  if (!repository || !storage || !publicBaseUrl) throw new TypeError("repository, storage, and publicBaseUrl are required");

  return {
    async applyProposal(proposalId) {
      const proposal = await repository.getAiImageProposal(proposalId);
      if (!proposal) throw new AiProposalApplyError("Proposal not found.", { code: "AI_PROPOSAL_NOT_FOUND" });
      if (proposal.status !== "approved") throw new AiProposalApplyError("Proposal must be approved first.", { code: "AI_PROPOSAL_NOT_APPROVED" });
      const target = targetStorageKey(proposal);
      const sourceKey = proposal.currentStorageKey;
      let relocated = false;
      try {
        if (target.storageKey !== sourceKey) {
          await storage.renameImage(sourceKey, target.storageKey);
          relocated = true;
        }
        const result = await repository.applyAiProposalMetadata(proposalId, {
          storageKey: target.storageKey,
          fileName: target.fileName,
          fileUrl: buildPublicUrl(publicBaseUrl, target.storageKey),
        });
        return result;
      } catch (error) {
        let rollbackError = null;
        if (relocated) {
          try {
            await storage.renameImage(target.storageKey, sourceKey);
          } catch (currentRollbackError) {
            rollbackError = currentRollbackError;
            await repository.updateImageSyncState(proposal.imageId, {
              syncStatus: "repair_required",
              note: `AI 提案应用回滚失败：${sourceKey} <-> ${target.storageKey}`,
            }).catch(() => {});
          }
        }
        const wrapped = new AiProposalApplyError("Unable to apply AI image proposal.", {
          code: rollbackError ? "AI_PROPOSAL_ROLLBACK_FAILED" : String(error?.code ?? "AI_PROPOSAL_APPLY_FAILED"),
          cause: error,
          repairRequired: Boolean(rollbackError),
        });
        await repository.failAiImageProposal(proposalId, wrapped).catch(() => {});
        onError?.({ proposalId, imageId: proposal.imageId, error: wrapped, rollbackError });
        throw wrapped;
      }
    },
  };
}
