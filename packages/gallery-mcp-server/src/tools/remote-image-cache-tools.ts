import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { runTool } from "../response.js";
import type { ResponseFormat } from "../types.js";
import {
  RemoteImageCacheService,
  type RemoteImageBatchItem,
  type RemoteImageBatchResultDetail,
} from "../services/remote-image-cache-service.js";
import { ResponseFormatSchema } from "./tag-schemas.js";

const ImageIdentifierFields = {
  image_id: z.number().int().positive().optional().describe("Legacy numeric Gallery image ID."),
  public_id: z.string().uuid().optional().describe("Permanent public Gallery image UUID."),
};

function requireOneImageIdentifier(
  value: { image_id?: number | undefined; public_id?: string | undefined },
  context: z.core.$RefinementCtx,
): void {
  if ((value.image_id === undefined) === (value.public_id === undefined)) {
    context.addIssue({ code: "custom", message: "Provide exactly one image_id or public_id." });
  }
}

const AnalysisVersionSchema = z.string().trim().min(1).max(100).default("vision-v1")
  .describe("Version of the visual-analysis rules. Change it only when old analysis must be invalidated.");

const VisualAnalysisAuthorizationSchema = z.literal(true)
  .describe("Set to true only after the user explicitly authorized visual inspection of these private images.");

const BatchResultDetailSchema = z.enum(["summary", "actionable", "all"]).default("actionable")
  .describe("summary returns counts, actionable returns items needing work or reporting errors, and all returns every item.");

const BatchImageIdentifierSchema = z.object({
  client_item_id: z.string().trim().min(1).max(100).optional()
    .describe("Optional stable caller ID used to correlate this item with its result."),
  ...ImageIdentifierFields,
}).strict().superRefine(requireOneImageIdentifier);

function requireUniqueBatchItems(
  items: Array<{ client_item_id?: string | undefined; image_id?: number | undefined; public_id?: string | undefined }>,
  context: z.core.$RefinementCtx,
): void {
  const identifiers = new Set<string>();
  const clientItemIds = new Set<string>();
  for (const [index, item] of items.entries()) {
    const identifierKey = item.public_id ? `public:${item.public_id.toLowerCase()}` : `image:${item.image_id}`;
    if (identifiers.has(identifierKey)) {
      context.addIssue({ code: "custom", message: "Batch image identifiers must be unique.", path: [index] });
    }
    identifiers.add(identifierKey);
    if (!item.client_item_id) continue;
    if (clientItemIds.has(item.client_item_id)) {
      context.addIssue({ code: "custom", message: "client_item_id values must be unique.", path: [index, "client_item_id"] });
    }
    clientItemIds.add(item.client_item_id);
  }
}

function identifier(imageId: number | undefined, publicId: string | undefined): number | string {
  return publicId ?? imageId!;
}

function batchItems(
  items: Array<{ client_item_id?: string | undefined; image_id?: number | undefined; public_id?: string | undefined }>,
): RemoteImageBatchItem[] {
  return items.map((item) => ({
    clientItemId: item.client_item_id ?? (item.public_id ? `public:${item.public_id}` : `image:${item.image_id}`),
    identifier: identifier(item.image_id, item.public_id),
  }));
}

