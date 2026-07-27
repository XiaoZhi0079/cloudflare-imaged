import path from "node:path";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toToolError } from "../errors.js";
import { runTool } from "../response.js";
import type { GalleryMcpConfig, ResponseFormat } from "../types.js";
import { LocalTagService } from "../services/local-tag-service.js";
import { TaxonomyService } from "../services/taxonomy-service.js";
import { internalTagSelections, ResponseFormatSchema, TagSelectionsSchema } from "./tag-schemas.js";

const LocalPathSchema = z.string().trim().min(1).max(2048)
  .describe("Local image path under GALLERY_UPLOAD_ROOTS. No image bytes are uploaded.");

interface LocalImageTagToolDependencies {
  taxonomy: TaxonomyService;
  config: GalleryMcpConfig;
}

function localTagResult(result: Awaited<ReturnType<LocalTagService["set"]>>) {
  return {
    local_only: true,
    uploaded: false,
    remote_image_updated: false,
    changed: result.changed,
    local_path: result.imagePath,
    sidecar_path: result.sidecarPath,
    tags: result.document,
  };
}

export function registerLocalImageTagTools(
  server: McpServer,
  dependencies: LocalImageTagToolDependencies,
): void {
  const service = new LocalTagService(dependencies.taxonomy, dependencies.config);

  server.registerTool(
    "gallery_get_local_image_tags",
    {
      title: "Get Local Image Tags",
      description: "Read tags from the adjacent .gallery-tags.json sidecar for one local image. This reads no online image record and never uploads or changes Gallery data.",
      inputSchema: z.object({
        local_path: LocalPathSchema,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ local_path, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const result = await service.get(local_path);
      return {
        local_only: true,
        uploaded: false,
        remote_image_updated: false,
        local_path: result.imagePath,
        sidecar_path: result.sidecarPath,
        tags: result.document,
      };
    }),
  );

  server.registerTool(
    "gallery_set_local_image_tags",
    {
      title: "Set Local Image Tags Only",
      description: "Replace tags for one local image by atomically writing an adjacent .gallery-tags.json sidecar. This tool NEVER uploads image bytes and NEVER creates or modifies an online Gallery image record. It only reads the online taxonomy to validate parent-child tag relationships.",
      inputSchema: z.object({
        local_path: LocalPathSchema,
        tag_selections: TagSelectionsSchema.describe("Complete local replacement selection grouped by parent tag group."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ local_path, tag_selections, response_format }) => runTool(response_format as ResponseFormat, async () => {
      return localTagResult(await service.set(local_path, internalTagSelections(tag_selections)));
    }),
  );

  const assignments = z.array(z.object({
    local_path: LocalPathSchema,
    tag_selections: TagSelectionsSchema.describe("Complete local replacement selection for this image."),
  }).strict()).min(1).max(100).superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = path.resolve(item.local_path).toLocaleLowerCase("en-US");
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: "local_path must be unique.", path: [index, "local_path"] });
      }
      seen.add(key);
    }
  });

  server.registerTool(
    "gallery_set_local_image_tags_batch",
    {
      title: "Set Tags on Multiple Local Images Only",
      description: "Replace local sidecar tags on up to 100 images. This tool NEVER uploads image bytes and NEVER creates or modifies online Gallery image records. Each result explicitly reports local-only scope.",
      inputSchema: z.object({
        assignments,
        continue_on_error: z.boolean().default(true)
          .describe("Continue writing unrelated local sidecars after one item fails."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ assignments: items, continue_on_error, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const results: Array<Record<string, unknown>> = [];
      for (const item of items) {
        try {
          results.push({
            success: true,
            ...localTagResult(await service.set(item.local_path, internalTagSelections(item.tag_selections))),
          });
        } catch (error) {
          results.push({ success: false, local_path: item.local_path, ...toToolError(error) });
          if (!continue_on_error) break;
        }
      }
      const successCount = results.filter((result) => result.success === true).length;
      return {
        local_only: true,
        uploaded_count: 0,
        remote_updated_count: 0,
        requested_count: items.length,
        processed_count: results.length,
        success_count: successCount,
        failure_count: results.length - successCount,
        results,
      };
    }),
  );
}

