import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { runTool } from "../response.js";
import type { ResponseFormat } from "../types.js";
import { GalleryApiClient } from "../services/gallery-client.js";
import { ResponseFormatSchema } from "./tag-schemas.js";

const ProposalStatus = z.enum(["all", "pending", "approved", "rejected", "applied", "failed"]);

export function registerAiOrganizationTools(server: McpServer, api: GalleryApiClient): void {
  server.registerTool(
    "gallery_create_analysis_batch",
    {
      title: "Create Gallery AI Analysis Batch",
      description: "Create a durable analysis batch for 1-100 existing numeric image IDs. Use stable gallery_scan_image_ids output, then analyze each cached image and submit one proposal per image. This does not modify image metadata.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(160).describe("Human-readable batch name."),
        image_ids: z.array(z.number().int().positive()).min(1).max(100).describe("Existing Gallery numeric image IDs."),
        snapshot_max_image_id: z.number().int().nonnegative().optional().describe("Stable scan upper bound, when this batch came from gallery_scan_image_ids."),
        operation_id: z.string().uuid().optional().describe("Optional correlation UUID; defaults to the new batch UUID."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, image_ids, snapshot_max_image_id, operation_id, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const id = randomUUID();
      const batch = await api.createAiAnalysisBatch({
        id, name, imageIds: image_ids, operationId: operation_id ?? id,
        ...(snapshot_max_image_id === undefined ? {} : { snapshotMaxImageId: snapshot_max_image_id }),
      });
      return { batch };
    }),
  );

  server.registerTool(
    "gallery_list_analysis_batches",
    {
      title: "List Gallery AI Analysis Batches",
      description: "List durable AI organization batches and their pending, proposed, and applied counts.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().nonnegative().default(0),
        response_format: ResponseFormatSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ limit, offset, response_format }) => runTool(response_format as ResponseFormat, async () => ({
      batches: await api.listAiAnalysisBatches(limit, offset), limit, offset,
    })),
  );

  server.registerTool(
    "gallery_submit_image_proposal",
    {
      title: "Submit Gallery Image Organization Proposal",
      description: "Submit one complete analysis result for an image in a batch. Gallery compares the proposed name, directory, complete existing-tag set, and missing-tag candidates with current metadata. An identical result is recorded as no_change and creates no review card; only a real difference creates or replaces a pending proposal. This tool never changes the image itself.",
      inputSchema: z.object({
        batch_id: z.string().uuid(),
        image_id: z.number().int().positive(),
        proposed_file_name: z.string().trim().min(1).max(255).describe("Desired basename with the original extension and no directory path."),
        proposed_directory_id: z.number().int().positive().describe("Existing directory ID from gallery_get_taxonomy."),
        proposed_tag_ids: z.array(z.number().int().positive()).max(100).default([]).describe("Complete set of existing child-tag IDs for the image."),
        new_tag_candidates: z.array(z.object({
          name: z.string().trim().min(1).max(80),
          group_id: z.number().int().positive().describe("Recommended existing parent tag-group ID."),
        }).strict()).max(20).default([]),
        rationale: z.string().trim().max(2000).default(""),
        confidence: z.number().min(0).max(1).optional(),
        response_format: ResponseFormatSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ batch_id, image_id, proposed_file_name, proposed_directory_id, proposed_tag_ids, new_tag_candidates, rationale, confidence, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const result = await api.submitAiImageProposal({
        id: randomUUID(), batchId: batch_id, imageId: image_id,
        proposedFileName: proposed_file_name, proposedCategoryId: proposed_directory_id,
        proposedTagIds: proposed_tag_ids,
        newTagCandidates: new_tag_candidates.map((candidate) => ({ name: candidate.name, groupId: candidate.group_id })),
        rationale, ...(confidence === undefined ? {} : { confidence }),
      });
      return {
        ...result,
        next_step: result.outcome === "no_change"
          ? "No review is needed for this image. Continue with the next analysis item."
          : "Review new tag candidates and this proposal in /admin/ai.html. Applying is blocked until every referenced candidate is resolved.",
      };
    }),
  );

  server.registerTool(
    "gallery_list_image_proposals",
    {
      title: "List Gallery Image Organization Proposals",
      description: "List a concise server-side page of AI image proposals, optionally scoped to one analysis batch and workflow status.",
      inputSchema: z.object({
        status: ProposalStatus.default("pending"), batch_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().nonnegative().default(0),
        response_format: ResponseFormatSchema,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ status, batch_id, limit, offset, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const page = await api.listAiImageProposals(status, batch_id ?? null, limit, offset);
      return {
        total_count: page.totalCount, count: page.count, limit, offset,
        has_more: page.hasMore, next_offset: page.nextOffset, proposals: page.proposals,
      };
    }),
  );

  server.registerTool(
    "gallery_apply_approved_proposals",
    {
      title: "Apply Approved Gallery Image Proposals",
      description: "Apply 1-20 proposals that a human already approved in Gallery Admin. Each image keeps its numeric ID, public UUID, content SHA-256, and bytes. Gallery relocates the R2 object when needed, atomically commits its name/directory/full tag set in D1, verifies tags, and rolls storage back on database failure. Pending proposals are rejected.",
      inputSchema: z.object({
        proposal_ids: z.array(z.string().uuid()).min(1).max(20),
        response_format: ResponseFormatSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ proposal_ids, response_format }) => runTool(response_format as ResponseFormat, async () => await api.applyApprovedAiProposals(proposal_ids)),
  );
}
