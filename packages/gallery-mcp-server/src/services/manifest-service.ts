import { randomUUID } from "node:crypto";
import path from "node:path";

import { GalleryMcpError, toToolError } from "../errors.js";
import type {
  GalleryMcpConfig,
  InspectedUploadFile,
  InspectedUploadFileMetadata,
  ManifestResultDetail,
  UploadDescriptor,
  UploadManifestItem,
  ValidatedUploadSelection,
} from "../types.js";
import type { GalleryApiClient } from "./gallery-client.js";
import { inspectUploadFile, inspectUploadFileMetadata } from "./path-security.js";
import type { TaxonomyService } from "./taxonomy-service.js";

interface ManifestDependencies {
  api: GalleryApiClient;
  taxonomy: TaxonomyService;
  config: GalleryMcpConfig;
}

interface PreparedManifestItem {
  index: number;
  item: UploadManifestItem;
  metadata: InspectedUploadFileMetadata;
  selection: ValidatedUploadSelection;
}

interface UploadWorkItem extends PreparedManifestItem {
  uploadId: string;
  descriptor: UploadDescriptor;
}

interface UploadedWorkItem extends UploadWorkItem {
  file: InspectedUploadFile;
}

interface ManifestOptions {
  continueOnError: boolean;
  dryRun: boolean;
  resultDetail?: ManifestResultDetail;
}

function logPhase(data: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "info", service: "gallery-mcp-manifest", ...data }));
}

function skippedResult(item: UploadManifestItem, fileName: string, reason: string, message: string) {
  return {
    client_item_id: item.clientItemId,
    local_file_name: fileName,
    status: "skipped",
    code: reason,
    message,
  };
}

