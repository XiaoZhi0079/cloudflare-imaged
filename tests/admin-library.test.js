import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createLibraryState,
  filterImages,
} from "../public/assets/admin/library-state.js";
import { buildImagePreviewUrl, renderImageCard } from "../public/assets/admin/renderers/image-card.js";

const images = [
  { id: 1, fileName: "a.webp", tags: ["人像", "自然光"], category: { id: 3, name: "人像" } },
  { id: 2, fileName: "b.webp", tags: ["人像"], category: { id: 4, name: "街景" } },
  { id: 3, fileName: "nature.webp", tags: ["自然光"], category: { id: 3, name: "人像" } },
];

const featuredImages = [
  {
    id: 10,
    fileName: "eligible.webp",
    tags: ["人像"],
    featuredEligibility: { eligible: true, is4K: false },
  },
  {
    id: 11,
    fileName: "nature-4k.webp",
    tags: ["自然光", "精选"],
    featuredEligibility: { eligible: true, is4K: true },
  },
  {
    id: 12,
    fileName: "invalid.webp",
    tags: ["精选"],
    featuredEligibility: { eligible: false, is4K: false },
  },
  { id: 13, fileName: "unknown.webp", tags: ["精选"] },
];

test("library filters require every selected tag", () => {
  assert.deepEqual(
    filterImages(images, { query: "", tagNames: new Set(["人像", "自然光"]) }),
    [images[0]],
  );
  assert.deepEqual(
    filterImages(images, { query: "NATURE", tagNames: new Set() }),
    [images[2]],
  );
});

test("library filtering stays driven by search and tags when eligibility metadata exists", () => {
  assert.deepEqual(
    filterImages(featuredImages, { featured: "4k" }).map((image) => image.id),
    [10, 11, 12, 13],
  );
  assert.deepEqual(
    filterImages(featuredImages, {
      query: "NATURE",
      tagNames: new Set(["自然光", "精选"]),
      featured: "4k",
    }).map((image) => image.id),
    [11],
  );
});

test("library selection survives filtering and drops removed image ids", () => {
  const state = createLibraryState();
  state.setImages(images);
  state.toggleSelection(2);
  state.setTagsFilter(new Set(["自然光"]));
  assert.deepEqual([...state.getSelectedIds()], [2]);
  assert.deepEqual(state.visibleImages().map((image) => image.id), [3, 1]);
  state.syncImages(images.filter((image) => image.id !== 2));
  assert.deepEqual([...state.getSelectedIds()], []);
});

test("empty filters show every image and multiple tags use intersection", () => {
  const state = createLibraryState();
  state.setImages(images);
  assert.deepEqual(state.visibleImages().map((image) => image.id), [3, 2, 1]);
  state.setTagsFilter(new Set(["人像", "自然光"]));
  assert.deepEqual(state.visibleImages().map((image) => image.id), [1]);
  assert.equal(state.setCategory, undefined);
  assert.equal("categoryId" in state.getFilters(), false);
});

test("library state exposes only search tags and sort filters", () => {
  const state = createLibraryState({ initialRenderLimit: 1, renderIncrement: 10 });
  state.setImages(featuredImages);
  state.showMore();
  assert.equal(state.setFeaturedFilter, undefined);

  state.setQuery("nature");
  state.setTagsFilter(new Set(["精选"]));
  assert.deepEqual(state.visibleImages().map((image) => image.id), [11]);

  state.resetFilters();
  assert.deepEqual(state.getFilters(), {
    query: "",
    tagNames: new Set(),
    sort: "newest",
  });
  assert.equal(state.renderedImages().length, 1);
});

test("library renders images in bounded increments", () => {
  const state = createLibraryState({ initialRenderLimit: 2, renderIncrement: 1 });
  state.setImages(images);
  assert.equal(state.renderedImages().length, 2);
  assert.equal(state.hasMore(), true);
  state.showMore();
  assert.equal(state.renderedImages().length, 3);
  assert.equal(state.hasMore(), false);
});

test("image card escapes values and exposes selection and detail actions", () => {
  const html = renderImageCard({
    id: 8,
    fileName: '<bad ">.webp',
    fileUrl: "https://example.com/a.webp?x=<bad>",
    category: { name: "人像" },
    tags: ["一", "二", "三"],
    syncStatus: "ok",
  }, { selected: true, selectionMode: true });

  assert.doesNotMatch(html, /<bad/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /data-action="toggle-selection"/);
  assert.match(html, /data-action="open-detail"/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /人像/);
  assert.match(html, />三</);
});

