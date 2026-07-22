import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("settings page presents tag and category management in one workspace", () => {
  const html = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-settings-tab|role="tablist"/);
  assert.match(html, /id="tag-group-create"/);
  assert.match(html, /id="taxonomy-create"/);
  assert.match(html, /id="category-create"/);
  assert.match(html, /id="tag-group-count"/);
  assert.match(html, /id="tag-count"/);
  assert.match(html, /id="category-count"/);
  assert.match(html, /id="tag-taxonomy-list"/);
  assert.match(html, /id="category-taxonomy-list"/);
  assert.match(html, /id="tag-taxonomy-save-order"/);
  assert.match(html, /id="category-taxonomy-save-order"/);
  assert.match(html, /settings-page\.js/);

  const overview = html.match(/<div class="settings-overview"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  assert.match(overview, /<span>目录<\/span><strong id="category-count">/);
  assert.ok(overview.indexOf('id="category-count"') < overview.indexOf('id="tag-group-count"'));
  assert.ok(overview.indexOf('id="tag-group-count"') < overview.indexOf('id="tag-count"'));
  assert.doesNotMatch(html, /主分类/);
});

test("admin layout keeps the unified taxonomy workspace wide and stable", () => {
  const settingsCss = readFileSync(new URL("../public/assets/admin/settings.css", import.meta.url), "utf8");
  const adminCss = readFileSync(new URL("../public/assets/admin/admin.css", import.meta.url), "utf8");
  assert.match(settingsCss, /\.settings-page\s*\{[^}]*width:min\(1500px,100%\)/s);
  assert.match(settingsCss, /\.settings-overview\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/s);
  assert.match(settingsCss, /\.settings-overview-item\s*\{[^}]*align-items:center/s);
  assert.match(settingsCss, /\.settings-taxonomy-section-heading\s*\{[^}]*justify-content:space-between/s);
  assert.match(settingsCss, /\.settings-heading-actions button\s*\{[^}]*display:inline-flex[^}]*align-items:center[^}]*justify-content:center/s);
  assert.doesNotMatch(settingsCss, /\.admin-segments/);
  assert.match(adminCss, /\.admin-nav a\s*\{[^}]*min-height:44px[^}]*font-size:15px/s);
});

test("settings controller renders both lists and saves their orders independently", () => {
  const source = readFileSync(new URL("../public/assets/admin/settings-page.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /activeType|data-settings-tab|elements\.tabs/);
  assert.match(source, /tagList:\s*document\.querySelector\("#tag-taxonomy-list"\)/);
  assert.match(source, /categoryList:\s*document\.querySelector\("#category-taxonomy-list"\)/);
  assert.match(source, /renderTags\(\);\s*renderCategories\(\);/s);
  assert.match(source, /tagSave\.addEventListener\("click",\s*\(\) => saveOrder\("tagGroups"\)\)/);
  assert.match(source, /categorySave\.addEventListener\("click",\s*\(\) => saveOrder\("categories"\)\)/);
});