export function registerRemoteImageCacheTools(server: McpServer, service: RemoteImageCacheService): void {
  server.registerTool(
    "gallery_cache_remote_image",
    {
      title: "Cache One Remote Gallery Image",
      description: "Download one ONLINE Gallery image into a persistent content-addressed local cache after the user explicitly authorizes visual inspection. The image record is keyed by permanent public_id and bytes are keyed by full SHA-256, so renames do not cause repeat work and identical content is stored once. This never uploads or changes Gallery data and does not mark the image analyzed.",
      inputSchema: z.object({
        ...ImageIdentifierFields,
        analysis_version: AnalysisVersionSchema,
        force_refresh: z.boolean().default(false)
          .describe("Download again even when a verified local content object already exists."),
        user_confirmed_visual_analysis: VisualAnalysisAuthorizationSchema,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict().superRefine(requireOneImageIdentifier),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ image_id, public_id, analysis_version, force_refresh, user_confirmed_visual_analysis, response_format }) => runTool(
      response_format as ResponseFormat,
      async () => await service.cache(
        identifier(image_id, public_id),
        analysis_version,
        force_refresh,
        user_confirmed_visual_analysis,
      ),
    ),
  );

  server.registerTool(
    "gallery_cache_remote_images",
    {
      title: "Cache Remote Gallery Images in a Bounded Batch",
      description: "Cache up to 50 ONLINE Gallery originals with bounded concurrency after the user explicitly authorizes visual inspection. Each item is isolated, output defaults to actionable items, and no Gallery data is modified.",
      inputSchema: z.object({
        images: z.array(BatchImageIdentifierSchema).min(1).max(50).superRefine(requireUniqueBatchItems)
          .describe("Unique Gallery images to cache."),
        analysis_version: AnalysisVersionSchema,
        force_refresh: z.boolean().default(false)
          .describe("Download every item again even when verified content is already cached."),
        continue_on_error: z.boolean().default(true)
          .describe("Continue unrelated items after one item fails."),
        result_detail: BatchResultDetailSchema,
        user_confirmed_visual_analysis: VisualAnalysisAuthorizationSchema,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({
      images,
      analysis_version,
      force_refresh,
      continue_on_error,
      result_detail,
      user_confirmed_visual_analysis,
      response_format,
    }) => runTool(
      response_format as ResponseFormat,
      async () => await service.cacheBatch(
        batchItems(images),
        analysis_version,
        {
          forceRefresh: force_refresh,
          continueOnError: continue_on_error,
          resultDetail: result_detail as RemoteImageBatchResultDetail,
        },
        user_confirmed_visual_analysis,
      ),
    ),
  );

  server.registerTool(
    "gallery_get_remote_image_cache_status",
    {
      title: "Get Remote Image Cache and Analysis Status",
      description: "Check whether one ONLINE Gallery image has verified cached bytes and whether that exact SHA-256 content was already analyzed under the requested analysis_version. This does not download bytes or modify local or online state.",
      inputSchema: z.object({
        ...ImageIdentifierFields,
        analysis_version: AnalysisVersionSchema,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict().superRefine(requireOneImageIdentifier),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ image_id, public_id, analysis_version, response_format }) => runTool(
      response_format as ResponseFormat,
      async () => await service.getStatus(identifier(image_id, public_id), analysis_version),
    ),
  );

  server.registerTool(
    "gallery_get_remote_image_cache_status_batch",
    {
      title: "Get Remote Image Cache and Analysis Status in a Batch",
      description: "Check cache and analysis state for up to 100 ONLINE Gallery images with bounded concurrency. This reads metadata and verifies local hashes without downloading image bodies or changing local or online state.",
      inputSchema: z.object({
        images: z.array(BatchImageIdentifierSchema).min(1).max(100).superRefine(requireUniqueBatchItems)
          .describe("Unique Gallery images whose cache status should be checked."),
        analysis_version: AnalysisVersionSchema,
        result_detail: BatchResultDetailSchema,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ images, analysis_version, result_detail, response_format }) => runTool(
      response_format as ResponseFormat,
      async () => await service.getStatusBatch(
        batchItems(images),
        analysis_version,
        result_detail as RemoteImageBatchResultDetail,
      ),
    ),
  );

  server.registerTool(
    "gallery_mark_remote_image_analyzed",
    {
      title: "Mark Cached Remote Image Content Analyzed",
      description: "Mark exact cached SHA-256 content as visually analyzed for one analysis_version only after the user authorized inspection and an Agent inspected local_path. Repeated calls may correct or clear result_reference. The analyzed state is shared by duplicate online records with identical bytes. This writes only the local audit cache and never changes Gallery tags, names, records, or image bytes.",
      inputSchema: z.object({
        ...ImageIdentifierFields,
        content_sha256: z.string().regex(/^[0-9a-f]{64}$/)
          .describe("Exact SHA-256 returned by gallery_cache_remote_image."),
        analysis_version: AnalysisVersionSchema,
        result_reference: z.string().trim().max(2048).nullable().optional()
          .describe("Stable reference to the saved recognition proposal; omit to preserve it or pass null to clear it."),
        user_confirmed_visual_analysis: VisualAnalysisAuthorizationSchema,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict().superRefine(requireOneImageIdentifier),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ image_id, public_id, content_sha256, analysis_version, result_reference, user_confirmed_visual_analysis, response_format }) => runTool(
      response_format as ResponseFormat,
      async () => await service.markAnalyzed(
        identifier(image_id, public_id),
        content_sha256,
        analysis_version,
        result_reference,
        user_confirmed_visual_analysis,
      ),
    ),
  );
}