test("image previews use the database record id to bypass a stale missing-file cache", () => {
  assert.equal(
    buildImagePreviewUrl("/file/gallery/reuploaded.png", 142),
    "/file/gallery/reuploaded.png?gallery-preview=142",
  );
  assert.equal(
    buildImagePreviewUrl("/file/gallery/reuploaded.png?size=card#preview", 143),
    "/file/gallery/reuploaded.png?size=card&gallery-preview=143#preview",
  );

  const html = renderImageCard({
    id: 142,
    fileName: "reuploaded.png",
    fileUrl: "/file/gallery/reuploaded.png",
    tags: [],
  });
  assert.match(html, /src="\/file\/gallery\/reuploaded\.png\?gallery-preview=142"/);
});

test("image card keeps selection controls out of normal browsing mode", () => {
  const normalHtml = renderImageCard({ id: 16, fileName: "normal.webp", tags: [] });
  const batchHtml = renderImageCard({ id: 16, fileName: "normal.webp", tags: [] }, { selectionMode: true });

  assert.doesNotMatch(normalHtml, /data-action="toggle-selection"/);
  assert.match(batchHtml, /data-action="toggle-selection"/);
});

test("image card shows every tag without rendering the main category as a peer label", () => {
  const html = renderImageCard({
    id: 15,
    fileName: "tagged.webp",
    fileUrl: "/files/tagged.webp",
    category: { name: "人物目录" },
    tags: ["气质美女", "连衣裙", "侧光", "室内"],
  });

  assert.doesNotMatch(html, /人物目录/);
  assert.match(html, />气质美女</);
  assert.match(html, />连衣裙</);
  assert.match(html, />侧光</);
  assert.match(html, />室内</);
});

