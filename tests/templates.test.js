import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  renderAdminImageGrid,
  renderAdminImageList,
  renderAdminTagList,
  renderGalleryCards,
  renderTagChips,
} from "../src/shared/templates.js";

test("renderTagChips marks the active tag", () => {
  const html = renderTagChips(
    [
      { name: "校园风情", slug: "campus" },
      { name: "日本美女", slug: "japan" },
    ],
    "japan",
  );

  assert.match(html, /class="tag-chip active"[^>]*data-tag-slug="japan"|data-tag-slug="japan"[^>]*class="tag-chip active"/);
  assert.match(html, /data-tag-slug="campus"/);
});

test("renderGalleryCards includes a restrained hover information overlay", () => {
  const html = renderGalleryCards([
    {
      id: 1,
      fileName: "campus-01.webp",
      fileUrl: "https://gallery.example.com/file/girls/campus-01.webp",
      width: 900,
      height: 1350,
      tags: ["campus", "portrait"],
    },
  ]);

  assert.match(html, /data-image-id="1"/);
  assert.match(html, /data-action="open-image"/);
  assert.match(html, /campus-01\.webp/);
  assert.match(html, /class="gallery-image-stage"/);
  assert.match(html, /class="gallery-hover-shade"/);
  assert.match(html, /class="gallery-hover-meta"/);
  assert.match(html, /class="card-title">campus-01\.webp<\/span>/);
  assert.match(html, /class="card-tags">campus \/ portrait<\/span>/);
  assert.doesNotMatch(html, /<strong>campus-01\.webp<\/strong>/);
});

test("public gallery stylesheet defines the hover dim and gradient reveal", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");

  assert.match(css, /\.gallery-card button::before/);
  assert.match(css, /rgba\(0,\s*0,\s*0,\s*0\.36\)/);
  assert.match(css, /\.gallery-card:hover img/);
  assert.match(css, /filter:\s*brightness\(0\.82\)/);
  assert.match(css, /\.gallery-card:hover \.gallery-hover-meta/);
  assert.match(css, /translateY\(0\)/);
});

test("admin index is an image library workbench", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");

  assert.match(html, /data-admin-page="library"/);
  assert.match(html, /class="app-shell admin-shell admin-workbench"/);
  assert.match(html, /id="tag-workbench"[^>]*class="admin-tags-sidebar"/);
  assert.match(html, /id="tag-manager-panel"/);
  assert.match(html, /id="tag-manager-toggle"/);
  assert.match(html, /id="tag-manager-list"/);
  assert.match(html, /id="admin-status"/);
  assert.match(html, /class="admin-workbench-head-content"/);
  assert.match(html, /class="admin-workbench-head-status"/);
  assert.match(html, /class="admin-auth-row"/);
  assert.match(html, /id="admin-auth-note-text"/);
  assert.match(html, /class="admin-toolbar-top-row"/);
  assert.match(html, /class="admin-library-header"/);
  assert.match(html, /class="admin-library-heading"/);
  assert.match(html, /class="admin-library-actions"/);
  assert.match(html, /class="admin-library-header"[\s\S]*id="admin-upload-open-toolbar"/);
  assert.doesNotMatch(html, /class="admin-toolbar-actions"[\s\S]*id="admin-upload-open-toolbar"/);
  assert.match(html, /id="admin-visible-count"[^>]*class="admin-count-badge"|class="admin-count-badge"[^>]*id="admin-visible-count"/);
  assert.doesNotMatch(html, /class="admin-side-nav"/);
  assert.doesNotMatch(html, /class="admin-gallery-link"/);
  assert.doesNotMatch(html, /id="admin-upload-open"/);
  assert.match(html, /id="admin-upload-open-toolbar"/);
  assert.match(html, /id="admin-search"/);
  assert.match(html, /id="admin-tag-filter-list"/);
  assert.match(html, /可多选，全部匹配/);
  assert.match(html, /id="admin-bulk-toolbar"/);
  assert.match(html, /id="image-list"[^>]*admin-image-grid/);
  assert.match(html, /id="admin-load-more"/);
  assert.match(html, /id="tag-workbench"[\s\S]*id="tag-manager-panel"[\s\S]*id="image-list"/);
  assert.match(html, /id="admin-upload-drawer"/);
  assert.match(html, /id="admin-detail-drawer"/);
  assert.match(html, /id="detail-file-name"/);
  assert.match(html, /id="detail-directory"/);
  assert.match(html, /id="detail-tag-options"/);
  assert.doesNotMatch(html, /id="admin-tag-filter"/);
  assert.doesNotMatch(html, /id="tag-list"/);
  assert.doesNotMatch(html, /admin-dashboard-grid/);
  assert.doesNotMatch(html, /admin-tag-drawer/);
  assert.doesNotMatch(html, /href="\/admin\/upload\.html"/);
  assert.doesNotMatch(html, /href="\/admin\/tags\.html"/);
  assert.doesNotMatch(html, /href="\/admin\/images\.html"/);
});

