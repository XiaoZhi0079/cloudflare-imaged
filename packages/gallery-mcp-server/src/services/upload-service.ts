import { randomUUID } from "node:crypto";

import { GalleryMcpError } from "../errors.js";
import type { GalleryApiClient } from "./gallery-client.js";
import type { InspectedUploadFile, UploadImageResult, ValidatedUploadSelection } from "../types.js";

interface UploadOperationContext {
  operationId?: string;
  clientItemId?: string;
  uploadId?: string;
}

function logPhase(data: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "info", service: "gallery-mcp-upload", ...data }));
}

export async function uploadOneImage(
  api: GalleryApiClient,
  file: InspectedUploadFile,
  selection: ValidatedUploadSelection,
  context: UploadOperationContext = {},
): Promise<UploadImageResult> {
  const operationId = context.operationId ?? randomUUID();
  const uploadId = context.uploadId ?? randomUUID();
  const startedAt = Date.now();
  const draft = {
    uploadId,
    name: file.name,
    type: file.type,
    size: file.size,
    width: file.width,
    height: file.height,
    ...(context.clientItemId ? { clientItemId: context.clientItemId } : {}),
  };
  const uploads = await api.initUpload([draft], selection.directoryId, selection.tagIds, {
    operationId,
    namingStrategy: "original-unique",
  });
  const descriptor = uploads[0];
  if (!descriptor) {
    throw new GalleryMcpError("Gallery did not return an upload descriptor.", {
      code: "UPLOAD_DESCRIPTOR_MISSING",
      suggestion: "Retry the upload or inspect the Gallery API response.",
    });
  }

  logPhase({ phase: "init", operationId, uploadId, clientItemId: context.clientItemId, durationMs: Date.now() - startedAt });
  const putStartedAt = Date.now();
  try {
    await api.putObject(descriptor, file.bytes);
  } catch (error) {
    throw new GalleryMcpError("The Gallery upload session exists, but the R2 PUT did not complete.", {
      code: "UPLOAD_PUT_RETRY_REQUIRED",
      retryable: true,
      suggestion: "Retry the same upload tool with retry_upload_id set to the returned upload_id.",
      details: {
        retry_parameters: {
          upload_id: descriptor.uploadId,
          operation_id: descriptor.operationId,
        },
      },
      cause: error,
    });
  }
  logPhase({ phase: "r2-put", operationId, uploadId, clientItemId: context.clientItemId, durationMs: Date.now() - putStartedAt });
  let images;
  const completeStartedAt = Date.now();
  try {
    images = await api.completeUpload([{
      uploadId: descriptor.uploadId,
      storageKey: descriptor.storageKey,
      fileName: descriptor.fileName,
      width: file.width,
      height: file.height,
    }], selection.directoryId, selection.tagIds);
  } catch (error) {
    throw new GalleryMcpError("The image reached R2, but its Gallery record could not be completed.", {
      code: "UPLOAD_COMPLETION_REQUIRED",
      retryable: true,
      suggestion: "Call gallery_resume_upload with the returned resume_parameters. Do not upload the file again.",
      details: {
        resume_parameters: {
          upload_id: descriptor.uploadId,
          storage_key: descriptor.storageKey,
          file_name: descriptor.fileName,
          width: file.width,
          height: file.height,
          directory_id: selection.directoryId,
          tag_selections: selection.tagSelections.map((item) => ({
            group_id: item.groupId,
            tag_ids: item.tagIds,
          })),
        },
      },
      cause: error,
    });
  }
  const image = images[0];
  if (!image) {
    throw new GalleryMcpError("The file reached R2 but Gallery returned no saved image record.", {
      code: "UPLOAD_RECORD_MISSING",
      retryable: true,
      suggestion: "Retry the completion step before starting a new upload.",
    });
  }
  logPhase({
    phase: "complete",
    operationId,
    uploadId,
    clientItemId: context.clientItemId,
    imageId: image.id,
    expectedTagCount: selection.tagIds.length,
    actualTagCount: image.tags.length,
    durationMs: Date.now() - completeStartedAt,
  });
  return {
    image,
    localFileName: file.name,
    storageKey: descriptor.storageKey,
    uploadId,
    operationId,
  };
}