test("image card includes a fallback when no preview URL exists", () => {
  const html = renderImageCard({ id: 9, fileName: "missing.webp", fileUrl: "", tags: [] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /image-preview-fallback/);
});

test("image card does not overlay carousel eligibility metadata", () => {
  const html = renderImageCard({
    id: 10,
    fileName: "featured.webp",
    fileUrl: "/files/featured",
    tags: [],
    featuredEligibility: {
      dimensions: "3840×2160",
      eligible: true,
      is4K: true,
      qualityLabel: "4K",
      statusLabel: "轮播可用",
      reason: null,
    },
  });

  assert.doesNotMatch(html, /3840×2160/);
  assert.doesNotMatch(html, /轮播可用/);
  assert.doesNotMatch(html, />4K</);
  assert.doesNotMatch(html, /image-featured-badge|is-4k/);
});

test("image card does not expose carousel rejection reasons", () => {
  const invalidHtml = renderImageCard({
    id: 12,
    fileName: "invalid.webp",
    tags: [],
    featuredEligibility: {
      dimensions: "1600×900",
      eligible: false,
      is4K: false,
      qualityLabel: null,
      statusLabel: "分辨率不足",
      reason: "分辨率不足",
    },
  });
  assert.doesNotMatch(invalidHtml, /1600×900/);
  assert.doesNotMatch(invalidHtml, /分辨率不足/);
  assert.doesNotMatch(invalidHtml, /is-invalid/);

  const unknownHtml = renderImageCard({ id: 13, fileName: "unknown.webp", tags: [] });
  assert.doesNotMatch(unknownHtml, /尺寸未知/);
});

test("image card ignores every server-provided featured label", () => {
  const html = renderImageCard({
    id: 14,
    fileName: "unsafe.webp",
    tags: [],
    featuredEligibility: {
      dimensions: '<img src=x onerror="bad">',
      eligible: true,
      is4K: true,
      qualityLabel: '<b class="bad">4K</b>',
      statusLabel: "<script>bad()</script>",
      reason: null,
    },
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b class="bad">/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /onerror|bad\(\)|4K/);
});

test("library controller connects detail and bulk API operations", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/admin\/images"/);
  assert.match(source, /\/api\/admin\/images\/tag-assignments"/);
  assert.match(source, /\/api\/admin\/images\/tag-assignments\/bulk/);
  assert.match(source, /\/api\/admin\/images\/category-assignments\/bulk/);
  assert.match(source, /\/api\/admin\/images\/bulk-delete/);
  assert.match(source, /bulkMode/);
  assert.match(source, /selectionMode: bulkMode/);
  assert.match(source, /elements\.bulkToolbar\.hidden = !bulkMode/);
  assert.match(source, /gallery-preview-retry/);
  assert.match(source, /addEventListener\("load"/);
});

test("image detail exposes a confirmed single-image delete action", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  const workbenchCss = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");
  assert.match(source, /className:\s*"admin-button-danger"[^\n]*"删除图片"/);
  assert.match(source, /deleteDetailImage/);
  assert.match(source, /confirmDetailAction\(\{[\s\S]*title:\s*"删除图片"[\s\S]*danger:\s*true/);
  assert.match(source, /function confirmDetailAction[\s\S]*setAttribute\("aria-hidden", "true"\)[\s\S]*dialogs\.confirm\(options\)[\s\S]*removeAttribute\("aria-hidden"\)/s);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /body:\s*JSON\.stringify\(\{ imageId: image\.id \}\)/);
  assert.match(source, /detailDrafts\.delete\(deletedImageId\)/);
  assert.match(source, /if \(fallback\) openDetail\(fallback, detailOpener/);
  assert.match(source, /state\.syncImages\(state\.getImages\(\)\.filter/);
  assert.match(source, /if \(elements\.dialogHost\.childElementCount\) return;/);
  assert.match(workbenchCss, /\.detail-form-actions\s*\{[^}]*justify-content:space-between/s);
});

test("library controller has no carousel filter and uses neutral image dimensions", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /featuredFilters/);
  assert.doesNotMatch(source, /setFeaturedFilter\(input\.value\)/);
  assert.doesNotMatch(source, /featuredEligibility/);
  assert.match(source, /detail-dimensions/);
  assert.match(source, /image\.width/);
  assert.match(source, /image\.height/);
});

test("image detail uses a centered responsive modal workspace", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  const adminCss = readFileSync(new URL("../public/assets/admin/admin.css", import.meta.url), "utf8");
  const workbenchCss = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");
  assert.match(source, /admin-detail-workspace/);
  assert.match(source, /admin-detail-dialog/);
  assert.match(source, /detail-preview-pane/);
  assert.match(source, /detail-edit-pane/);
  assert.match(source, /detailOverlay: document\.querySelector\("#admin-detail-overlay"\)/);
  assert.match(source, /event\.target === elements\.detailOverlay[^}]*requestCloseDetail\(\)/s);
  assert.match(workbenchCss, /\.admin-detail-dialog\s*\{[^}]*width:\s*min\(1180px,\s*calc\(100vw - 40px\)\)[^}]*max-height:\s*calc\(100dvh - 40px\)[^}]*overflow:\s*auto/s);
  assert.match(workbenchCss, /#admin-dialog-host \.admin-dialog-backdrop\s*\{[^}]*z-index:\s*90/s);
  assert.match(workbenchCss, /\.admin-detail-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.4fr\)\s+minmax\(320px,\s*1fr\)/s);
  assert.match(workbenchCss, /\.detail-preview-stage\s*\{[^}]*height:\s*min\(68dvh,\s*720px\)/s);
  assert.match(workbenchCss, /\.detail-preview\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain[^}]*object-position:\s*center/s);
  assert.doesNotMatch(source, /detailDrawer|admin-detail-drawer/);
  assert.doesNotMatch(adminCss, /\.admin-drawer/);
  assert.doesNotMatch(workbenchCss, /admin-detail-drawer/);
  assert.match(workbenchCss, /@media \(max-width:900px\)[\s\S]*\.admin-detail-workspace\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(workbenchCss, /@media \(max-width:720px\)[\s\S]*\.admin-detail-overlay\s*\{[^}]*padding:\s*0/);
  assert.match(workbenchCss, /@media \(max-width:720px\)[\s\S]*\.admin-detail-dialog\s*\{[^}]*width:\s*100%[^}]*min-height:\s*100dvh[^}]*max-height:\s*100dvh[^}]*border:\s*0[^}]*border-radius:\s*0/s);
});