function failedResult(
  entry: PreparedManifestItem,
  phase: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  return {
    client_item_id: entry.item.clientItemId,
    local_file_name: entry.metadata.name,
    status: "failed",
    phase,
    ...toToolError(error),
    ...details,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function completionParameters(entry: UploadedWorkItem) {
  return {
    upload_id: entry.uploadId,
    storage_key: entry.descriptor.storageKey,
    file_name: entry.descriptor.fileName,
    width: entry.file.width,
    height: entry.file.height,
    directory_id: entry.selection.directoryId,
    tag_selections: entry.selection.tagSelections.map((selection) => ({
      group_id: selection.groupId,
      tag_ids: selection.tagIds,
    })),
  };
}

async function uploadWithConcurrency(
  api: GalleryApiClient,
  entries: UploadWorkItem[],
  concurrency: number,
  continueOnError: boolean,
  results: Array<Record<string, unknown> | undefined>,
  operationId: string,
  config: GalleryMcpConfig,
): Promise<{ uploaded: UploadedWorkItem[]; aborted: boolean }> {
  const uploaded: UploadedWorkItem[] = [];
  let cursor = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (cursor < entries.length && (!aborted || continueOnError)) {
      const entry = entries[cursor];
      cursor += 1;
      if (!entry) return;

      const startedAt = Date.now();
      try {
        const file = await inspectUploadFile(
          entry.item.localPath,
          config.uploadRoots,
          config.maxFileBytes,
        );
        await api.putObject(entry.descriptor, file.bytes);
        uploaded.push({ ...entry, file });
        logPhase({
          phase: "r2-put",
          operationId,
          uploadId: entry.uploadId,
          clientItemId: entry.item.clientItemId,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        results[entry.index] = failedResult(entry, "r2-put", error, {
          operation_id: operationId,
          upload_id: entry.uploadId,
        });
        if (!continueOnError) aborted = true;
      }
    }
  }

  const workerCount = Math.min(concurrency, entries.length);
  await Promise.all(Array.from({ length: workerCount }, async () => await worker()));

  for (let index = cursor; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    results[entry.index] = skippedResult(
      entry.item,
      entry.metadata.name,
      "MANIFEST_UPLOAD_ABORTED",
      "An earlier upload failed and continue_on_error is false.",
    );
  }
  return { uploaded, aborted };
}

export async function processUploadManifest(
  dependencies: ManifestDependencies,
  items: UploadManifestItem[],
  options: ManifestOptions,
) {
  const { api, taxonomy, config } = dependencies;
  const results: Array<Record<string, unknown> | undefined> = new Array(items.length);
  const prepared: PreparedManifestItem[] = [];
  const operationId = randomUUID();
  const resultDetail = options.resultDetail ?? "failures";

  // Validate the complete manifest before the first remote mutation. Bytes are
  // deliberately not retained during preflight, so a 50-item manifest stays bounded.
  for (const [index, item] of items.entries()) {
    const fileName = path.basename(item.localPath);
    try {
      const tagIds = await taxonomy.validateUploadSelection(item.directoryId, item.tagSelections);
      const metadata = await inspectUploadFileMetadata(item.localPath, config.uploadRoots, config.maxFileBytes);
      const selection = {
        directoryId: item.directoryId,
        tagIds,
        tagSelections: item.tagSelections,
      };
      prepared.push({ index, item, metadata, selection });
      if (options.dryRun) {
        results[index] = {
          ...skippedResult(item, metadata.name, "DRY_RUN", "Validation succeeded; dry_run prevented upload."),
          directory_id: item.directoryId,
          width: metadata.width,
          height: metadata.height,
          size: metadata.size,
        };
      }
    } catch (error) {
      results[index] = {
        client_item_id: item.clientItemId,
        local_file_name: fileName,
        status: "failed",
        phase: "validation",
        ...toToolError(error),
      };
    }
  }

  if (!options.dryRun) {
    const hasValidationFailure = results.some((result) => result?.status === "failed");
    if (hasValidationFailure && !options.continueOnError) {
      for (const entry of prepared) {
        results[entry.index] = skippedResult(
          entry.item,
          entry.metadata.name,
          "MANIFEST_VALIDATION_ABORTED",
          "Another manifest item failed validation and continue_on_error is false.",
        );
      }
    } else {
      const chunkSize = config.uploadChunkSize ?? 20;
      const concurrency = config.uploadConcurrency ?? 4;
      let uploadAborted = false;

      for (const chunk of chunks(prepared, chunkSize)) {
        if (uploadAborted) {
          for (const entry of chunk) {
            results[entry.index] = skippedResult(
              entry.item,
              entry.metadata.name,
              "MANIFEST_UPLOAD_ABORTED",
              "An earlier upload failed and continue_on_error is false.",
            );
          }
          continue;
        }

        const uploadIds = new Map(chunk.map((entry) => [entry.index, randomUUID()]));
        let descriptors: UploadDescriptor[];
        const initStartedAt = Date.now();
        try {
          descriptors = await api.initUpload(
            chunk.map((entry) => ({
              uploadId: uploadIds.get(entry.index)!,
              clientItemId: entry.item.clientItemId,
              categoryId: entry.selection.directoryId,
              tagIds: entry.selection.tagIds,
              name: entry.metadata.name,
              type: entry.metadata.type,
              size: entry.metadata.size,
              width: entry.metadata.width,
              height: entry.metadata.height,
              contentSha256: entry.metadata.contentSha256,
            })),
            null,
            null,
            { operationId, namingStrategy: "original-unique" },
          );
          logPhase({
            phase: "init",
            operationId,
            itemCount: chunk.length,
            durationMs: Date.now() - initStartedAt,
          });
        } catch (error) {
          for (const entry of chunk) {
            results[entry.index] = failedResult(entry, "init", error, {
              operation_id: operationId,
              upload_id: uploadIds.get(entry.index),
            });
          }
          uploadAborted = !options.continueOnError;
          continue;
        }

        const descriptorsById = new Map(descriptors.map((descriptor) => [descriptor.uploadId, descriptor]));
        const work: UploadWorkItem[] = [];
        for (const entry of chunk) {
          const uploadId = uploadIds.get(entry.index);
          const descriptor = uploadId ? descriptorsById.get(uploadId) : undefined;
          if (!uploadId || !descriptor) {
            const error = new GalleryMcpError("Gallery did not return every requested upload descriptor.", {
              code: "UPLOAD_DESCRIPTOR_MISSING",
              retryable: true,
              suggestion: "Retry this manifest item with a new upload operation.",
            });
            results[entry.index] = failedResult(entry, "init", error, {
              operation_id: operationId,
              ...(uploadId ? { upload_id: uploadId } : {}),
            });
            uploadAborted = !options.continueOnError;
            continue;
          }
          work.push({ ...entry, uploadId, descriptor });
        }

        if (uploadAborted && !options.continueOnError) {
          for (const entry of work) {
            results[entry.index] = skippedResult(
              entry.item,
              entry.metadata.name,
              "MANIFEST_UPLOAD_ABORTED",
              "Upload initialization was incomplete and continue_on_error is false.",
            );
          }
          continue;
        }

        const uploadResult = await uploadWithConcurrency(
          api,
          work,
          concurrency,
          options.continueOnError,
          results,
          operationId,
          config,
        );
        uploadAborted ||= uploadResult.aborted;
        if (uploadResult.uploaded.length === 0) continue;

        const completeStartedAt = Date.now();
        try {
          const images = await api.completeUpload(
            uploadResult.uploaded.map((entry) => ({
              uploadId: entry.uploadId,
              storageKey: entry.descriptor.storageKey,
              fileName: entry.descriptor.fileName,
              width: entry.file.width,
              height: entry.file.height,
            })),
            null,
            null,
          );
          if (images.length !== uploadResult.uploaded.length) {
            throw new GalleryMcpError("Gallery returned an incomplete upload completion response.", {
              code: "UPLOAD_RECORD_MISSING",
              retryable: true,
              suggestion: "Resume completion for the affected upload IDs; do not upload the image bytes again.",
            });
          }
          for (const [index, entry] of uploadResult.uploaded.entries()) {
            const image = images[index];
            if (!image) continue;
            results[entry.index] = {
              client_item_id: entry.item.clientItemId,
              local_file_name: entry.file.name,
              status: "uploaded",
              operation_id: operationId,
              upload_id: entry.uploadId,
              storage_key: entry.descriptor.storageKey,
              image,
            };
          }
          logPhase({
            phase: "complete",
            operationId,
            itemCount: images.length,
            durationMs: Date.now() - completeStartedAt,
          });
        } catch (error) {
          for (const entry of uploadResult.uploaded) {
            results[entry.index] = failedResult(entry, "complete", error, {
              operation_id: operationId,
              upload_id: entry.uploadId,
              resume_parameters: completionParameters(entry),
            });
          }
          uploadAborted = !options.continueOnError;
        }
      }
    }
  }

  const completedResults = results.map((result, index) => result ?? {
    client_item_id: items[index]?.clientItemId ?? `item-${index + 1}`,
    status: "skipped",
    code: "MANIFEST_ITEM_NOT_PROCESSED",
    message: "The manifest item was not processed.",
  });
  const failures = completedResults.filter((result) => result.status === "failed");
  return {
    operation_id: operationId,
    dry_run: options.dryRun,
    continue_on_error: options.continueOnError,
    result_detail: resultDetail,
    total_count: completedResults.length,
    uploaded_count: completedResults.filter((result) => result.status === "uploaded").length,
    failed_count: failures.length,
    skipped_count: completedResults.filter((result) => result.status === "skipped").length,
    ...(resultDetail === "failures" ? { failures } : {}),
    ...(resultDetail === "all" ? { items: completedResults } : {}),
  };
}
