import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { GalleryMcpError, toToolError } from "../errors.js";
import { runTool } from "../response.js";
import type { GalleryMcpConfig, ResponseFormat, UploadManifestItem } from "../types.js";
import { GalleryApiClient } from "../services/gallery-client.js";
import { processUploadManifest } from "../services/manifest-service.js";
import { inspectUploadFile } from "../services/path-security.js";
import { TaxonomyService } from "../services/taxonomy-service.js";
import { uploadOneImage } from "../services/upload-service.js";
import { internalTagSelections, ResponseFormatSchema, TagSelectionsSchema } from "./tag-schemas.js";

const ManifestItemSchema = z.object({
  client_item_id: z.string().trim().min(1).max(100)
    .describe("Caller-defined stable ID used to correlate this item with the result."),
  local_path: z.string().trim().min(1).max(2048)
    .describe("Local image path under GALLERY_UPLOAD_ROOTS."),
  directory_id: z.number().int().positive()
    .describe("Upload directory ID for this image."),
  tag_selections: TagSelectionsSchema,
}).strict();
const ManifestItems = z.array(ManifestItemSchema).min(1).max(50).superRefine((items, context) => {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.client_item_id)) {
      context.addIssue({
        code: "custom",
        message: "client_item_id must be unique within a manifest.",
        path: [index, "client_item_id"],
      });
    }
    seen.add(item.client_item_id);
  }
});

interface ImageToolDependencies {
  api: GalleryApiClient;
  taxonomy: TaxonomyService;
  config: GalleryMcpConfig;
}

