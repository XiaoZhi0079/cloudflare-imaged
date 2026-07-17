import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  IMAGE_VARIANT_PRESETS,
  IMAGE_VARIANT_WIDTHS,
  applyResponsiveImageAttributes,
  buildImageVariantUrl,
  getResponsiveImageAttributes,
} from "../src/shared/image-variants.js";

test("image variants expose only the reviewed width whitelist", () => {
  assert.deepEqual(IMAGE_VARIANT_WIDTHS, [320, 480, 640, 768, 960, 1280, 1600, 1920, 2560]);
  assert.deepEqual(IMAGE_VARIANT_PRESETS.gallery.widths, [320, 480, 640, 768, 960]);
  assert.deepEqual(IMAGE_VARIANT_PRESETS.cover.widths, [480, 640, 768, 960, 1280]);
  assert.deepEqual(IMAGE_VARIANT_PRESETS.hero.widths, [640, 960, 1280, 1600, 1920, 2560]);
  assert.deepEqual(IMAGE_VARIANT_PRESETS.viewer.widths, [640, 960, 1280, 1600, 1920, 2560]);
});

test("responsive sizes avoid unsupported calc division syntax", () => {
  for (const preset of Object.values(IMAGE_VARIANT_PRESETS)) {
    assert.doesNotMatch(preset.sizes, /\//);
  }
});

test("variant URLs convert only gallery file paths into same-origin transform paths", () => {
  assert.equal(buildImageVariantUrl("/file/gallery/one.webp", 640), "/img/gallery/one.webp?w=640");
  assert.equal(
    buildImageVariantUrl("https://gallery.example/file/album/night%20sky.png", 1280),
    "/img/album/night%20sky.png?w=1280",
  );
  assert.equal(buildImageVariantUrl("https://cdn.example/image.webp", 640), null);
  assert.equal(buildImageVariantUrl("/admin/image.webp", 640), null);
  assert.equal(buildImageVariantUrl("/file/gallery/one.webp", 777), null);
});

test("responsive attributes preserve original src and cap candidates at intrinsic width", () => {
  const attributes = getResponsiveImageAttributes({
    fileUrl: "/file/gallery/wide.webp",
    width: 1672,
    height: 941,
  }, "hero");

  assert.equal(attributes.src, "/file/gallery/wide.webp");
  assert.equal(attributes.width, 1672);
  assert.equal(attributes.height, 941);
  assert.equal(attributes.sizes, IMAGE_VARIANT_PRESETS.hero.sizes);
  assert.equal(
    attributes.srcset,
    "/img/gallery/wide.webp?w=640 640w, /img/gallery/wide.webp?w=960 960w, /img/gallery/wide.webp?w=1280 1280w, /img/gallery/wide.webp?w=1600 1600w",
  );
});

test("responsive attributes fall back to original-only for non-gallery or tiny images", () => {
  assert.deepEqual(
    getResponsiveImageAttributes({ fileUrl: "https://cdn.example/image.webp", width: 2000 }, "gallery"),
    { src: "https://cdn.example/image.webp", srcset: "", sizes: IMAGE_VARIANT_PRESETS.gallery.sizes, width: 2000 },
  );
  assert.equal(
    getResponsiveImageAttributes({ fileUrl: "/file/tiny.webp", width: 200 }, "gallery").srcset,
    "",
  );
});

test("responsive attributes apply and clear browser image state", () => {
  const removed = [];
  const element = {
    src: "",
    srcset: "",
    sizes: "",
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { removed.push(name); this.attributes.delete(name); },
  };

  applyResponsiveImageAttributes(element, {
    fileUrl: "/file/gallery/one.webp",
    width: 1920,
    height: 1080,
  }, "viewer");
  assert.equal(element.src, "/file/gallery/one.webp");
  assert.match(element.srcset, /\/img\/gallery\/one\.webp\?w=1920 1920w/);
  assert.equal(element.sizes, IMAGE_VARIANT_PRESETS.viewer.sizes);
  assert.equal(element.attributes.get("width"), "1920");
  assert.equal(element.attributes.get("height"), "1080");

  applyResponsiveImageAttributes(element, { fileUrl: "https://cdn.example/one.webp" }, "viewer");
  assert.equal(element.srcset, "");
  assert.equal(element.sizes, IMAGE_VARIANT_PRESETS.viewer.sizes);
  assert.deepEqual(removed.slice(-2), ["width", "height"]);
});

test("runtime and shared image variant modules stay aligned", () => {
  const runtime = readFileSync(new URL("../public/assets/image-variants.js", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/image-variants.js", import.meta.url), "utf8");
  assert.equal(runtime, shared);
});
