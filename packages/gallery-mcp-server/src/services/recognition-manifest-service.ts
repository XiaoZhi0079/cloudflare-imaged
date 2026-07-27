import path from "node:path";

import { GalleryMcpError, toToolError } from "../errors.js";
import type {
  GalleryImage,
  GalleryMcpConfig,
  GalleryTaxonomy,
  ManifestResultDetail,
  RecognitionManifestItem,
} from "../types.js";
import type { GalleryApiClient } from "./gallery-client.js";
import type { TaxonomyService } from "./taxonomy-service.js";

interface RecognitionManifestDependencies {
  api: GalleryApiClient;
  taxonomy: TaxonomyService;
  config: GalleryMcpConfig;
}

interface RecognitionManifestOptions {
  dryRun: boolean;
  continueOnError: boolean;
  resultDetail?: ManifestResultDetail;
  mutationConfirmed: boolean;
}

interface PreparedRecognitionItem {
  index: number;
  item: RecognitionManifestItem;
  image: GalleryImage;
  tagIds: number[];
  expectedTagNames: string[];
  changes: Array<"file_name" | "directory" | "tags">;
  appliedFields: Array<"file_name" | "directory" | "tags">;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function normalizedHash(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function sortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sortedNames(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function sameNumbers(left: number[], right: number[]): boolean {
  return JSON.stringify(sortedNumbers(left)) === JSON.stringify(sortedNumbers(right));
}

function sameNames(left: string[], right: string[]): boolean {
  return JSON.stringify(sortedNames(left)) === JSON.stringify(sortedNames(right));
}

function validateManagedFileName(nextFileName: string, currentFileName: string): void {
  if (
    !nextFileName
    || nextFileName === "."
    || nextFileName === ".."
    || path.posix.basename(nextFileName) !== nextFileName
    || path.win32.basename(nextFileName) !== nextFileName
    || /[\u0000-\u001f\u007f\s]/u.test(nextFileName)
  ) {
    throw new GalleryMcpError(`Invalid target file name '${nextFileName}'.`, {
      code: "INVALID_FILE_NAME",
      suggestion: "Use a basename without slashes, control characters, or whitespace; replace spaces with hyphens.",
    });
  }

  const currentExtension = path.extname(currentFileName).toLocaleLowerCase("en-US");
  const nextExtension = path.extname(nextFileName).toLocaleLowerCase("en-US");
  if (currentExtension !== nextExtension) {
    throw new GalleryMcpError("Recognition updates must preserve the existing file extension.", {
      code: "FILE_EXTENSION_CHANGE_FORBIDDEN",
      suggestion: `Keep the '${currentExtension || "(no extension)"}' extension because this workflow does not transcode image bytes.`,
      details: { current_file_name: currentFileName, requested_file_name: nextFileName },
    });
  }
}

function expectedTagNames(tagIds: number[], taxonomy: GalleryTaxonomy): string[] {
  const tagsById = new Map(taxonomy.tags.map((tag) => [tag.id, tag.name]));
  return sortedNames(tagIds.map((id) => tagsById.get(id)).filter((name): name is string => name !== undefined));
}

function changesFor(image: GalleryImage, item: RecognitionManifestItem, tagIds: number[], taxonomy: GalleryTaxonomy): PreparedRecognitionItem["changes"] {
  const changes: PreparedRecognitionItem["changes"] = [];
  if (image.fileName !== item.fileName) changes.push("file_name");
  if (Number(image.category?.id ?? 0) !== item.directoryId) changes.push("directory");
  if (!sameNames(image.tags, expectedTagNames(tagIds, taxonomy))) changes.push("tags");
  return changes;
}

function failedResult(entry: PreparedRecognitionItem | null, item: RecognitionManifestItem, phase: string, error: unknown) {
  const appliedFields = entry?.appliedFields ?? [];
  const toolError = toToolError(error);
  const { status: httpStatus, ...errorFields } = toolError;
  return {
    client_item_id: item.clientItemId,
    public_id: item.publicId,
    status: "failed",
    phase,
    partial_update: appliedFields.length > 0,
    applied_fields: appliedFields,
    ...errorFields,
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
  };
}

function skippedResult(entry: PreparedRecognitionItem, code: string, message: string) {
  return {
    client_item_id: entry.item.clientItemId,
    public_id: entry.item.publicId,
    status: "skipped",
    code,
    message,
    planned_changes: entry.changes,
  };
}

function successfulResult(entry: PreparedRecognitionItem, image: GalleryImage) {
  const updated = entry.changes.length > 0;
  return {
    client_item_id: entry.item.clientItemId,
    public_id: entry.item.publicId,
    image_id: image.id,
    status: updated ? "updated" : "unchanged",
    applied_fields: entry.appliedFields,
    image,
  };
}

async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item === undefined) return;
      await operation(item);
    }
  }
  const count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: count }, async () => await worker()));
}

