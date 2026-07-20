import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("settings page combines tag groups and tags into one taxonomy tab", () => {
  const html = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(html, /data-settings-tab="tags"/);
  assert.doesNotMatch(html, /data-settings-tab="tagGroups"/);
  assert.match(html, /data-settings-tab="categories"/);
  assert.match(html, /id="tag-group-create"/);
  assert.match(html, /id="tag-group-count"/);
  assert.match(html, /id="taxonomy-list"/);
  assert.match(html, /id="taxonomy-save-order"/);
  assert.match(html, /settings-page\.js/);
});

test("admin layout keeps settings pages wide and segment tabs stable", () => {
  const settingsCss = readFileSync(new URL("../public/assets/admin/settings.css", import.meta.url), "utf8");
  const adminCss = readFileSync(new URL("../public/assets/admin/admin.css", import.meta.url), "utf8");
  assert.match(settingsCss, /\.settings-page\s*\{[^}]*width:min\(1500px,100%\)/s);
  assert.match(settingsCss, /\.admin-segments\s*\{[^}]*width:min\(480px,100%\)[^}]*display:flex/s);
  assert.match(settingsCss, /\.admin-segments button\s*\{[^}]*flex:1[^}]*align-items:center[^}]*justify-content:center/s);
  assert.match(settingsCss, /\.settings-heading-actions button\s*\{[^}]*display:inline-flex[^}]*align-items:center[^}]*justify-content:center/s);
  assert.match(adminCss, /\.admin-nav a\s*\{[^}]*min-height:44px[^}]*font-size:15px/s);
});
