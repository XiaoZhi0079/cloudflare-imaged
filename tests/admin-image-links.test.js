import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectImageUrl,
  buildDownloadImageUrl,
} from "../public/assets/admin/image-links.js";

test("admin image links expose absolute browse and forced-download URLs", () => {
  const baseUrl = "https://gallery.example.com/admin/";
  assert.equal(
    buildDirectImageUrl("/file/elegant-beauty/image 01.png", baseUrl),
    "https://gallery.example.com/file/elegant-beauty/image%2001.png",
  );
  assert.equal(
    buildDownloadImageUrl("/file/elegant-beauty/image 01.png", baseUrl),
    "https://gallery.example.com/file/elegant-beauty/image%2001.png?download=1",
  );
});

test("download links preserve existing query parameters and reject blank values", () => {
  assert.equal(
    buildDownloadImageUrl("https://gallery.example.com/file/photo.webp?version=2", "https://gallery.example.com/admin/"),
    "https://gallery.example.com/file/photo.webp?version=2&download=1",
  );
  assert.equal(buildDirectImageUrl("", "https://gallery.example.com/admin/"), "");
  assert.equal(buildDownloadImageUrl("", "https://gallery.example.com/admin/"), "");
});
