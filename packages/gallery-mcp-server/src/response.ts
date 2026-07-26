import { toToolError } from "./errors.js";
import type { ResponseFormat } from "./types.js";

export const CHARACTER_LIMIT = 25_000;

function markdownValue(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function boundedText(value: string): string {
  if (value.length <= CHARACTER_LIMIT) return value;
  return `${value.slice(0, CHARACTER_LIMIT)}\n\n[Output truncated. Use narrower filters.]`;
}

export function toolSuccess(value: unknown, format: ResponseFormat = "json") {
  const text = format === "markdown" ? markdownValue(value) : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text" as const, text: boundedText(text) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function toolFailure(error: unknown) {
  const output = toToolError(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
  };
}

export async function runTool(
  format: ResponseFormat,
  operation: () => Promise<unknown>,
) {
  try {
    return toolSuccess(await operation(), format);
  } catch (error) {
    const output = toToolError(error);
    console.error(JSON.stringify({
      level: "error",
      service: "gallery-mcp-server",
      code: output.code,
      status: output.status,
      retryable: output.retryable,
    }));
    return toolFailure(error);
  }
}
