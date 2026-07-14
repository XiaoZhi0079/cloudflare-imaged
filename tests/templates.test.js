import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { renderGalleryCards, renderTagChips } from "../src/shared/templates.js";

test("public renderers keep gallery behavior", () => {
  const chips = renderTagChips([{ name: "人像", slug: "portrait" }], "portrait");
  const cards = renderGalleryCards([{ id: 1, fileName: "a.webp", fileUrl: "/file/a.webp", tags: ["人像"] }]);
  assert.match(chips, /tag-chip active/);
  assert.match(cards, /loading="lazy"/);
  assert.match(cards, /gallery-hover-meta/);
});

test("both admin pages use the shared authentication gate", () => {
  for (const path of ["../public/admin/index.html", "../public/admin/settings.html"]) {
    const html = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(html, /id="admin-auth-view"[^>]*hidden/);
    assert.match(html, /id="admin-app"[^>]*hidden/);
    assert.match(html, /id="admin-key"/);
    assert.match(html, /id="admin-login"/);
    assert.match(html, /data-admin-logout/);
    assert.match(html, /href="\/admin\/"/);
    assert.match(html, /href="\/admin\/settings\.html"/);
    assert.match(html, /\/assets\/admin\/admin\.css/);
  }
});

test("admin pages load page-specific modules and styles", () => {
  const library = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(library, /\/assets\/admin\/workbench\.css/);
  assert.match(library, /\/assets\/admin\/library-page\.js/);
  assert.match(settings, /\/assets\/admin\/settings\.css/);
  assert.match(settings, /\/assets\/admin\/settings-page\.js/);
});

test("image workbench exposes filtering details upload and bulk controls", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  for (const id of [
    "admin-search", "admin-sort", "admin-density", "category-filter-list", "tag-filter-list",
    "image-list", "admin-load-more", "admin-upload-open", "admin-upload-dialog",
    "admin-detail-drawer", "admin-bulk-toolbar", "bulk-assign-tags",
    "bulk-assign-category", "bulk-delete", "admin-dialog-host", "admin-toast-host",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /admin-tag-manager/);
});

test("image workbench renders only real filters with visible multi-select state", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(html, /id="tag-filter-selected-count"/);
  assert.doesNotMatch(controller, /name: "全部图片"/);
  assert.match(controller, /filter-tag-option/);
  assert.match(controller, /is-selected/);
});

test("runtime public templates stay aligned with shared templates", () => {
  const runtime = readFileSync(new URL("../public/assets/templates.js", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/templates.js", import.meta.url), "utf8");
  assert.equal(runtime, shared);
});

test("legacy admin pages and scripts are removed", () => {
  for (const path of [
    "../public/admin/upload.html", "../public/admin/images.html", "../public/admin/tags.html",
    "../public/assets/admin.js", "../public/assets/admin-categories.js",
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});

test("public assets contain only public gallery concerns", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../public/assets/templates.js", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/templates.js", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.admin-/);
  for (const source of [runtime, shared]) {
    assert.deepEqual([...source.matchAll(/export function (\w+)/g)].map((match) => match[1]), ["renderTagChips", "renderGalleryCards"]);
  }
});

test("admin controls expose static accessibility contracts", () => {
  const library = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  const dialogs = readFileSync(new URL("../public/assets/admin/dialogs.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  for (const html of [library, settings]) {
    assert.match(html, /data-toggle-password[^>]*aria-label="[^"]+"[^>]*title="[^"]+"/);
    assert.match(html, /admin-toast-host[^>]*aria-live="polite"/);
  }
  assert.match(library, /admin-detail-drawer[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(controller, /createElement\("label"[^\n]*admin-field/);
  assert.match(controller, /type: "file"/);
});

test("filter rail preserves the search focus outline", () => {
  const css = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");
  assert.match(css, /\.filter-rail \{[^}]*padding:4px 14px 4px 4px/);
  assert.match(css, /@media \(max-width:1099px\)[\s\S]*?\.filter-rail \{[^}]*overflow:visible/);
});