test("admin authentication keeps a fixed structure while state content changes", () => {
  const pages = [
    "../public/admin/index.html",
    "../public/admin/upload.html",
    "../public/admin/tags.html",
    "../public/admin/images.html",
  ];

  for (const pagePath of pages) {
    const html = readFileSync(new URL(pagePath, import.meta.url), "utf8");
    assert.match(html, /id="admin-auth"[^>]*class="[^"]*admin-auth-strip/);
    assert.match(html, /id="admin-key"/);
    assert.match(html, /id="admin-connect"/);
    assert.doesNotMatch(html, /admin-auth-panel/);
    assert.doesNotMatch(html, /<aside[\s>]/);
  }

  const js = readFileSync(new URL("../public/assets/admin.js", import.meta.url), "utf8");
  assert.ok(js.includes('const authPanel = $("#admin-auth");'));
  assert.match(js, /authPanel\.dataset\.state = connected \? "connected" : "disconnected"/);
  assert.match(js, /document\.body\.dataset\.adminConnected = connected \? "true" : "false"/);
  assert.doesNotMatch(js, /authPanel\.hidden = connected/);
  assert.match(js, /keyInput\?\.addEventListener\("keydown", \(event\) => \{/);
  assert.match(js, /if \(event\.key === "Enter"\)/);
  assert.match(js, /connectButton\?\.click\(\)/);
});

test("renderAdminImageGrid exposes selectable image cards for the workbench", () => {
  const html = renderAdminImageGrid([
    {
      id: 3,
      fileName: "campus-01.webp",
      fileUrl: "https://gallery.example.com/file/campus-01.webp",
      tags: ["校园风情", "短发"],
      syncStatus: "ok",
    },
  ]);

  assert.match(html, /class="admin-image-card"/);
  assert.match(html, /data-image-id="3"/);
  assert.match(html, /data-image-select/);
  assert.match(html, /data-action="open-detail"/);
  assert.match(html, /class="admin-image-card-media"/);
  assert.match(html, /class="admin-image-card-meta"/);
  assert.match(html, /class="tag-pill">校园风情<\/span>/);
  assert.match(html, /class="sync-pill is-ok"/);
});

test("admin library toolbar exposes a multi-select tag filter area", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");

  assert.match(html, /按标签筛选/);
  assert.match(html, /id="admin-tag-filter-list"/);
  assert.match(html, /可多选，全部匹配/);
  assert.doesNotMatch(html, /标签筛选<\/h2>/);
});

test("admin list templates render structured management rows", () => {
  const tagHtml = renderAdminTagList([
    { id: 1, name: "校园风情", slug: "campus", sortOrder: 1, isVisible: true },
  ]);
  const imageHtml = renderAdminImageList([
    {
      id: 3,
      fileName: "campus-01.webp",
      fileUrl: "https://gallery.example.com/file/campus-01.webp",
      tags: ["校园风情", "短发"],
      syncStatus: "ok",
    },
  ]);

  assert.match(tagHtml, /class="admin-tag-row list-item"/);
  assert.match(tagHtml, /class="visibility-pill is-visible"/);
  assert.match(tagHtml, /class="admin-row-actions inline-actions"/);
  assert.match(imageHtml, /class="admin-image-row list-item"/);
  assert.match(imageHtml, /class="admin-image-thumb"/);
  assert.match(imageHtml, /class="tag-pill">校园风情<\/span>/);
  assert.match(imageHtml, /class="button-danger"/);
});

