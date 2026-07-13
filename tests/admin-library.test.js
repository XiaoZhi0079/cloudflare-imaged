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

test("library filters require every tag and the selected category", () => {
  assert.deepEqual(
    filterImages(images, { query: "", tagNames: new Set(["人像", "自然光"]), categoryId: 3 }),
    [images[0]],
  );
  assert.deepEqual(
    filterImages(images, { query: "NATURE", tagNames: new Set(), categoryId: null }),
    [images[2]],
  );
});

test("library selection survives filtering and drops removed image ids", () => {
  const state = createLibraryState();
  state.setImages(images);
  state.toggleSelection(2);
  state.setCategory(3);
  assert.deepEqual([...state.getSelectedIds()], [2]);
  assert.deepEqual(state.visibleImages().map((image) => image.id), [3, 1]);
  state.syncImages(images.filter((image) => image.id !== 2));
  assert.deepEqual([...state.getSelectedIds()], []);
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
  assert.doesNotMatch(html, />三</);
});

test("image card includes a fallback when no preview URL exists", () => {
  const html = renderImageCard({ id: 9, fileName: "missing.webp", fileUrl: "", tags: [] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /image-preview-fallback/);
});

test("library controller connects detail and bulk API operations", () => {
  const source = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(source, /\/api\/admin\/images"/);
  assert.match(source, /\/api\/admin\/images\/tag-assignments"/);
  assert.match(source, /\/api\/admin\/images\/tag-assignments\/bulk/);
  assert.match(source, /\/api\/admin\/images\/category-assignments\/bulk/);
  assert.match(source, /\/api\/admin\/images\/bulk-delete/);
});
