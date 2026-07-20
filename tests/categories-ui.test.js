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
