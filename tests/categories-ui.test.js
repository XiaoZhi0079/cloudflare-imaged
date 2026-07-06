import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("upload page includes a required main category selector", () => {
  const html = readFileSync(new URL("../public/admin/upload.html", import.meta.url), "utf8");

  assert.match(html, /主分类/);
  assert.match(html, /id="upload-category"/);
  assert.match(html, /admin-categories\.js/);
});

test("tags page includes a category management panel", () => {
  const html = readFileSync(new URL("../public/admin/tags.html", import.meta.url), "utf8");

  assert.match(html, /分类管理/);
  assert.match(html, /id="new-category-name"/);
  assert.match(html, /id="new-category-directory"/);
  assert.match(html, /id="create-category"/);
  assert.match(html, /id="category-list"/);
  assert.match(html, /admin-categories\.js/);
});

test("category helper script manages uploads and taxonomy editing", () => {
  const js = readFileSync(new URL("../public/assets/admin-categories.js", import.meta.url), "utf8");

  assert.match(js, /const createCategoryButton = \$\("#create-category"\);/);
  assert.match(js, /const uploadCategorySelect = \$\("#upload-category"\);/);
  assert.match(js, /let categories = \[\];/);
  assert.match(js, /async function loadCategories\(/);
  assert.match(js, /function renderUploadCategoryOptions\(/);
  assert.match(js, /function installUploadFetchWrapper\(/);
});
