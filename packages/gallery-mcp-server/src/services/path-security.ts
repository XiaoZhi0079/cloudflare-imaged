import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";

import sharp, { type Metadata } from "sharp";

import { GalleryMcpError } from "../errors.js";
import type { InspectedUploadFile, InspectedUploadFileMetadata } from "../types.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function resolveAllowedUploadPath(input: string, roots: string[]): Promise<string> {
  if (!roots.length) {
    throw new GalleryMcpError("No upload root is configured for this MCP server.", {
      code: "UPLOAD_ROOTS_NOT_CONFIGURED",
      suggestion: "Set GALLERY_UPLOAD_ROOTS to one or more local image directories.",
    });
  }
  const requested = path.resolve(input);
  let candidate: string;
  try {
    candidate = await realpath(requested);
  } catch (error) {
    throw new GalleryMcpError("The requested local file does not exist or cannot be resolved.", {
      code: "LOCAL_FILE_NOT_FOUND",
      suggestion: "Pass an existing image path under GALLERY_UPLOAD_ROOTS.",
      cause: error,
    });
  }

  for (const configuredRoot of roots) {
    try {
      const root = await realpath(configuredRoot);
      if (isInsideRoot(candidate, root)) return candidate;
    } catch {
      // A missing configured root is reported only when no valid root matches.
    }
  }

  throw new GalleryMcpError("The local file is outside the configured upload roots.", {
    code: "LOCAL_PATH_FORBIDDEN",
    suggestion: "Move the image under GALLERY_UPLOAD_ROOTS or update that environment variable.",
  });
}

export async function inspectUploadFileMetadata(
  input: string,
  roots: string[],
  maxFileBytes: number,
): Promise<InspectedUploadFileMetadata> {
  const absolutePath = await resolveAllowedUploadPath(input, roots);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new GalleryMcpError("The upload path is not a regular file.", {
      code: "LOCAL_PATH_NOT_FILE",
    });
  }
  if (fileStat.size <= 0 || fileStat.size > maxFileBytes) {
    throw new GalleryMcpError(`Image size must be between 1 byte and ${maxFileBytes} bytes.`, {
      code: "LOCAL_FILE_SIZE_INVALID",
      suggestion: "Choose a smaller image or increase GALLERY_MAX_FILE_BYTES.",
    });
  }

  const extension = path.extname(absolutePath).toLocaleLowerCase("en-US");
  const type = MIME_BY_EXTENSION[extension];
  if (!type) {
    throw new GalleryMcpError("Only AVIF, GIF, JPEG, PNG, and WebP images are supported.", {
      code: "LOCAL_FILE_TYPE_UNSUPPORTED",
    });
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(absolutePath, { failOn: "error" }).metadata();
  } catch (error) {
    throw new GalleryMcpError("The selected file is not a readable image.", {
      code: "LOCAL_IMAGE_INVALID",
      suggestion: "Verify the file opens normally before uploading it.",
      cause: error,
    });
  }
  const width = Number(metadata.width ?? 0);
  const height = Number(metadata.height ?? 0);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new GalleryMcpError("The image has no usable dimensions.", {
      code: "LOCAL_IMAGE_DIMENSIONS_INVALID",
    });
  }

  return {
    absolutePath,
    name: path.basename(absolutePath),
    type,
    size: fileStat.size,
    width,
    height,
    contentSha256: await hashFileSha256(absolutePath),
  };
}

export async function inspectUploadFile(
  input: string,
  roots: string[],
  maxFileBytes: number,
): Promise<InspectedUploadFile> {
  const metadata = await inspectUploadFileMetadata(input, roots, maxFileBytes);
  return {
    ...metadata,
    bytes: await readFile(metadata.absolutePath),
  };
}