function verifyImage(entry: PreparedRecognitionItem, image: GalleryImage): void {
  const actualHash = normalizedHash(image.contentSha256);
  const expectedHash = normalizedHash(entry.item.expectedContentSha256);
  const mismatches: Record<string, unknown> = {};
  if (image.publicId.toLocaleLowerCase("en-US") !== entry.item.publicId.toLocaleLowerCase("en-US")) {
    mismatches.public_id = image.publicId;
  }
  if (actualHash !== expectedHash) mismatches.content_sha256 = image.contentSha256 ?? null;
  if (image.fileName !== entry.item.fileName) mismatches.file_name = image.fileName;
  if (Number(image.category?.id ?? 0) !== entry.item.directoryId) mismatches.directory_id = image.category?.id ?? null;
  if (!sameNames(image.tags, entry.expectedTagNames)) mismatches.tags = image.tags;

  if (Object.keys(mismatches).length > 0) {
    throw new GalleryMcpError("Gallery metadata did not match the recognition manifest after update.", {
      code: "RECOGNITION_MANIFEST_VERIFICATION_FAILED",
      retryable: true,
      suggestion: "Read the image by public_id, resolve any R2 sync error, then safely rerun the same manifest item.",
      details: { expected_content_sha256: expectedHash, actual: mismatches },
    });
  }
}

async function applySequentially(
  dependencies: RecognitionManifestDependencies,
  entries: PreparedRecognitionItem[],
  results: Array<Record<string, unknown> | undefined>,
): Promise<void> {
  const { api } = dependencies;
  let aborted = false;
  for (const entry of entries) {
    if (aborted) {
      results[entry.index] = skippedResult(entry, "RECOGNITION_MANIFEST_ABORTED", "An earlier item failed and continue_on_error is false.");
      continue;
    }
    try {
      if (entry.changes.includes("file_name")) {
        entry.image = await api.renameImage(entry.image.id, entry.item.fileName);
        entry.appliedFields.push("file_name");
      }
      if (entry.changes.includes("directory")) {
        const moved = await api.moveImagesToCategory([entry.image.id], entry.item.directoryId);
        const failure = moved.failed.find((item) => item.imageId === entry.image.id);
        if (failure) {
          throw new GalleryMcpError(failure.error, { code: "IMAGE_DIRECTORY_UPDATE_FAILED", retryable: true });
        }
        const image = moved.images.find((item) => item.id === entry.image.id);
        if (!image) {
          throw new GalleryMcpError("Gallery omitted the moved image from its response.", {
            code: "IMAGE_DIRECTORY_UPDATE_MISSING",
            retryable: true,
          });
        }
        entry.image = image;
        entry.appliedFields.push("directory");
      }
      if (entry.changes.includes("tags")) {
        await api.setImageTags(entry.image.id, entry.tagIds);
        entry.appliedFields.push("tags");
      }
      const image = await api.getImage(entry.item.publicId);
      verifyImage(entry, image);
      results[entry.index] = successfulResult(entry, image);
    } catch (error) {
      results[entry.index] = failedResult(entry, entry.item, "mutation_or_verification", error);
      aborted = true;
    }
  }
}

