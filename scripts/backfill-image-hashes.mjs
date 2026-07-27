import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://gallery.140079.xyz";

function parseArguments(args) {
  const options = {
    baseUrl: process.env.GALLERY_BASE_URL || DEFAULT_BASE_URL,
    adminKeyFile: process.env.GALLERY_ADMIN_KEY_FILE
      || path.join(os.homedir(), ".mcp-secrets", "gallery_admin_key.txt"),
    concurrency: 4,
    batchSize: 50,
    dryRun: false,
    reportPath: null,
    maxImages: null,
    hashMode: "remote",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--base-url") options.baseUrl = args[++index];
    else if (argument === "--admin-key-file") options.adminKeyFile = args[++index];
    else if (argument === "--concurrency") options.concurrency = Number(args[++index]);
    else if (argument === "--batch-size") options.batchSize = Number(args[++index]);
    else if (argument === "--report") options.reportPath = args[++index];
    else if (argument === "--max-images") options.maxImages = Number(args[++index]);
    else if (argument === "--hash-mode") options.hashMode = String(args[++index] ?? "").trim();
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error("--concurrency must be an integer between 1 and 8");
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) {
    throw new Error("--batch-size must be an integer between 1 and 100");
  }
  if (options.maxImages !== null && (!Number.isInteger(options.maxImages) || options.maxImages < 1)) {
    throw new Error("--max-images must be a positive integer");
  }
  if (!["remote", "local"].includes(options.hashMode)) {
    throw new Error("--hash-mode must be remote or local");
  }
  options.baseUrl = String(options.baseUrl).replace(/\/+$/, "");
  return options;
}

async function fetchWithRetry(url, init = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function fetchJson(url, adminKey, init = {}) {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-gallery-admin-key": adminKey,
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function hashResponseBody(response) {
  if (!response.ok || !response.body) throw new Error(`Unable to read original image bytes (HTTP ${response.status}).`);
  const hash = createHash("sha256");
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest("hex");
}

async function hashUrlSha256(url, { attempts = 3, timeoutMs = 120000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await hashResponseBody(await fetch(url, { signal: controller.signal }));
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, concurrency, worker, onSettled = () => {}) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      } finally {
        onSettled(results[index], index);
      }
    }
  }));
  return results;
}

async function listAllImages(baseUrl, adminKey) {
  const images = [];
  let offset = 0;
  do {
    const payload = await fetchJson(`${baseUrl}/api/admin/images?limit=100&offset=${offset}`, adminKey);
    images.push(...(payload.images ?? []));
    if (!payload.hasMore) break;
    offset = payload.nextOffset;
  } while (offset !== null);
  return images;
}

async function writeDuplicateReport(reportPath, images) {
  const byHash = new Map();
  for (const image of images) {
    if (!image.contentSha256) continue;
    const current = byHash.get(image.contentSha256) ?? [];
    current.push({
      id: image.id,
      publicId: image.publicId,
      storageKey: image.storageKey,
      fileName: image.fileName,
    });
    byHash.set(image.contentSha256, current);
  }
  const duplicates = [...byHash.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([contentSha256, members]) => ({ contentSha256, count: members.length, images: members }));
  if (reportPath) {
    const resolved = path.resolve(reportPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify({ generatedAt: new Date().toISOString(), duplicates }, null, 2)}\n`, "utf8");
  }
  return duplicates;
}

async function submitHashAssignments(baseUrl, adminKey, assignments) {
  try {
    const result = await fetchJson(`${baseUrl}/api/admin/images/content-hashes`, adminKey, {
      method: "POST",
      body: JSON.stringify({ assignments }),
    });
    return { updatedCount: Number(result.updatedCount ?? 0), failures: [] };
  } catch (error) {
    if (assignments.length === 1) {
      return {
        updatedCount: 0,
        failures: [{
          imageId: assignments[0].imageId,
          stage: "write",
          code: error.code,
          error: error.message,
        }],
      };
    }
    const middle = Math.ceil(assignments.length / 2);
    const left = await submitHashAssignments(baseUrl, adminKey, assignments.slice(0, middle));
    const right = await submitHashAssignments(baseUrl, adminKey, assignments.slice(middle));
    return {
      updatedCount: left.updatedCount + right.updatedCount,
      failures: [...left.failures, ...right.failures],
    };
  }
}

export async function backfillImageHashes(options) {
  const adminKey = String(await readFile(options.adminKeyFile, "utf8")).trim();
  if (!adminKey) throw new Error("The Gallery admin key file is empty.");

  const initialImages = await listAllImages(options.baseUrl, adminKey);
  const allPending = initialImages.filter((image) => !image.contentSha256);
  const pending = options.maxImages === null ? allPending : allPending.slice(0, options.maxImages);
  const failures = [];
  let updatedCount = 0;

  for (let index = 0; index < pending.length; index += options.batchSize) {
    const batch = pending.slice(index, index + options.batchSize);
    const remoteCompute = options.hashMode === "remote" && !options.dryRun;
    let settledInBatch = 0;
    const hashed = await mapWithConcurrency(batch, options.concurrency, async (image) => {
      if (remoteCompute) {
        return await fetchJson(`${options.baseUrl}/api/admin/images/content-hashes/compute`, adminKey, {
          method: "POST",
          body: JSON.stringify({
            imageId: image.id,
            expectedStorageKey: image.storageKey,
            expectedFileUrl: image.fileUrl,
          }),
        });
      }
      const fileUrl = new URL(image.fileUrl, `${options.baseUrl}/`);
      return {
        imageId: image.id,
        expectedStorageKey: image.storageKey,
        expectedFileUrl: image.fileUrl,
        contentSha256: await hashUrlSha256(fileUrl),
      };
    }, () => {
      settledInBatch += 1;
      if (settledInBatch % 10 === 0 || settledInBatch === batch.length) {
        console.error(JSON.stringify({
          phase: "hash",
          processed: index + settledInBatch,
          total: pending.length,
        }));
      }
    });
    const assignments = [];
    hashed.forEach((result, batchIndex) => {
      if (result.ok) assignments.push(result.value);
      else failures.push({ imageId: batch[batchIndex].id, stage: "hash", error: result.error?.message ?? String(result.error) });
    });
    if (remoteCompute) {
      updatedCount += assignments.length;
    } else if (assignments.length && !options.dryRun) {
      const submitted = await submitHashAssignments(options.baseUrl, adminKey, assignments);
      updatedCount += submitted.updatedCount;
      failures.push(...submitted.failures);
    }
    console.error(JSON.stringify({
      phase: "backfill",
      processed: Math.min(index + batch.length, pending.length),
      total: pending.length,
      updated: updatedCount,
      failures: failures.length,
    }));
  }

  const finalImages = options.dryRun ? initialImages : await listAllImages(options.baseUrl, adminKey);
  const duplicates = await writeDuplicateReport(options.reportPath, finalImages);
  return {
    dryRun: options.dryRun,
    imageCount: finalImages.length,
    pendingAtStart: allPending.length,
    attemptedCount: pending.length,
    partialRun: options.maxImages !== null,
    updatedCount,
    remainingWithoutHash: finalImages.filter((image) => !image.contentSha256).length,
    duplicateHashGroups: duplicates.length,
    failures,
    reportPath: options.reportPath ? path.resolve(options.reportPath) : null,
  };
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
if (isMain) {
  backfillImageHashes(parseArguments(process.argv.slice(2)))
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failures.length || (!summary.dryRun && !summary.partialRun && summary.remainingWithoutHash)) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
