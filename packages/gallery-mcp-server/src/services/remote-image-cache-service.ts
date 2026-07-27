import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import { GalleryMcpError, toToolError } from "../errors.js";
import type { GalleryImage, GalleryMcpConfig } from "../types.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const CONTENT_TYPE_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSION_BY_CONTENT_TYPE).map(([contentType, extension]) => [extension, contentType]),
) as Record<string, string>;

const RemoteCacheRecordSchema = z.object({
  schema_version: z.literal(1),
  scope: z.literal("remote-image-cache"),
  image_id: z.number().int().positive(),
  public_id: z.string().regex(PUBLIC_ID_PATTERN),
  content_sha256: z.string().regex(SHA256_PATTERN),
  content_type: z.string().min(1),
  object_extension: z.string().regex(/^\.[a-z0-9]+$/),
  size_bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  source: z.object({
    file_name: z.string(),
    file_url: z.string(),
    gallery_content_sha256: z.string().regex(SHA256_PATTERN).nullable(),
  }).strict(),
  cached_at: z.string().datetime(),
  checked_at: z.string().datetime(),
}).strict();

const RemoteAnalysisRecordSchema = z.object({
  schema_version: z.literal(1),
  scope: z.literal("remote-content-analysis"),
  content_sha256: z.string().regex(SHA256_PATTERN),
  analysis_version: z.string().min(1).max(100),
  status: z.literal("analyzed"),
  result_reference: z.string().max(2048).nullable(),
  analyzed_at: z.string().datetime(),
}).strict();

type RemoteCacheRecord = z.infer<typeof RemoteCacheRecordSchema>;
type RemoteAnalysisRecord = z.infer<typeof RemoteAnalysisRecordSchema>;

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RemoteImageApi {
  getImage(identifier: number | string): Promise<GalleryImage>;
}

interface RemoteImageCacheOptions {
  fetchImpl?: FetchImplementation;
}

export interface RemoteImageBatchItem {
  clientItemId: string;
  identifier: number | string;
}

export type RemoteImageBatchResultDetail = "summary" | "actionable" | "all";

interface RemoteImageCacheBatchOptions {
  forceRefresh: boolean;
  continueOnError: boolean;
  resultDetail: RemoteImageBatchResultDetail;
}

interface DownloadedImage {
  bytes: Buffer;
  contentSha256: string;
  contentType: string;
  extension: string;
  width: number;
  height: number;
}

interface CachedObject {
  absolutePath: string;
  contentSha256: string;
  contentType: string;
  extension: string;
  sizeBytes: number;
}

function normalizedHash(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function normalizeAnalysisVersion(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 100) {
    throw new GalleryMcpError("analysis_version must contain between 1 and 100 characters.", {
      code: "INVALID_ANALYSIS_VERSION",
    });
  }
  return normalized;
}

function requireVisualAnalysisAuthorization(authorized: boolean): void {
  if (!authorized) {
    throw new GalleryMcpError("Explicit user authorization is required before caching content for visual analysis.", {
      code: "VISUAL_ANALYSIS_NOT_AUTHORIZED",
      suggestion: "Ask the user for permission to inspect the private image, then retry with user_confirmed_visual_analysis=true.",
    });
  }
}

async function runBatchWithConcurrency(
  items: RemoteImageBatchItem[],
  concurrency: number,
  continueOnError: boolean,
  operation: (item: RemoteImageBatchItem) => Promise<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown> | undefined> = new Array(items.length);
  let cursor = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (cursor < items.length && (!aborted || continueOnError)) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) return;
      try {
        results[index] = await operation(item);
      } catch (error) {
        results[index] = {
          client_item_id: item.clientItemId,
          status: "failed",
          ...toToolError(error),
        };
        if (!continueOnError) aborted = true;
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => await worker()));
  for (let index = cursor; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    results[index] = {
      client_item_id: item.clientItemId,
      status: "skipped",
      code: "REMOTE_CACHE_BATCH_ABORTED",
      message: "An earlier item failed and continue_on_error is false.",
    };
  }
  return results.map((result, index) => result ?? {
    client_item_id: items[index]?.clientItemId ?? `item-${index + 1}`,
    status: "skipped",
    code: "REMOTE_CACHE_ITEM_NOT_PROCESSED",
    message: "The batch item was not processed.",
  });
}

