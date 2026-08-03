import type { DuplicateImageContentDetail, DuplicateImageReference, ToolErrorOutput } from "./types.js";

export class GalleryMcpError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly suggestion: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    options: {
      code: string;
      status?: number;
      retryable?: boolean;
      suggestion?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GalleryMcpError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.suggestion = options.suggestion;
    this.details = options.details;
  }
}

export class GalleryApiError extends GalleryMcpError {
  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      retryable?: boolean;
      suggestion?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: options.code ?? `GALLERY_HTTP_${options.status}`,
      status: options.status,
      ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
      ...(options.suggestion === undefined ? {} : { suggestion: options.suggestion }),
      ...(options.details === undefined ? {} : { details: options.details }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "GalleryApiError";
  }
}

function statusSuggestion(status: number, code: string | undefined): string | undefined {
  if (code === "DUPLICATE_IMAGE_CONTENT") {
    return "Reuse the existing Gallery image or skip the duplicate item. Do not upload or resume the same content.";
  }
  if (status === 401) return "Check GALLERY_ADMIN_KEY and restart the MCP server.";
  if (status === 404) return "Refresh Gallery data and verify that the requested ID still exists.";
  if (status === 409) return "Inspect the conflict details, then reuse the existing resource or choose a new identifier.";
  if (status === 429) return "Wait briefly before retrying the operation.";
  if (status >= 500) return "Retry the operation; if it still fails, inspect the Gallery deployment logs.";
  return undefined;
}

function boundedString(value: unknown, maximumLength: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximumLength)
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function sanitizeExistingImage(value: unknown): DuplicateImageReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = positiveInteger(record.id);
  if (id === undefined) return undefined;
  const publicId = boundedString(record.publicId, 100);
  const fileName = boundedString(record.fileName, 255);
  const fileUrl = boundedString(record.fileUrl, 2048);
  return {
    id,
    ...(publicId ? { publicId } : {}),
    ...(fileName ? { fileName } : {}),
    ...(fileUrl ? { fileUrl } : {}),
  };
}

function sanitizeDuplicate(value: unknown): DuplicateImageContentDetail | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const uploadId = boundedString(record.uploadId, 100);
  const clientItemId = boundedString(record.clientItemId, 200);
  const fileName = boundedString(record.fileName, 255);
  const rawHash = boundedString(record.contentSha256, 64)?.toLowerCase();
  const contentSha256 = rawHash && /^[a-f0-9]{64}$/.test(rawHash) ? rawHash : undefined;
  const reason = boundedString(record.reason, 80);
  const existingImage = sanitizeExistingImage(record.existingImage);
  const pendingUploadId = boundedString(record.pendingUploadId, 100);
  const pendingFileName = boundedString(record.pendingFileName, 255);
  if (!uploadId && !clientItemId && !contentSha256) return undefined;
  return {
    ...(uploadId ? { uploadId } : {}),
    ...(clientItemId ? { clientItemId } : {}),
    ...(fileName ? { fileName } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
    ...(reason ? { reason } : {}),
    ...(existingImage ? { existingImage } : {}),
    ...(pendingUploadId ? { pendingUploadId } : {}),
    ...(pendingFileName ? { pendingFileName } : {}),
  };
}

function apiErrorDetails(
  record: Record<string, unknown> | null,
  code: string | undefined,
): Record<string, unknown> | undefined {
  if (!record || code !== "DUPLICATE_IMAGE_CONTENT") return undefined;
  const duplicates = Array.isArray(record.duplicates)
    ? record.duplicates.slice(0, 50).map(sanitizeDuplicate).filter((item) => item !== undefined)
    : [];
  const requestId = boundedString(record.requestId, 200);
  if (duplicates.length === 0 && !requestId) return undefined;
  return {
    ...(duplicates.length > 0 ? { duplicates } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

export function apiErrorFromResponse(status: number, payload: unknown): GalleryApiError {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const message = typeof record?.error === "string"
    ? record.error.slice(0, 400)
    : `Gallery API request failed with HTTP ${status}.`;
  const code = typeof record?.code === "string" ? record.code.slice(0, 100) : undefined;
  const suggestion = statusSuggestion(status, code);
  const details = apiErrorDetails(record, code);
  const retryable = status === 429 || status === 502 || status === 503 || status === 504;
  return new GalleryApiError(message, {
    status,
    ...(code ? { code } : {}),
    retryable,
    ...(suggestion === undefined ? {} : { suggestion }),
    ...(details === undefined ? {} : { details }),
  });
}

export function duplicateImageDetails(error: unknown): DuplicateImageContentDetail[] {
  if (!(error instanceof GalleryMcpError) || error.code !== "DUPLICATE_IMAGE_CONTENT") return [];
  const duplicates = error.details?.duplicates;
  return Array.isArray(duplicates)
    ? duplicates.filter((item): item is DuplicateImageContentDetail => Boolean(item && typeof item === "object"))
    : [];
}

export function toToolError(error: unknown): ToolErrorOutput {
  if (error instanceof GalleryMcpError) {
    return {
      error: error.message,
      code: error.code,
      ...(error.status === undefined ? {} : { status: error.status }),
      retryable: error.retryable,
      ...(error.suggestion ? { suggestion: error.suggestion } : {}),
      ...(error.details ? { details: error.details } : {}),
    };
  }

  return {
    error: "Unexpected MCP server error.",
    code: "UNEXPECTED_ERROR",
    retryable: false,
    suggestion: "Check the MCP server stderr log for the internal error.",
  };
}
