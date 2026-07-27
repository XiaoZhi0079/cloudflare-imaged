import path from "node:path";
import { readFileSync } from "node:fs";
import os from "node:os";

import { GalleryMcpError } from "./errors.js";
import type { GalleryMcpConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://gallery.140079.xyz";

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new GalleryMcpError(`${name} must be a positive integer.`, {
      code: "INVALID_CONFIGURATION",
    });
  }
  return parsed;
}

function boundedInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const parsed = positiveInteger(value, fallback, name);
  if (parsed < minimum || parsed > maximum) {
    throw new GalleryMcpError(`${name} must be between ${minimum} and ${maximum}.`, {
      code: "INVALID_CONFIGURATION",
    });
  }
  return parsed;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new GalleryMcpError("GALLERY_BASE_URL must be a valid absolute URL.", {
      code: "INVALID_CONFIGURATION",
      cause: error,
    });
  }

  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new GalleryMcpError("GALLERY_BASE_URL must use HTTPS, except for localhost development.", {
      code: "INVALID_CONFIGURATION",
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new GalleryMcpError("GALLERY_BASE_URL cannot contain credentials, query parameters, or fragments.", {
      code: "INVALID_CONFIGURATION",
    });
  }
  return url.href.replace(/\/$/, "");
}

function pathContains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GalleryMcpConfig {
  const inlineAdminKey = String(env.GALLERY_ADMIN_KEY ?? "").trim();
  const adminKeyFile = String(env.GALLERY_ADMIN_KEY_FILE ?? "").trim();
  if (inlineAdminKey && adminKeyFile) {
    throw new GalleryMcpError("Set only one of GALLERY_ADMIN_KEY or GALLERY_ADMIN_KEY_FILE.", {
      code: "INVALID_CONFIGURATION",
    });
  }

  let adminKey = inlineAdminKey;
  if (!adminKey && adminKeyFile) {
    try {
      adminKey = readFileSync(path.resolve(adminKeyFile), "utf8").trim();
    } catch (error) {
      throw new GalleryMcpError("GALLERY_ADMIN_KEY_FILE cannot be read.", {
        code: "MISSING_CONFIGURATION",
        suggestion: "Create the key file, grant read access to your user, and restart the MCP client.",
        cause: error,
      });
    }
  }
  if (!adminKey) {
    throw new GalleryMcpError("GALLERY_ADMIN_KEY or GALLERY_ADMIN_KEY_FILE is required.", {
      code: "MISSING_CONFIGURATION",
      suggestion: "Set one Gallery admin credential source in the MCP process environment and restart it.",
    });
  }

  const uploadRoots = String(env.GALLERY_UPLOAD_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const defaultCacheBase = String(env.LOCALAPPDATA ?? env.XDG_CACHE_HOME ?? "").trim()
    || path.join(os.homedir(), ".cache");
  const remoteCacheRoot = path.resolve(
    String(env.GALLERY_REMOTE_CACHE_ROOT ?? "").trim()
      || path.join(defaultCacheBase, "gallery-mcp", "remote-images"),
  );
  const overlappingUploadRoot = uploadRoots.find((uploadRoot) => (
    pathContains(uploadRoot, remoteCacheRoot) || pathContains(remoteCacheRoot, uploadRoot)
  ));
  if (overlappingUploadRoot) {
    throw new GalleryMcpError("GALLERY_REMOTE_CACHE_ROOT must not overlap GALLERY_UPLOAD_ROOTS.", {
      code: "INVALID_CONFIGURATION",
      suggestion: "Move the remote cache outside every upload root so cached online originals cannot be uploaded.",
      details: { remote_cache_root: remoteCacheRoot, overlapping_upload_root: overlappingUploadRoot },
    });
  }

  return {
    baseUrl: normalizeBaseUrl(String(env.GALLERY_BASE_URL ?? DEFAULT_BASE_URL).trim()),
    adminKey,
    uploadRoots: [...new Set(uploadRoots)],
    remoteCacheRoot,
    remoteCacheConcurrency: boundedInteger(
      env.GALLERY_REMOTE_CACHE_CONCURRENCY,
      4,
      "GALLERY_REMOTE_CACHE_CONCURRENCY",
      1,
      8,
    ),
    requestTimeoutMs: positiveInteger(env.GALLERY_REQUEST_TIMEOUT_MS, 30_000, "GALLERY_REQUEST_TIMEOUT_MS"),
    uploadTimeoutMs: positiveInteger(env.GALLERY_UPLOAD_TIMEOUT_MS, 120_000, "GALLERY_UPLOAD_TIMEOUT_MS"),
    maxFileBytes: positiveInteger(env.GALLERY_MAX_FILE_BYTES, 50 * 1024 * 1024, "GALLERY_MAX_FILE_BYTES"),
    uploadConcurrency: boundedInteger(env.GALLERY_UPLOAD_CONCURRENCY, 4, "GALLERY_UPLOAD_CONCURRENCY", 1, 8),
    uploadChunkSize: boundedInteger(env.GALLERY_UPLOAD_CHUNK_SIZE, 20, "GALLERY_UPLOAD_CHUNK_SIZE", 1, 50),
  };
}
