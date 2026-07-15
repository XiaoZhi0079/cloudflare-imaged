import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { renderGalleryCards, renderTagChips } from "../src/shared/templates.js";

test("public renderers keep gallery behavior", () => {
  const chips = renderTagChips([{ name: "人像", slug: "portrait" }], "portrait");
  const cards = renderGalleryCards([{ id: 1, fileName: "private-name.webp", fileUrl: "/file/object-42", tags: ["人像"], category: { name: "Portrait" } }]);
  assert.match(chips, /tag-chip active/);
  assert.match(cards, /loading="lazy"/);
  assert.match(cards, /gallery-hover-meta/);
  assert.match(cards, /人像/);
  assert.doesNotMatch(cards, /Portrait/);
  assert.match(cards, /\/file\/object-42/);
  assert.doesNotMatch(cards, /private-name\.webp/);
  assert.doesNotMatch(cards, /未分配标签/);
  assert.doesNotMatch(cards, /card-title/);
});

test("public gallery copy stays light-branded", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");
  const publicData = readFileSync(new URL("../public/assets/public-data.js", import.meta.url), "utf8");
  assert.match(html, /id="site-hero"/);
  assert.match(html, /id="hero-stage"/);
  assert.match(html, /id="hero-copy"/);
  assert.match(html, /id="hero-issue"/);
  assert.match(html, /id="hero-pause"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(html, /按标签浏览/);
  assert.doesNotMatch(html, /快速查看整理好的图片内容/);
  assert.match(gallery, /loadPublicBootstrapData/);
  assert.match(gallery, /createHeroCarousel/);
  assert.match(gallery, /setPauseReason\("hover"/);
  assert.match(gallery, /prefers-reduced-motion/);
  assert.match(gallery, /visibilitychange/);
  assert.doesNotMatch(gallery, /const \[sitePayload, tagsPayload\] = await Promise\.all/);
  assert.match(publicData, /\/api\/public\/site/);
  assert.match(gallery, /这个标签下暂时还没有内容/);
  assert.match(gallery, /图集暂时打不开/);
  assert.doesNotMatch(gallery, /image\.fileName/);
  assert.doesNotMatch(gallery, /error\.message/);
});

test("settings page exposes site configuration tab", () => {
  const html = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(html, /data-settings-tab="site"/);
  assert.match(html, /id="site-panel"/);
  assert.match(html, /id="site-issue-name"/);
  assert.match(html, /id="site-hero-copy"/);
  assert.match(html, /id="site-featured-list"/);
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
    "admin-search", "admin-sort", "admin-density", "tag-filter-list",
    "image-list", "admin-load-more", "admin-upload-open", "admin-upload-dialog",
    "admin-detail-drawer", "admin-bulk-toolbar", "bulk-assign-tags",
    "bulk-assign-category", "bulk-delete", "admin-dialog-host", "admin-toast-host",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /admin-tag-manager/);
  assert.doesNotMatch(html, /id="category-filter-list"/);
  assert.doesNotMatch(html, /<h3>主分类<\/h3>/);
});

test("image workbench exposes mutually exclusive featured eligibility filters", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const values = [...html.matchAll(/<input[^>]*type="radio"[^>]*name="featured-filter"[^>]*value="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(values, ["all", "eligible", "4k"]);
  assert.match(html, /value="all" checked/);
  assert.match(html, />轮播可用<\/span>/);
  assert.match(html, />4K<\/span>/);
});

test("image workbench renders only real filters with visible multi-select state", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(html, /id="tag-filter-selected-count"/);
  assert.doesNotMatch(controller, /name: "全部图片"/);
  assert.match(controller, /filter-tag-option/);
  assert.match(controller, /is-selected/);
  assert.doesNotMatch(controller, /categoryFilters/);
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

test("single-image hero controls have an explicit hidden override", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-controls\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test("featured hero copy overlays the image without an opaque panel", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");

  assert.match(gallery, /siteHero\.classList\.toggle\("has-featured", count > 0\)/);
  assert.match(
    css,
    /\.hero-featured\.has-featured\s*\{[^}]*position:\s*relative/,
  );
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-meta\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*72px[^}]*background:\s*transparent[^}]*pointer-events:\s*none/,
  );
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-copy\s*\{[^}]*color:\s*#fff[^}]*text-shadow:/,
  );
});

test("mobile featured hero copy stays in document flow", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const mobileMedia = css.match(
    /@media \(max-width:\s*720px\)\s*\{([\s\S]*?)\r?\n\}\s*@media \(max-width:\s*480px\)/,
  )?.[1];
  assert.ok(mobileMedia, "the 720px responsive media block must exist");

  const mobileHeroMeta = mobileMedia.match(
    /\.hero-featured\.has-featured \.hero-meta\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(mobileHeroMeta, "the mobile featured hero meta override must exist");
  assert.match(mobileHeroMeta, /position:\s*static/);
  assert.match(mobileHeroMeta, /padding:\s*16px 18px 18px/);
  assert.match(mobileHeroMeta, /background:\s*transparent/);
  assert.match(mobileHeroMeta, /pointer-events:\s*none/);
  assert.doesNotMatch(mobileHeroMeta, /bottom\s*:/);
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-meta\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*72px/,
  );
});

test("featured hero uses a fixed responsive 16:9 stage", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(
    css,
    /\.hero-stage\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;[^}]*min-height:\s*0;/,
  );
  assert.match(
    css,
    /\.hero-image\s*\{[^}]*height:\s*100%;[^}]*object-fit:\s*contain;[^}]*object-position:\s*center;/,
  );
  for (const viewportHeightRule of [
    /(?:^|\r?\n)\s*height:\s*min\(52vh,\s*520px\);?/m,
    /(?:^|\r?\n)\s*min-height:\s*min\(52vh,\s*520px\);?/m,
    /(?:^|\r?\n)\s*height:\s*min\(42vh,\s*360px\);?/m,
    /(?:^|\r?\n)\s*min-height:\s*min\(42vh,\s*360px\);?/m,
  ]) {
    assert.doesNotMatch(css, viewportHeightRule);
  }
  assert.match(index, /main\.css\?v=20260715-featured-dimensions/);
  assert.match(index, /gallery\.js\?v=20260715-featured-dimensions/);
});

test("public entry assets share one cache-busting release version", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const cssVersion = index.match(/href="\/assets\/main\.css\?v=([^"]+)"/);
  const scriptVersion = index.match(/src="\/assets\/gallery\.js\?v=([^"]+)"/);

  assert.ok(cssVersion, "main.css must include a non-empty release version");
  assert.ok(scriptVersion, "gallery.js must include a non-empty release version");
  assert.equal(cssVersion[1], scriptVersion[1]);
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