test("image detail navigates drafts quickly and saves every edited image", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  const workbenchCss = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");

  assert.match(source, /sequenceIds:\s*state\.visibleImages\(\)\.map/);
  assert.match(source, /className:\s*"detail-preview-nav detail-preview-prev"[^\n]*"aria-label":\s*"上一张"/);
  assert.match(source, /className:\s*"detail-preview-nav detail-preview-next"[^\n]*"aria-label":\s*"下一张"/);
  assert.match(source, /previous\.disabled = navigation\.previousId === null/);
  assert.match(source, /next\.disabled = navigation\.nextId === null/);
  assert.match(source, /function detailNavigationState/);
  assert.match(source, /let detailDrafts = new Map\(\)/);
  assert.match(source, /function captureDetailDraft/);
  assert.match(source, /function navigateDetail[\s\S]*captureActiveDetailDraft\(\)[\s\S]*openDetail\(target/s);
  assert.doesNotMatch(source, /function navigateDetail[\s\S]*confirmDiscardDetailChanges\(\)/s);
  assert.match(source, /detailControls\.save\.textContent = detailSaving[\s\S]*`保存全部（\$\{count\}）`/);
  assert.match(source, /detailControls\.tags\.disabled = detailSaving/);
  assert.match(source, /detailControls\.previous\.disabled = detailSaving/);
  assert.match(source, /const entries = \[\.\.\.detailDrafts\.entries\(\)\]/);
  assert.match(source, /Promise\.all\(entries\.map/);
  assert.match(source, /detailDrafts\.get\(Number\(result\.imageId\)\) === result\.draft[\s\S]*detailDrafts\.delete/s);
  assert.match(source, /confirmDetailAction\(\{[\s\S]*title:\s*"放弃未保存修改"/);
  assert.match(source, /message:\s*`当前有 \$\{detailDraftCount\(\)\} 张图片的信息尚未保存/);
  assert.match(source, /form\.addEventListener\("input",\s*\(\) => captureDetailDraft/);
  assert.match(source, /buildImageVariantUrl\(image\.fileUrl, 1280\)/);
  assert.match(source, /function preloadDetailNeighbors/);
  assert.match(source, /preload\.fetchPriority = "low"/);
  assert.match(source, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(source, /!uploadIsBusy\(\) && !detailDraftsHaveChanges\(\)/);
  assert.match(workbenchCss, /\.detail-preview-nav\s*\{[^}]*position:absolute[^}]*transform:translateY\(-50%\)/s);
  assert.match(workbenchCss, /\.detail-preview-prev\s*\{[^}]*left:12px/s);
  assert.match(workbenchCss, /\.detail-preview-next\s*\{[^}]*right:12px/s);
  assert.match(workbenchCss, /\.detail-position\s*\{[^}]*text-align:right/s);
});

test("image card tag rows wrap instead of clipping assigned tags", () => {
  const workbenchCss = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");
  assert.match(workbenchCss, /\.image-card-tags\s*\{[^}]*flex-wrap:\s*wrap[^}]*overflow:\s*visible/s);
});

test("image workbench enters batch mode before exposing selection controls", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(html, /id="admin-bulk-toggle"/);
  assert.match(html, /id="admin-bulk-toolbar"[^>]*hidden/);
  assert.match(source, /bulkToggle: document\.querySelector\("#admin-bulk-toggle"\)/);
  assert.match(source, /setBulkMode\(!bulkMode\)/);
});

test("image uploads continue in a bounded background task panel", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  const workbenchCss = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");

  assert.match(html, /id="admin-upload-status"[^>]*aria-label="后台上传任务"/);
  assert.match(source, /prepareFile:\s*inspectImageFile/);
  assert.match(source, /startUploadInBackground/);
  assert.match(source, /hideUploadDialog\(\);[\s\S]*runBackgroundUpload\(\)/);
  assert.match(source, /window\.addEventListener\("beforeunload"/);
  assert.match(source, /if \(!uploadIsBusy\(\) && !detailDraftsHaveChanges\(\)\) return;/);
  assert.match(source, /visibleUploadTasks\(tasks, limit = 80\)/);
  assert.match(source, /function scheduleUploadRender\(\)[\s\S]*requestAnimationFrame/);
  assert.match(source, /onChange:\s*scheduleUploadRender/);
  assert.doesNotMatch(source, /Promise\.all\(selected\.map\(\(file\) => measureImageFile/);
  assert.match(workbenchCss, /\.admin-upload-status\s*\{[^}]*position:fixed[^}]*width:min\(440px,calc\(100vw - 36px\)\)/s);
  assert.match(workbenchCss, /\.admin-upload-status-tasks\s*\{[^}]*max-height:min\(360px,46dvh\)[^}]*overflow:auto/s);
  assert.match(workbenchCss, /@media \(max-width:720px\)[\s\S]*\.admin-upload-status\s*\{[^}]*width:calc\(100vw - 16px\)/s);
});

test("image detail exposes copyable identity and direct browse and download URLs", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  const workbenchCss = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");

  for (const label of ["数字 ID", "永久 ID", "SHA-256", "R2 路径", "浏览地址", "下载地址"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(source, /buildDirectImageUrl\(image\.fileUrl\)/);
  assert.match(source, /buildDownloadImageUrl\(image\.fileUrl\)/);
  assert.match(source, /target\s*=\s*"_blank"/);
  assert.match(source, /previewPane\.append\(previewStage, dimensions, technicalInfo\)/);
  assert.match(source, /form\.append\(nameLabel, categoryLabel, tags, error, actions\)/);
  assert.doesNotMatch(source, /form\.append\([^\n]*technicalInfo/);
  assert.match(workbenchCss, /\.detail-preview-pane\s*\{[^}]*display:grid[^}]*align-content:start[^}]*gap:12px/s);
  assert.match(workbenchCss, /\.detail-technical-row\s*\{[^}]*grid-template-columns:82px minmax\(0,1fr\) auto/s);
  assert.match(workbenchCss, /@media \(max-width:720px\)[\s\S]*\.detail-technical-row\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/s);
});
