import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("settings page owns tag and category management", () => {
  const html = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(html, /data-settings-tab="tags"/);
  assert.match(html, /data-settings-tab="tagGroups"/);
  assert.match(html, /data-settings-tab="categories"/);
  assert.match(html, /id="taxonomy-list"/);
  assert.match(html, /id="taxonomy-save-order"/);
  assert.match(html, /settings-page\.js/);
});