function batchResponse(
  results: Array<Record<string, unknown>>,
  resultDetail: RemoteImageBatchResultDetail,
): Record<string, unknown> {
  const failures = results.filter((result) => result.status === "failed");
  const skipped = results.filter((result) => result.status === "skipped");
  const actionable = results.filter((result) => (
    result.status === "failed"
    || result.status === "skipped"
    || result.should_analyze === true
    || (typeof result.cache_status === "string" && result.cache_status !== "cached")
  ));
  return {
    result_detail: resultDetail,
    total_count: results.length,
    succeeded_count: results.length - failures.length - skipped.length,
    failed_count: failures.length,
    skipped_count: skipped.length,
    pending_analysis_count: results.filter((result) => result.should_analyze === true).length,
    actionable_count: actionable.length,
    ...(resultDetail === "actionable" ? { items: actionable } : {}),
    ...(resultDetail === "all" ? { items: results } : {}),
  };
}

function isAllowedRemoteUrl(value: string, baseUrl: string): URL {
  const configuredUrl = new URL(baseUrl);
  let url: URL;
  try {
    url = new URL(value, `${baseUrl}/`);
  } catch (error) {
    throw new GalleryMcpError("Gallery returned an invalid image URL.", {
      code: "REMOTE_IMAGE_URL_INVALID",
      cause: error,
    });
  }
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new GalleryMcpError("Remote image URLs must use HTTPS except for localhost tests.", {
      code: "REMOTE_IMAGE_URL_FORBIDDEN",
    });
  }
  if (url.username || url.password) {
    throw new GalleryMcpError("Remote image URLs cannot contain credentials.", {
      code: "REMOTE_IMAGE_URL_FORBIDDEN",
    });
  }
  if (url.origin !== configuredUrl.origin) {
    throw new GalleryMcpError("Gallery returned an image URL outside the configured Gallery origin.", {
      code: "REMOTE_IMAGE_URL_FORBIDDEN",
      suggestion: "Fix the image file URL in Gallery or set GALLERY_BASE_URL to the origin that serves Gallery files.",
      details: { expected_origin: configuredUrl.origin, actual_origin: url.origin },
    });
  }
  return url;
}

async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function objectPath(cacheRoot: string, contentSha256: string, extension: string): string {
  return path.join(cacheRoot, "objects", contentSha256.slice(0, 2), `${contentSha256}${extension}`);
}

function imageRecordPath(cacheRoot: string, publicId: string): string {
  return path.join(cacheRoot, "images", `${publicId.toLocaleLowerCase("en-US")}.json`);
}

function contentReferencePath(cacheRoot: string, contentSha256: string, publicId: string): string {
  return path.join(cacheRoot, "contents", contentSha256, `${publicId.toLocaleLowerCase("en-US")}.json`);
}

function analysisRecordPath(cacheRoot: string, contentSha256: string, analysisVersion: string): string {
  const versionHash = createHash("sha256").update(analysisVersion).digest("hex");
  return path.join(cacheRoot, "analysis", contentSha256, `${versionHash}.json`);
}

