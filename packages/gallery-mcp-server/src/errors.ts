import type { ToolErrorOutput } from "./types.js";

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
      cause?: unknown;
    },
  ) {
    super(message, {
      code: options.code ?? `GALLERY_HTTP_${options.status}`,
      status: options.status,
      ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
      ...(options.suggestion === undefined ? {} : { suggestion: options.suggestion }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "GalleryApiError";
  }
}

function statusSuggestion(status: number): string | undefined {
  if (status === 401) return "Check GALLERY_ADMIN_KEY and restart the MCP server.";
  if (status === 404) return "Refresh Gallery data and verify that the requested ID still exists.";
  if (status === 409) return "Refresh the taxonomy and reuse the existing resource instead of creating a duplicate.";
  if (status === 429) return "Wait briefly before retrying the operation.";
  if (status >= 500) return "Retry the operation; if it still fails, inspect the Gallery deployment logs.";
  return undefined;
}

export function apiErrorFromResponse(status: number, payload: unknown): GalleryApiError {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const message = typeof record?.error === "string"
    ? record.error.slice(0, 400)
    : `Gallery API request failed with HTTP ${status}.`;
  const code = typeof record?.code === "string" ? record.code.slice(0, 100) : undefined;
  const suggestion = statusSuggestion(status);
  const retryable = status === 429 || status === 502 || status === 503 || status === 504;
  return new GalleryApiError(message, {
    status,
    ...(code ? { code } : {}),
    retryable,
    ...(suggestion === undefined ? {} : { suggestion }),
  });
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