const ImageIdentifierFields = {
  image_id: z.number().int().positive().optional().describe("Internal numeric Gallery image ID."),
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

export function registerImageTools(server: McpServer, dependencies: ImageToolDependencies): void {
  const { api, taxonomy, config } = dependencies;

  server.registerTool(
    "gallery_health_check",
    {
      title: "Check Gallery MCP Connection",
      description: "Verify the configured Gallery API key, D1-backed taxonomy, and local-root configuration without uploading a file.",
      inputSchema: z.object({
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ response_format }) => runTool(response_format as ResponseFormat, async () => {
      const current = await taxonomy.get();
      return {
        connected: true,
        base_url: config.baseUrl,
        tag_group_count: current.tagGroups.length,
        tag_count: current.tags.length,
        directory_count: current.categories.length,
        local_roots_configured: config.uploadRoots.length > 0,
        upload_roots_configured: config.uploadRoots.length > 0,
      };
    }),
  );

  server.registerTool(
    "gallery_list_images",
    {
      title: "List Gallery Images",
      description: "List one server-side page of admin-visible Gallery image metadata, optionally filtering by filename, directory, or tag.",
      inputSchema: z.object({
        query: z.string().trim().max(200).default("").describe("Optional filename or tag search."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum results."),
        offset: z.number().int().min(0).default(0).describe("Number of matching results to skip."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, limit, offset, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const page = await api.listImagesPage(query, limit, offset);
      return {
        total_count: page.totalCount,
        count: page.count,
        offset: page.offset,
        limit: page.limit,
        has_more: page.hasMore,
        next_offset: page.nextOffset,
        images: page.images,
      };
    }),
  );

  server.registerTool(
    "gallery_get_image",
    {
      title: "Get Gallery Image",
      description: "Get one image's metadata by permanent public_id or legacy numeric image_id. This does not download or inspect the image content.",
      inputSchema: z.object({
        ...ImageIdentifierFields,
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict().superRefine(requireOneImageIdentifier),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ image_id, public_id, response_format }) => runTool(response_format as ResponseFormat, async () => {
      return { image: await api.getImage(public_id ?? image_id!) };
    }),
  );

  server.registerTool(
    "gallery_set_remote_image_tags",
    {
      title: "Set Remote Gallery Image Tags",
      description: "Replace all child tags on one ONLINE Gallery image by permanent public_id or legacy numeric image_id. This tool never reads or writes local image sidecars.",
      inputSchema: z.object({
        ...ImageIdentifierFields,
        tag_selections: TagSelectionsSchema.describe("Complete remote replacement selection grouped by parent tag group."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict().superRefine(requireOneImageIdentifier),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ image_id, public_id, tag_selections, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const tagIds = await taxonomy.validateTagSelections(internalTagSelections(tag_selections));
      return await api.setImageTags(public_id ?? image_id!, tagIds);
    }),
  );

  server.registerTool(
    "gallery_set_remote_image_tags_batch",
    {
      title: "Set Tags on Multiple Remote Gallery Images",
      description: "Atomically replace complete tag sets on up to 100 existing ONLINE Gallery images. This tool never reads or writes local image sidecars. Use gallery_set_local_image_tags_batch for local-only files.",
      inputSchema: z.object({
        assignments: z.array(z.object({
          image_id: z.number().int().positive().describe("Gallery image ID."),
          tag_selections: TagSelectionsSchema.describe("Complete remote replacement tag selection for this image."),
        }).strict()).min(1).max(100).superRefine((assignments, context) => {
          const seen = new Set<number>();
          for (const [index, assignment] of assignments.entries()) {
            if (seen.has(assignment.image_id)) {
              context.addIssue({ code: "custom", message: "image_id must be unique.", path: [index, "image_id"] });
            }
            seen.add(assignment.image_id);
          }
        }),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ assignments, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const flattened = [];
      for (const assignment of assignments) {
        flattened.push({
          imageId: assignment.image_id,
          tagIds: await taxonomy.validateTagSelections(internalTagSelections(assignment.tag_selections)),
        });
      }
      const result = await api.setImageTagsBatch(flattened);
      return {
        updated_count: result.updatedCount,
        assignments: result.assignments.map((assignment) => ({
          image_id: assignment.imageId,
          tag_ids: assignment.tagIds,
        })),
      };
    }),
  );

  const uploadInput = z.object({
    local_path: z.string().trim().min(1).max(2048).describe("Absolute or relative local image path under GALLERY_UPLOAD_ROOTS."),
    directory_id: z.number().int().positive().describe("Upload directory ID from gallery_get_taxonomy directories."),
    tag_selections: TagSelectionsSchema,
    retry_upload_id: z.string().uuid().optional().describe("Reuse only the upload_id returned after an interrupted R2 PUT."),
    operation_id: z.string().uuid().optional().describe("Optional caller operation ID for correlated logs."),
    response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
  }).strict();

  server.registerTool(
    "gallery_upload_image",
    {
      title: "Upload One Gallery Image",
      description: "CREATE A NEW ONLINE GALLERY RECORD by uploading one local image to R2 and completing D1 metadata. Do not use this for local-only labeling; use gallery_set_local_image_tags instead.",
      inputSchema: uploadInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ local_path, directory_id, tag_selections, retry_upload_id, operation_id, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const selections = internalTagSelections(tag_selections);
      const tagIds = await taxonomy.validateUploadSelection(directory_id, selections);
      const file = await inspectUploadFile(local_path, config.uploadRoots, config.maxFileBytes);
      const result = await uploadOneImage(api, file, {
        directoryId: directory_id,
        tagIds,
        tagSelections: selections,
      }, {
        ...(retry_upload_id ? { uploadId: retry_upload_id } : {}),
        ...(operation_id ? { operationId: operation_id } : {}),
      });
      return {
        uploaded: true,
        local_file_name: file.name,
        storage_key: result.storageKey,
        upload_id: result.uploadId,
        operation_id: result.operationId,
        image: result.image,
      };
    }),
  );

  server.registerTool(
    "gallery_upload_images",
    {
      title: "Upload Multiple Gallery Images",
      description: "CREATE NEW ONLINE GALLERY RECORDS by uploading up to 12 local images. Do not use this for local-only labeling; use gallery_set_local_image_tags_batch instead.",
      inputSchema: z.object({
        local_paths: z.array(z.string().trim().min(1).max(2048)).min(1).max(12).describe("Local image paths under GALLERY_UPLOAD_ROOTS."),
        directory_id: z.number().int().positive().describe("Upload directory ID shared by every file."),
        tag_selections: TagSelectionsSchema.describe("Grouped child tag selection shared by every file."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ local_paths, directory_id, tag_selections, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const selections = internalTagSelections(tag_selections);
      const tagIds = await taxonomy.validateUploadSelection(directory_id, selections);
      const items: Array<Record<string, unknown>> = [];
      const operationId = randomUUID();
      for (const localPath of local_paths) {
        const localFileName = path.basename(localPath);
        try {
          const file = await inspectUploadFile(localPath, config.uploadRoots, config.maxFileBytes);
          const result = await uploadOneImage(api, file, {
            directoryId: directory_id,
            tagIds,
            tagSelections: selections,
          }, { operationId, clientItemId: localFileName });
          items.push({ uploaded: true, local_file_name: localFileName, image: result.image, storage_key: result.storageKey, upload_id: result.uploadId });
        } catch (error) {
          items.push({ uploaded: false, local_file_name: localFileName, ...toToolError(error) });
        }
      }
      const successCount = items.filter((item) => item.uploaded === true).length;
      return {
        total_count: items.length,
        success_count: successCount,
        failure_count: items.length - successCount,
        operation_id: operationId,
        items,
      };
    }),
  );

  server.registerTool(
    "gallery_upload_manifest",
    {
      title: "Upload Gallery Manifest",
      description: "Validate and optionally CREATE NEW ONLINE GALLERY RECORDS for up to 50 local images. dry_run does not upload; a normal run uploads to R2 and writes D1. Never use a normal run for local-only labeling.",
      inputSchema: z.object({
        items: ManifestItems.describe("Images to validate and upload."),
        continue_on_error: z.boolean().default(true).describe("When true, continue other items after one item fails. When false, stop uploads after the first failure."),
        dry_run: z.boolean().default(false).describe("Validate every item and report dimensions without uploading."),
        result_detail: z.enum(["summary", "failures", "all"]).default("failures")
          .describe("Bound response size: summary returns counts, failures adds failed items, and all includes every item."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ items, continue_on_error, dry_run, result_detail, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const manifestItems: UploadManifestItem[] = items.map((item) => ({
        clientItemId: item.client_item_id,
        localPath: item.local_path,
        directoryId: item.directory_id,
        tagSelections: internalTagSelections(item.tag_selections),
      }));
      return await processUploadManifest(
        { api, taxonomy, config },
        manifestItems,
        { continueOnError: continue_on_error, dryRun: dry_run, resultDetail: result_detail },
      );
    }),
  );

  server.registerTool(
    "gallery_resume_upload",
    {
      title: "Resume Gallery Upload Completion",
      description: "Complete the Gallery record for a file that already reached R2. Use only the resume_parameters returned with UPLOAD_COMPLETION_REQUIRED; this tool does not upload image bytes again and preserves grouped tag selections.",
      inputSchema: z.object({
        upload_id: z.string().uuid().describe("Stable upload session ID returned by the failed upload."),
        storage_key: z.string().trim().min(1).max(1024)
          .refine((value) => !value.startsWith("/") && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== ".."), "Invalid R2 storage key."),
        file_name: z.string().trim().min(1).max(255)
          .refine((value) => path.basename(value) === value && !value.includes("\\"), "file_name must not contain a path."),
        width: z.number().int().positive().max(100000),
        height: z.number().int().positive().max(100000),
        directory_id: z.number().int().positive().describe("Upload directory ID from the original request."),
        tag_selections: TagSelectionsSchema.describe("Grouped child tag selections from the original request."),
        response_format: ResponseFormatSchema.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ upload_id, storage_key, file_name, width, height, directory_id, tag_selections, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const selections = internalTagSelections(tag_selections);
      const tagIds = await taxonomy.validateUploadSelection(directory_id, selections);
      const images = await api.completeUpload([{
        uploadId: upload_id,
        storageKey: storage_key,
        fileName: file_name,
        width,
        height,
      }], directory_id, tagIds);
      const image = images[0];
      if (!image) {
        throw new GalleryMcpError("Gallery returned no image after resuming upload completion.", {
          code: "UPLOAD_RECORD_MISSING",
          retryable: true,
        });
      }
      return { completed: true, image };
    }),
  );
}