async function readJsonRecord<T>(filePath: string, schema: z.ZodType<T>, label: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new GalleryMcpError(`The ${label} could not be read.`, {
      code: "REMOTE_CACHE_READ_FAILED",
      suggestion: "Check permissions on GALLERY_REMOTE_CACHE_ROOT and retry.",
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new GalleryMcpError(`The ${label} is not valid JSON.`, {
      code: "REMOTE_CACHE_RECORD_INVALID",
      suggestion: "Move the invalid record aside and cache the image again.",
      cause: error,
    });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new GalleryMcpError(`The ${label} does not match the supported schema.`, {
      code: "REMOTE_CACHE_RECORD_INVALID",
      suggestion: "Move the invalid record aside and cache the image again.",
    });
  }
  return result.data;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new GalleryMcpError("The remote cache record could not be written.", {
      code: "REMOTE_CACHE_WRITE_FAILED",
      suggestion: "Check free space and permissions on GALLERY_REMOTE_CACHE_ROOT, then retry.",
      cause: error,
    });
  }
}

async function isValidCachedObject(filePath: string, expectedHash: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0 && await hashFileSha256(filePath) === expectedHash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function installContentObject(cacheRoot: string, image: DownloadedImage): Promise<string> {
  const destination = objectPath(cacheRoot, image.contentSha256, image.extension);
  await mkdir(path.dirname(destination), { recursive: true });
  if (await isValidCachedObject(destination, image.contentSha256)) return destination;
  await rm(destination, { force: true });

  const temporaryPath = path.join(path.dirname(destination), `.${image.contentSha256}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, image.bytes, { flag: "wx" });
    try {
      await link(temporaryPath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !await isValidCachedObject(destination, image.contentSha256)) {
        throw error;
      }
    }
  } catch (error) {
    throw new GalleryMcpError("The downloaded image could not be installed in the content cache.", {
      code: "REMOTE_CACHE_WRITE_FAILED",
      suggestion: "Check free space and permissions on GALLERY_REMOTE_CACHE_ROOT, then retry.",
      cause: error,
    });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return destination;
}

async function findCachedObject(cacheRoot: string, contentSha256: string): Promise<CachedObject | null> {
  const directory = path.join(cacheRoot, "objects", contentSha256.slice(0, 2));
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  for (const name of names) {
    const extension = path.extname(name).toLocaleLowerCase("en-US");
    if (!name.startsWith(`${contentSha256}.`) || !CONTENT_TYPE_BY_EXTENSION[extension]) continue;
    const absolutePath = path.join(directory, name);
    if (!await isValidCachedObject(absolutePath, contentSha256)) continue;
    const fileStat = await stat(absolutePath);
    return {
      absolutePath,
      contentSha256,
      contentType: CONTENT_TYPE_BY_EXTENSION[extension]!,
      extension,
      sizeBytes: fileStat.size,
    };
  }
  return null;
}

async function listContentReferences(cacheRoot: string, contentSha256: string): Promise<string[]> {
  const directory = path.join(cacheRoot, "contents", contentSha256);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .filter((value) => PUBLIC_ID_PATTERN.test(value))
    .sort();
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Buffer> {
  if (!response.body) {
    throw new GalleryMcpError("Remote image response has no body.", {
      code: "REMOTE_IMAGE_DOWNLOAD_FAILED",
      retryable: true,
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GalleryMcpError("Remote image exceeds the configured cache size limit.", {
        code: "REMOTE_IMAGE_TOO_LARGE",
        suggestion: "Increase GALLERY_MAX_FILE_BYTES only after verifying the expected file size.",
      });
    }
    chunks.push(value);
  }
  if (totalBytes <= 0) {
    throw new GalleryMcpError("Remote image response is empty.", {
      code: "REMOTE_IMAGE_SIZE_INVALID",
    });
  }
  return Buffer.concat(chunks, totalBytes);
}

export class RemoteImageCacheService {
  private readonly fetchImpl: FetchImplementation;

  constructor(
    private readonly api: RemoteImageApi,
    private readonly config: GalleryMcpConfig,
    options: RemoteImageCacheOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async resolveImage(identifier: number | string): Promise<GalleryImage> {
    const image = await this.api.getImage(identifier);
    if (!Number.isInteger(image.id) || image.id <= 0 || !PUBLIC_ID_PATTERN.test(image.publicId ?? "")) {
      throw new GalleryMcpError("Gallery returned an image without a permanent identity.", {
        code: "REMOTE_IMAGE_IDENTITY_MISSING",
        suggestion: "Deploy the image identity migration before using the remote cache.",
      });
    }
    if (!image.fileUrl) {
      throw new GalleryMcpError("Gallery returned an image without a downloadable URL.", {
        code: "REMOTE_IMAGE_URL_MISSING",
      });
    }
    if (!normalizedHash(image.contentSha256)) {
      throw new GalleryMcpError("Gallery returned an image without a valid content SHA-256.", {
        code: "REMOTE_IMAGE_HASH_MISSING",
        suggestion: "Run the Gallery content-hash audit before caching or analyzing this image.",
        details: { image_id: image.id, public_id: image.publicId },
      });
    }
    return image;
  }

  private async download(image: GalleryImage): Promise<DownloadedImage> {
    const sourceUrl = isAllowedRemoteUrl(image.fileUrl, this.config.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.uploadTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(sourceUrl, {
        method: "GET",
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new GalleryMcpError(timedOut ? "Remote image download timed out." : "Remote image download failed.", {
        code: timedOut ? "REMOTE_IMAGE_DOWNLOAD_TIMEOUT" : "REMOTE_IMAGE_DOWNLOAD_FAILED",
        retryable: true,
        suggestion: "Retry this image without changing its analysis state.",
        cause: error,
      });
    }
    let bytes: Buffer;
    try {
      if (!response.ok) {
        throw new GalleryMcpError(`Remote image download returned HTTP ${response.status}.`, {
          code: "REMOTE_IMAGE_DOWNLOAD_FAILED",
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          suggestion: "Verify the Gallery file URL and retry this image.",
        });
      }
      if (response.url) isAllowedRemoteUrl(response.url, this.config.baseUrl);

      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > this.config.maxFileBytes) {
        throw new GalleryMcpError("Remote image exceeds the configured cache size limit.", {
          code: "REMOTE_IMAGE_TOO_LARGE",
          suggestion: "Increase GALLERY_MAX_FILE_BYTES only after verifying the expected file size.",
        });
      }
      bytes = await readBoundedResponse(response, this.config.maxFileBytes);
    } finally {
      clearTimeout(timer);
    }

    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      metadata = await sharp(bytes, { failOn: "error" }).metadata();
    } catch (error) {
      throw new GalleryMcpError("Downloaded bytes are not a readable supported image.", {
        code: "REMOTE_IMAGE_INVALID",
        cause: error,
      });
    }
    const contentType = CONTENT_TYPE_BY_FORMAT[String(metadata.format ?? "")];
    const extension = contentType ? EXTENSION_BY_CONTENT_TYPE[contentType] : undefined;
    const width = Number(metadata.width ?? 0);
    const height = Number(metadata.height ?? 0);
    if (!contentType || !extension || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
      throw new GalleryMcpError("Downloaded image format or dimensions are unsupported.", {
        code: "REMOTE_IMAGE_INVALID",
      });
    }
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const galleryHash = normalizedHash(image.contentSha256)!;
    if (galleryHash && galleryHash !== contentSha256) {
      throw new GalleryMcpError("Downloaded bytes do not match Gallery's stored content hash.", {
        code: "REMOTE_IMAGE_HASH_MISMATCH",
        suggestion: "Run the Gallery content-hash audit before processing this image.",
        details: { public_id: image.publicId, expected_sha256: galleryHash, actual_sha256: contentSha256 },
      });
    }
    return { bytes, contentSha256, contentType, extension, width, height };
  }

  private async readImageRecord(publicId: string): Promise<RemoteCacheRecord | null> {
    return await readJsonRecord(
      imageRecordPath(this.config.remoteCacheRoot, publicId),
      RemoteCacheRecordSchema,
      "remote image cache record",
    );
  }

  private async readAnalysis(contentSha256: string, analysisVersion: string): Promise<RemoteAnalysisRecord | null> {
    return await readJsonRecord(
      analysisRecordPath(this.config.remoteCacheRoot, contentSha256, analysisVersion),
      RemoteAnalysisRecordSchema,
      "remote image analysis record",
    );
  }

  private async saveMapping(
    image: GalleryImage,
    cached: CachedObject,
    dimensions: { width: number; height: number },
    previous: RemoteCacheRecord | null,
  ): Promise<RemoteCacheRecord> {
    const now = new Date().toISOString();
    const record: RemoteCacheRecord = {
      schema_version: 1,
      scope: "remote-image-cache",
      image_id: image.id,
      public_id: image.publicId.toLocaleLowerCase("en-US"),
      content_sha256: cached.contentSha256,
      content_type: cached.contentType,
      object_extension: cached.extension,
      size_bytes: cached.sizeBytes,
      width: dimensions.width,
      height: dimensions.height,
      source: {
        file_name: image.fileName,
        file_url: image.fileUrl,
        gallery_content_sha256: normalizedHash(image.contentSha256),
      },
      cached_at: previous?.content_sha256 === cached.contentSha256 ? previous.cached_at : now,
      checked_at: now,
    };
    await writeJsonAtomically(imageRecordPath(this.config.remoteCacheRoot, image.publicId), record);
    await writeJsonAtomically(
      contentReferencePath(this.config.remoteCacheRoot, cached.contentSha256, image.publicId),
      { image_id: image.id, public_id: image.publicId, content_sha256: cached.contentSha256 },
    );
    if (previous && previous.content_sha256 !== cached.contentSha256) {
      await rm(contentReferencePath(this.config.remoteCacheRoot, previous.content_sha256, image.publicId), { force: true });
    }
    return record;
  }

  private async resultFor(
    record: RemoteCacheRecord,
    analysisVersion: string,
    flags: { downloaded: boolean; mappingReused: boolean; contentReused: boolean },
  ): Promise<Record<string, unknown>> {
    const analysis = await this.readAnalysis(record.content_sha256, analysisVersion);
    const references = await listContentReferences(this.config.remoteCacheRoot, record.content_sha256);
    const duplicates = references.filter((publicId) => publicId !== record.public_id);
    return {
      remote_only_source: true,
      online_gallery_modified: false,
      image_id: record.image_id,
      public_id: record.public_id,
      local_path: objectPath(this.config.remoteCacheRoot, record.content_sha256, record.object_extension),
      content_sha256: record.content_sha256,
      size_bytes: record.size_bytes,
      width: record.width,
      height: record.height,
      downloaded: flags.downloaded,
      cache_hit: !flags.downloaded,
      image_mapping_reused: flags.mappingReused,
      content_object_reused: flags.contentReused,
      duplicate_content: duplicates.length > 0,
      duplicate_public_ids: duplicates,
      analysis_version: analysisVersion,
      analysis_status: analysis ? "analyzed" : "pending",
      should_analyze: analysis === null,
      analysis_result_reference: analysis?.result_reference ?? null,
    };
  }

  async cache(
    identifier: number | string,
    analysisVersionInput: string,
    forceRefresh = false,
    userConfirmedVisualAnalysis = false,
  ): Promise<Record<string, unknown>> {
    requireVisualAnalysisAuthorization(userConfirmedVisualAnalysis);
    const analysisVersion = normalizeAnalysisVersion(analysisVersionInput);
    const image = await this.resolveImage(identifier);
    const previous = await this.readImageRecord(image.publicId);
    const galleryHash = normalizedHash(image.contentSha256)!;

    if (!forceRefresh && previous && galleryHash === previous.content_sha256) {
      const existingPath = objectPath(this.config.remoteCacheRoot, previous.content_sha256, previous.object_extension);
      if (await isValidCachedObject(existingPath, previous.content_sha256)) {
        const cached: CachedObject = {
          absolutePath: existingPath,
          contentSha256: previous.content_sha256,
          contentType: previous.content_type,
          extension: previous.object_extension,
          sizeBytes: (await stat(existingPath)).size,
        };
        const record = await this.saveMapping(image, cached, { width: previous.width, height: previous.height }, previous);
        return await this.resultFor(record, analysisVersion, { downloaded: false, mappingReused: true, contentReused: true });
      }
    }

    if (!forceRefresh) {
      const existing = await findCachedObject(this.config.remoteCacheRoot, galleryHash);
      if (existing) {
        const width = Number(image.width ?? previous?.width ?? 0);
        const height = Number(image.height ?? previous?.height ?? 0);
        if (width > 0 && height > 0) {
          const record = await this.saveMapping(image, existing, { width, height }, previous);
          return await this.resultFor(record, analysisVersion, { downloaded: false, mappingReused: false, contentReused: true });
        }
      }
    }

    const downloaded = await this.download(image);
    const absolutePath = await installContentObject(this.config.remoteCacheRoot, downloaded);
    const cached: CachedObject = {
      absolutePath,
      contentSha256: downloaded.contentSha256,
      contentType: downloaded.contentType,
      extension: downloaded.extension,
      sizeBytes: downloaded.bytes.length,
    };
    const record = await this.saveMapping(
      image,
      cached,
      { width: downloaded.width, height: downloaded.height },
      previous,
    );
    return await this.resultFor(record, analysisVersion, { downloaded: true, mappingReused: false, contentReused: false });
  }

  async getStatus(identifier: number | string, analysisVersionInput: string): Promise<Record<string, unknown>> {
    const analysisVersion = normalizeAnalysisVersion(analysisVersionInput);
    const image = await this.resolveImage(identifier);
    const record = await this.readImageRecord(image.publicId);
    if (!record) {
      return {
        online_gallery_modified: false,
        image_id: image.id,
        public_id: image.publicId,
        cache_status: "not_cached",
        analysis_version: analysisVersion,
        analysis_status: "pending",
        should_analyze: true,
      };
    }
    const absolutePath = objectPath(this.config.remoteCacheRoot, record.content_sha256, record.object_extension);
    const objectValid = await isValidCachedObject(absolutePath, record.content_sha256);
    const galleryHash = normalizedHash(image.contentSha256)!;
    const current = objectValid && galleryHash === record.content_sha256;
    const analysis = current ? await this.readAnalysis(record.content_sha256, analysisVersion) : null;
    return {
      online_gallery_modified: false,
      image_id: image.id,
      public_id: image.publicId,
      local_path: absolutePath,
      content_sha256: record.content_sha256,
      cache_status: current ? "cached" : "stale",
      analysis_version: analysisVersion,
      analysis_status: analysis ? "analyzed" : "pending",
      should_analyze: analysis === null,
      analysis_result_reference: analysis?.result_reference ?? null,
    };
  }

  async markAnalyzed(
    identifier: number | string,
    contentSha256Input: string,
    analysisVersionInput: string,
    resultReference: string | null | undefined,
    userConfirmedVisualAnalysis = false,
  ): Promise<Record<string, unknown>> {
    requireVisualAnalysisAuthorization(userConfirmedVisualAnalysis);
    const analysisVersion = normalizeAnalysisVersion(analysisVersionInput);
    const contentSha256 = normalizedHash(contentSha256Input);
    if (!contentSha256) {
      throw new GalleryMcpError("content_sha256 must be a complete lowercase SHA-256 value.", {
        code: "INVALID_CONTENT_SHA256",
      });
    }
    const image = await this.resolveImage(identifier);
    const record = await this.readImageRecord(image.publicId);
    if (!record) {
      throw new GalleryMcpError("This image has not been cached yet.", {
        code: "REMOTE_IMAGE_NOT_CACHED",
        suggestion: "Call gallery_cache_remote_image, inspect local_path, then mark it analyzed.",
      });
    }
    if (record.content_sha256 !== contentSha256) {
      throw new GalleryMcpError("The supplied content hash does not match the cached image mapping.", {
        code: "REMOTE_CACHE_HASH_MISMATCH",
        suggestion: "Read the current cache status and inspect the current local_path before marking analysis complete.",
      });
    }
    const absolutePath = objectPath(this.config.remoteCacheRoot, record.content_sha256, record.object_extension);
    if (!await isValidCachedObject(absolutePath, contentSha256)) {
      throw new GalleryMcpError("The cached content object is missing or damaged.", {
        code: "REMOTE_CACHE_OBJECT_INVALID",
        suggestion: "Cache the image again before marking it analyzed.",
      });
    }
    const galleryHash = normalizedHash(image.contentSha256);
    if (galleryHash !== contentSha256) {
      throw new GalleryMcpError("Gallery's current content hash no longer matches this cache record.", {
        code: "REMOTE_CACHE_STALE",
        suggestion: "Cache and inspect the current remote image again.",
      });
    }
    const existing = await this.readAnalysis(contentSha256, analysisVersion);
    const suppliedReference = resultReference === undefined
      ? undefined
      : typeof resultReference === "string" ? resultReference.trim() || null : null;
    const referenceChanged = existing !== null
      && suppliedReference !== undefined
      && existing.result_reference !== suppliedReference;
    const analysis: RemoteAnalysisRecord = existing
      ? referenceChanged ? { ...existing, result_reference: suppliedReference ?? null } : existing
      : {
        schema_version: 1,
        scope: "remote-content-analysis",
        content_sha256: contentSha256,
        analysis_version: analysisVersion,
        status: "analyzed",
        result_reference: suppliedReference ?? null,
        analyzed_at: new Date().toISOString(),
      };
    if (!existing || referenceChanged) {
      await writeJsonAtomically(analysisRecordPath(this.config.remoteCacheRoot, contentSha256, analysisVersion), analysis);
    }
    const references = await listContentReferences(this.config.remoteCacheRoot, contentSha256);
    return {
      online_gallery_modified: false,
      marked_analyzed: true,
      changed: existing === null || referenceChanged,
      reference_changed: referenceChanged,
      image_id: image.id,
      public_id: image.publicId,
      content_sha256: contentSha256,
      analysis_version: analysisVersion,
      analysis_status: "analyzed",
      analyzed_at: analysis.analyzed_at,
      result_reference: analysis.result_reference,
      reusable_public_ids: references,
    };
  }

  async getStatusBatch(
    items: RemoteImageBatchItem[],
    analysisVersionInput: string,
    resultDetail: RemoteImageBatchResultDetail = "actionable",
  ): Promise<Record<string, unknown>> {
    const analysisVersion = normalizeAnalysisVersion(analysisVersionInput);
    const results = await runBatchWithConcurrency(
      items,
      this.config.remoteCacheConcurrency,
      true,
      async (item) => ({
        client_item_id: item.clientItemId,
        status: "ok",
        ...await this.getStatus(item.identifier, analysisVersion),
      }),
    );
    return batchResponse(results, resultDetail);
  }

  async cacheBatch(
    items: RemoteImageBatchItem[],
    analysisVersionInput: string,
    options: RemoteImageCacheBatchOptions,
    userConfirmedVisualAnalysis = false,
  ): Promise<Record<string, unknown>> {
    requireVisualAnalysisAuthorization(userConfirmedVisualAnalysis);
    const analysisVersion = normalizeAnalysisVersion(analysisVersionInput);
    const results = await runBatchWithConcurrency(
      items,
      this.config.remoteCacheConcurrency,
      options.continueOnError,
      async (item) => ({
        client_item_id: item.clientItemId,
        status: "cached",
        ...await this.cache(item.identifier, analysisVersion, options.forceRefresh, true),
      }),
    );
    return batchResponse(results, options.resultDetail);
  }
}