test("admin script uses in-page dialogs instead of browser prompts", () => {
  const js = readFileSync(new URL("../public/assets/admin.js", import.meta.url), "utf8");

  assert.doesNotMatch(js, /window\.prompt/);
  assert.doesNotMatch(js, /window\.confirm/);
  assert.match(js, /document\.body\.dataset\.adminPage/);
  assert.match(js, /function initLibraryPage/);
  assert.match(js, /function openImageDetailDrawer/);
  assert.match(js, /function updateBulkToolbar/);
  assert.match(js, /const tagManagerPanel = \$\("#tag-manager-panel"\);/);
  assert.match(js, /const tagManagerToggleButton = \$\("#tag-manager-toggle"\);/);
  assert.match(js, /function setTagManagerExpanded/);
  assert.match(js, /sessionStorage\.setItem\("gallery-tag-manager-expanded"/);
  assert.match(js, /const tagFilterList = \$\("#admin-tag-filter-list"\);/);
  assert.match(js, /let selectedTagFilters = new Set\(\);/);
  assert.match(js, /const loadMoreImagesButton = \$\("#admin-load-more"\);/);
  assert.match(js, /const INITIAL_ADMIN_IMAGE_RENDER_COUNT = 120/);
  assert.match(js, /function updateLoadMoreButton\(/);
  assert.match(js, /loadMoreImagesButton\?\.addEventListener\("click"/);
  assert.match(js, /function bindTagFilterActions/);
  assert.doesNotMatch(js, /function bindTagRailActions/);
  assert.match(js, /function openUploadDrawer\(\)[\s\S]*selectedUploadTagIds = new Set\([\s\S]*selectedTagFilters[\s\S]*tags\.find\(\(tag\) => tag\.name === tagName\)\?\.id[\s\S]*\);/);
  assert.match(js, /function initUploadPage/);
  assert.match(js, /function initTagsPage/);
  assert.match(js, /function initImagesPage/);
  assert.match(js, /function openTextDialog/);
  assert.match(js, /function openConfirmDialog/);
  assert.match(js, /function openTagAssignmentDialog/);
  assert.doesNotMatch(js, /function openTagManagerDrawer/);
  assert.doesNotMatch(js, /admin-tag-drawer/);
});

test("admin tag actions update local state without reloading all tags", () => {
  const js = readFileSync(new URL("../public/assets/admin.js", import.meta.url), "utf8");

  assert.match(js, /function sortTagsByOrder/);
  assert.match(js, /function setTagsState/);
  assert.match(js, /async function updateTag\(tagId, changes\)[\s\S]*return payload\.tag;/);
  assert.match(js, /const \{ value: payload, durationMs \} = await measureRequest\(\(\) =>/);
  assert.match(js, /setTagsState\(\[\.\.\.tags, payload\.tag\]\)/);
  assert.doesNotMatch(js, /await loadTags\(\);\s*setStatus\(`已新增标签/);
});

test("admin image filters require every selected tag", () => {
  const js = readFileSync(new URL("../public/assets/admin.js", import.meta.url), "utf8");

  assert.match(js, /selectedTagFilters = new Set\(\[\.\.\.selectedTagFilters\]\.filter\(\(tagName\) => tags\.some\(\(tag\) => tag\.name === tagName\)\)\);/);
  assert.match(js, /const matchesTags = !selectedTagFilters\.size \|\| \[\.\.\.selectedTagFilters\]\.every\(\(tag\) => imageTags\.includes\(tag\)\);/);
});

test("admin stylesheet defines a scoped dashboard design system", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");

  assert.match(css, /--admin-bg:/);
  assert.match(css, /\.admin-shell/);
  assert.match(css, /\.admin-layout/);
  assert.match(css, /\.admin-auth-strip/);
  assert.match(css, /\.admin-workbench/);
  assert.match(css, /--admin-control-height:/);
  assert.match(css, /--admin-panel-padding:/);
  assert.match(css, /--admin-sidebar-width:/);
  assert.doesNotMatch(css, /\.admin-side-nav\s*\{/);
  assert.match(css, /\.admin-toolbar/);
  assert.match(css, /\.admin-toolbar-top-row/);
  assert.match(css, /\.admin-library-actions/);
  assert.match(css, /\.admin-workbench-head-content/);
  assert.match(css, /\.admin-library-header/);
  assert.match(css, /\.admin-tag-manager-panel \.admin-inline-form\s*\{[\s\S]*justify-items:\s*center/);
  assert.match(css, /\.admin-tag-manager-panel \.admin-inline-form \.field\s*\{[\s\S]*max-width:\s*min\(100%,\s*260px\)/);
  assert.match(css, /\.admin-empty-state/);
  assert.match(css, /\.admin-auth-strip\[data-state="connected"\]/);
  assert.match(css, /\.admin-bulk-toolbar/);
  assert.match(css, /\.admin-tags-sidebar/);
  assert.ok(css.includes("grid-template-columns: minmax(320px, var(--admin-sidebar-width)) minmax(0, 1fr);"));
  assert.match(css, /\.admin-tag-filter-list/);
  assert.match(css, /\.admin-tag-filter-chip/);
  assert.match(css, /\.admin-tag-manager-panel/);
  assert.match(css, /\.admin-tag-manager-body/);
  assert.ok(css.includes(".admin-tag-manager-panel .admin-inline-form"));
  assert.ok(css.includes("grid-template-columns: 1fr;"));
  assert.ok(css.includes(".admin-tag-manager-panel .admin-tag-row"));
  assert.match(css, /\.admin-tag-manager-panel\.is-collapsed/);
  assert.match(css, /\.admin-detail-drawer/);
  assert.match(css, /\.admin-upload-drawer/);
  assert.match(css, /\.admin-upload-drawer\s*\{[\s\S]*place-items:\s*center/);
  assert.match(css, /\.admin-dialog/);
  assert.match(css, /font-family:\s*-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui/);
  assert.doesNotMatch(css, /\.admin-tag-drawer/);
});

test("admin stylesheet inherits the public gallery warm palette for dialogs", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");

  assert.match(css, /\.admin-body\s*\{[\s\S]*--admin-bg:\s*#f3f0e8/);
  assert.match(css, /\.admin-body\s*\{[\s\S]*--admin-panel:\s*rgba\(255,\s*252,\s*245,\s*0\.96\)/);
  assert.match(css, /\.admin-body\s*\{[\s\S]*--admin-accent:\s*#b44e27/);
  assert.match(css, /\.admin-body\s*\{[\s\S]*radial-gradient\(circle at top left,\s*rgba\(180,\s*78,\s*39,\s*0\.12\)/);
  assert.match(css, /\.admin-dialog-panel\s*\{[\s\S]*background:\s*var\(--admin-panel\)/);
  assert.match(css, /\.dialog-check-option:has\(input:checked\)\s*\{[\s\S]*color:\s*var\(--admin-ink\)/);
});

test("renderAdminTagList and renderAdminImageList include action hooks", () => {
  const tagHtml = renderAdminTagList([
    { id: 1, name: "校园风情", slug: "campus", sortOrder: 1, isVisible: true },
  ]);
  const imageHtml = renderAdminImageList([
    { id: 3, fileName: "campus-01.webp", tags: ["校园风情"] },
  ]);

  assert.match(tagHtml, /data-tag-id="1"/);
  assert.match(tagHtml, /data-action="rename-tag"/);
  assert.match(tagHtml, /data-action="toggle-tag"/);
  assert.match(tagHtml, /data-action="delete-tag"/);
  assert.match(imageHtml, /data-image-id="3"/);
  assert.match(imageHtml, /data-action="assign-tags"/);
  assert.match(imageHtml, /data-action="rename-image"/);
  assert.match(imageHtml, /data-action="move-image"/);
  assert.match(imageHtml, /data-action="delete-image"/);
});

test("admin page keeps upload focused on gallery actions only", () => {
  const html = readFileSync(new URL("../public/admin/upload.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /ImgBed/);
  assert.doesNotMatch(html, /Telegram/);
  assert.doesNotMatch(html, /Cloudflare R2/);
  assert.doesNotMatch(html, /id="upload-directory"/);
  assert.doesNotMatch(html, /name="storage"/);
  assert.match(html, /id="upload-files"/);
});

test("public landing copy reads like a gallery instead of implementation notes", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /Independent Gallery/);
  assert.doesNotMatch(html, /默认展示第一个可见标签/);
});

test("runtime templates stay aligned with shared templates", () => {
  const runtime = readFileSync(new URL("../public/assets/templates.js", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/templates.js", import.meta.url), "utf8");

  assert.equal(runtime, shared);
});