async function applyInBatches(
  dependencies: RecognitionManifestDependencies,
  entries: PreparedRecognitionItem[],
  results: Array<Record<string, unknown> | undefined>,
): Promise<void> {
  const { api, config } = dependencies;
  const active = new Set(entries);
  const concurrency = config.remoteCacheConcurrency ?? 4;

  await withConcurrency(entries.filter((entry) => entry.changes.includes("file_name")), concurrency, async (entry) => {
    try {
      entry.image = await api.renameImage(entry.image.id, entry.item.fileName);
      entry.appliedFields.push("file_name");
    } catch (error) {
      active.delete(entry);
      results[entry.index] = failedResult(entry, entry.item, "rename", error);
    }
  });

  const directoryGroups = new Map<number, PreparedRecognitionItem[]>();
  for (const entry of active) {
    if (!entry.changes.includes("directory")) continue;
    const group = directoryGroups.get(entry.item.directoryId) ?? [];
    group.push(entry);
    directoryGroups.set(entry.item.directoryId, group);
  }
  for (const [directoryId, group] of directoryGroups) {
    try {
      const moved = await api.moveImagesToCategory(group.map((entry) => entry.image.id), directoryId);
      const imagesById = new Map(moved.images.map((image) => [image.id, image]));
      const failuresById = new Map(moved.failed.map((failure) => [failure.imageId, failure.error]));
      for (const entry of group) {
        const image = imagesById.get(entry.image.id);
        const failure = failuresById.get(entry.image.id);
        if (!image || failure) {
          const error = new GalleryMcpError(failure ?? "Gallery omitted the moved image from its response.", {
            code: failure ? "IMAGE_DIRECTORY_UPDATE_FAILED" : "IMAGE_DIRECTORY_UPDATE_MISSING",
            retryable: true,
          });
          active.delete(entry);
          results[entry.index] = failedResult(entry, entry.item, "directory", error);
          continue;
        }
        entry.image = image;
        entry.appliedFields.push("directory");
      }
    } catch (error) {
      for (const entry of group) {
        active.delete(entry);
        results[entry.index] = failedResult(entry, entry.item, "directory", error);
      }
    }
  }

  const tagEntries = [...active].filter((entry) => entry.changes.includes("tags"));
  if (tagEntries.length > 0) {
    try {
      const updated = await api.setImageTagsBatch(tagEntries.map((entry) => ({ imageId: entry.image.id, tagIds: entry.tagIds })));
      const assignments = new Map(updated.assignments.map((assignment) => [assignment.imageId, assignment.tagIds]));
      for (const entry of tagEntries) {
        const actual = assignments.get(entry.image.id);
        if (!actual || !sameNumbers(actual, entry.tagIds)) {
          throw new GalleryMcpError("Gallery returned an incomplete tag assignment batch.", {
            code: "IMAGE_TAG_VERIFICATION_FAILED",
            retryable: true,
          });
        }
      }
      for (const entry of tagEntries) entry.appliedFields.push("tags");
    } catch (error) {
      for (const entry of tagEntries) {
        active.delete(entry);
        results[entry.index] = failedResult(entry, entry.item, "tags", error);
      }
    }
  }

  await withConcurrency([...active], concurrency, async (entry) => {
    try {
      const image = await api.getImage(entry.item.publicId);
      verifyImage(entry, image);
      results[entry.index] = successfulResult(entry, image);
    } catch (error) {
      results[entry.index] = failedResult(entry, entry.item, "verification", error);
    }
  });
}

