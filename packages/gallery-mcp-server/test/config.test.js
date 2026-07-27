import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";

import { loadConfig } from "../dist/config.js";

test("configuration defaults to the production Gallery and keeps upload roots bounded", () => {
  const config = loadConfig({
    GALLERY_ADMIN_KEY: "test-key",
    GALLERY_UPLOAD_ROOTS: ["D:\\Images", "D:\\Generated"].join(path.delimiter),
  });

  assert.equal(config.baseUrl, "https://gallery.140079.xyz");
  assert.equal(config.adminKey, "test-key");
  assert.deepEqual(config.uploadRoots, [path.resolve("D:\\Images"), path.resolve("D:\\Generated")]);
  assert.ok(path.isAbsolute(config.remoteCacheRoot));
  assert.match(config.remoteCacheRoot, /gallery-mcp[\\/]remote-images$/);
  assert.equal(config.remoteCacheConcurrency, 4);
  assert.equal(config.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(config.uploadConcurrency, 4);
  assert.equal(config.uploadChunkSize, 20);
});

test("configuration accepts an explicit persistent remote cache root", () => {
  const config = loadConfig({
    GALLERY_ADMIN_KEY: "test-key",
    GALLERY_REMOTE_CACHE_ROOT: "D:\\GalleryCache",
    GALLERY_REMOTE_CACHE_CONCURRENCY: "6",
  });
  assert.equal(config.remoteCacheRoot, path.resolve("D:\\GalleryCache"));
  assert.equal(config.remoteCacheConcurrency, 6);
});

test("configuration rejects overlap between remote cache and upload roots", () => {
  assert.throws(
    () => loadConfig({
      GALLERY_ADMIN_KEY: "test-key",
      GALLERY_UPLOAD_ROOTS: "D:\\GalleryFiles",
      GALLERY_REMOTE_CACHE_ROOT: "D:\\GalleryFiles\\remote-cache",
    }),
    (error) => error.code === "INVALID_CONFIGURATION" && /must not overlap/.test(error.message),
  );
  assert.throws(
    () => loadConfig({
      GALLERY_ADMIN_KEY: "test-key",
      GALLERY_UPLOAD_ROOTS: "D:\\GalleryCache\\uploads",
      GALLERY_REMOTE_CACHE_ROOT: "D:\\GalleryCache",
    }),
    (error) => error.code === "INVALID_CONFIGURATION" && /must not overlap/.test(error.message),
  );
});

test("configuration rejects missing credentials and unsafe remote HTTP URLs", () => {
  assert.throws(() => loadConfig({}), /GALLERY_ADMIN_KEY or GALLERY_ADMIN_KEY_FILE is required/);
  assert.throws(
    () => loadConfig({ GALLERY_ADMIN_KEY: "test", GALLERY_BASE_URL: "http://gallery.example.com" }),
    /must use HTTPS/,
  );
});

test("configuration reads the admin key from a dedicated secret file", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "gallery-mcp-secret-"));
  try {
    const keyFile = path.join(directory, "gallery-key.txt");
    writeFileSync(keyFile, "file-secret\n", "utf8");
    const config = loadConfig({ GALLERY_ADMIN_KEY_FILE: keyFile });
    assert.equal(config.adminKey, "file-secret");
    assert.throws(
      () => loadConfig({ GALLERY_ADMIN_KEY: "inline", GALLERY_ADMIN_KEY_FILE: keyFile }),
      /Set only one/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
