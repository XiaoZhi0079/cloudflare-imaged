import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createLibraryState,
  filterImages,
} from "../public/assets/admin/library-state.js";
import { renderImageCard } from "../public/assets/admin/renderers/image-card.js";

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

test("library featured filter trusts nested eligibility and composes with search and tags", () => {
  assert.deepEqual(
    filterImages(featuredImages, { featured: "eligible" }).map((image) => image.id),
    [10, 11],
  );
  assert.deepEqual(
    filterImages(featuredImages, { featured: "4k" }).map((image) => image.id),
    [11],
  );
  assert.deepEqual(
    filterImages(featuredImages, {
      query: "NATURE",
      tagNames: new Set(["自然光", "精选"]),
      featured: "4k",
    }).map((image) => image.id),
    [11],
  );
  assert.deepEqual(
    filterImages(featuredImages, { featured: "eligible" }).includes(featuredImages[3]),
    false,
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

test("library state manages featured eligibility alongside other filters and reset", () => {
  const state = createLibraryState({ initialRenderLimit: 1, renderIncrement: 10 });
  state.setImages(featuredImages);
  state.showMore();
  state.setFeaturedFilter("eligible");
  assert.equal(state.getFilters().featured, "eligible");
  assert.deepEqual(state.visibleImages().map((image) => image.id), [11, 10]);
  assert.equal(state.renderedImages().length, 1);

  state.setQuery("nature");
  state.setTagsFilter(new Set(["精选"]));
  state.setFeaturedFilter("4k");
  assert.deepEqual(state.visibleImages().map((image) => image.id), [11]);

  state.setFeaturedFilter("unsupported");
  assert.equal(state.getFilters().featured, "all");
  state.resetFilters();
  assert.deepEqual(state.getFilters(), {
    query: "",
    tagNames: new Set(),
    sort: "newest",
    featured: "all",
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
  }, { selected: true });

  assert.doesNotMatch(html, /<bad/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /data-action="toggle-selection"/);
  assert.match(html, /data-action="open-detail"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /人像/);
  assert.doesNotMatch(html, />三</);
});

test("image card includes a fallback when no preview URL exists", () => {
  const html = renderImageCard({ id: 9, fileName: "missing.webp", fileUrl: "", tags: [] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /image-preview-fallback/);
});

test("image card shows trusted featured dimensions, eligibility, and quality", () => {
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

  assert.match(html, /3840×2160/);
  assert.match(html, /轮播可用/);
  assert.match(html, />4K</);
  assert.match(html, /is-4k/);
});

test("image card shows ineligible reason and safe unknown fallbacks", () => {
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
  assert.match(invalidHtml, /1600×900/);
  assert.match(invalidHtml, /分辨率不足/);
  assert.match(invalidHtml, /is-invalid/);

  const unknownHtml = renderImageCard({ id: 13, fileName: "unknown.webp", tags: [] });
  assert.match(unknownHtml, /尺寸未知/);
});

test("image card escapes every server-provided featured label", () => {
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
  assert.match(html, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  assert.match(html, /&lt;b class=&quot;bad&quot;&gt;4K&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
});

test("library controller connects detail and bulk API operations", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/admin\/images"/);
  assert.match(source, /\/api\/admin\/images\/tag-assignments"/);
  assert.match(source, /\/api\/admin\/images\/tag-assignments\/bulk/);
  assert.match(source, /\/api\/admin\/images\/category-assignments\/bulk/);
  assert.match(source, /\/api\/admin\/images\/bulk-delete/);
});

test("library controller connects featured radios and safe detail dimensions", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(source, /featuredFilters/);
  assert.match(source, /setFeaturedFilter\(input\.value\)/);
  assert.match(source, /detail-dimensions/);
  assert.match(source, /featuredEligibility/);
});
