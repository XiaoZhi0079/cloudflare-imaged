import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { inspectUploadFile, resolveAllowedUploadPath } from "../dist/services/path-security.js";

test("upload inspection accepts real images inside configured roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-mcp-root-"));
  try {
    const imagePath = path.join(root, "sample.png");
    await sharp({ create: { width: 2, height: 3, channels: 3, background: "#ffffff" } }).png().toFile(imagePath);

    const image = await inspectUploadFile(imagePath, [root], 1024 * 1024);

    assert.equal(image.name, "sample.png");
    assert.equal(image.type, "image/png");
    assert.equal(image.width, 2);
    assert.equal(image.height, 3);
    assert.ok(image.bytes.length > 0);
    assert.equal(image.contentSha256, createHash("sha256").update(image.bytes).digest("hex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("path validation refuses files outside configured upload roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gallery-mcp-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "gallery-mcp-outside-"));
  try {
    const imagePath = path.join(outside, "outside.png");
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "#ffffff" } }).png().toFile(imagePath);
    await assert.rejects(
      () => resolveAllowedUploadPath(imagePath, [root]),
      (error) => error.code === "LOCAL_PATH_FORBIDDEN",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