export async function processRecognitionManifest(
  dependencies: RecognitionManifestDependencies,
  items: RecognitionManifestItem[],
  options: RecognitionManifestOptions,
): Promise<Record<string, unknown>> {
  if (!options.dryRun && !options.mutationConfirmed) {
    throw new GalleryMcpError("Applying a recognition manifest requires explicit mutation confirmation.", {
      code: "MUTATION_CONFIRMATION_REQUIRED",
      suggestion: "Run dry_run first, review the planned changes, then pass confirm_apply='APPLY_RECOGNITION_MANIFEST'.",
    });
  }

  const { api, taxonomy, config } = dependencies;
  const snapshot = await taxonomy.get();
  const results: Array<Record<string, unknown> | undefined> = new Array(items.length);
  const prepared: PreparedRecognitionItem[] = [];
  const desiredTargets = new Map<string, RecognitionManifestItem[]>();

  for (const item of items) {
    const key = `${item.directoryId}:${item.fileName.toLocaleLowerCase("en-US")}`;
    const group = desiredTargets.get(key) ?? [];
    group.push(item);
    desiredTargets.set(key, group);
  }
  const duplicateTargets = new Set(
    [...desiredTargets.values()].filter((group) => group.length > 1).flatMap((group) => group.map((item) => item.clientItemId)),
  );

  await withConcurrency(items.map((item, index) => ({ item, index })), config.remoteCacheConcurrency ?? 4, async ({ item, index }) => {
    try {
      if (duplicateTargets.has(item.clientItemId)) {
        throw new GalleryMcpError("More than one manifest item targets the same file name and directory.", {
          code: "DUPLICATE_RECOGNITION_TARGET",
          suggestion: "Give every image a unique file_name within its target directory.",
        });
      }
      const image = await api.getImage(item.publicId);
      const actualHash = normalizedHash(image.contentSha256);
      const expectedHash = normalizedHash(item.expectedContentSha256);
      if (!actualHash) {
        throw new GalleryMcpError("The Gallery image does not have a valid full SHA-256.", {
          code: "IMAGE_CONTENT_HASH_MISSING",
          suggestion: "Run the Gallery content-hash repair before applying recognition results.",
        });
      }
      if (actualHash !== expectedHash) {
        throw new GalleryMcpError("The online image content changed after recognition.", {
          code: "IMAGE_CONTENT_CHANGED",
          status: 409,
          suggestion: "Cache and analyze the current content again; do not apply a proposal made for different bytes.",
          details: { expected_content_sha256: expectedHash, actual_content_sha256: actualHash },
        });
      }
      validateManagedFileName(item.fileName, image.fileName);
      const tagIds = await taxonomy.validateUploadSelection(item.directoryId, item.tagSelections);
      const changes = changesFor(image, item, tagIds, snapshot);
      if (changes.some((change) => change === "file_name" || change === "directory") && image.syncStatus && image.syncStatus !== "ok") {
        throw new GalleryMcpError(`Image storage is not ready for relocation (syncStatus=${image.syncStatus}).`, {
          code: "IMAGE_SYNC_STATE_NOT_READY",
          status: 409,
          suggestion: "Repair or reconcile the image storage state before renaming or moving it.",
        });
      }
      prepared.push({
        index,
        item,
        image,
        tagIds: sortedNumbers(tagIds),
        expectedTagNames: expectedTagNames(tagIds, snapshot),
        changes,
        appliedFields: [],
      });
    } catch (error) {
      results[index] = failedResult(null, item, "preflight", error);
    }
  });
  prepared.sort((left, right) => left.index - right.index);

  if (options.dryRun) {
    for (const entry of prepared) {
      results[entry.index] = {
        client_item_id: entry.item.clientItemId,
        public_id: entry.item.publicId,
        image_id: entry.image.id,
        status: entry.changes.length > 0 ? "ready" : "unchanged",
        planned_changes: entry.changes,
        current: {
          file_name: entry.image.fileName,
          directory_id: entry.image.category?.id ?? null,
          tags: sortedNames(entry.image.tags),
        },
        desired: {
          file_name: entry.item.fileName,
          directory_id: entry.item.directoryId,
          tags: entry.expectedTagNames,
        },
      };
    }
  } else if (!options.continueOnError && results.some((result) => result?.status === "failed")) {
    for (const entry of prepared) {
      results[entry.index] = skippedResult(entry, "RECOGNITION_MANIFEST_PREFLIGHT_ABORTED", "Another item failed preflight and continue_on_error is false.");
    }
  } else if (options.continueOnError) {
    await applyInBatches(dependencies, prepared, results);
  } else {
    await applySequentially(dependencies, prepared, results);
  }

  const completed = results.map((result, index) => result ?? {
    client_item_id: items[index]?.clientItemId ?? `item-${index + 1}`,
    public_id: items[index]?.publicId,
    status: "skipped",
    code: "RECOGNITION_MANIFEST_ITEM_NOT_PROCESSED",
    message: "The manifest item was not processed.",
  });
  const failures = completed.filter((result) => result.status === "failed");
  const resultDetail = options.resultDetail ?? "failures";
  return {
    dry_run: options.dryRun,
    continue_on_error: options.continueOnError,
    result_detail: resultDetail,
    total_count: completed.length,
    ready_count: completed.filter((result) => result.status === "ready").length,
    updated_count: completed.filter((result) => result.status === "updated").length,
    unchanged_count: completed.filter((result) => result.status === "unchanged").length,
    failed_count: failures.length,
    skipped_count: completed.filter((result) => result.status === "skipped").length,
    ...(resultDetail === "failures" ? { failures } : {}),
    ...(resultDetail === "all" ? { items: completed } : {}),
  };
}
