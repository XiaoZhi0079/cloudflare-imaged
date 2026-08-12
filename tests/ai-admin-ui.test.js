import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("AI proposal admin distinguishes filtered no-change results from reviewable diffs", () => {
  const html = readFileSync(new URL("../public/admin/ai.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../public/assets/admin/ai-page.js", import.meta.url), "utf8");

  assert.match(html, /id="ai-no-change-count"/);
  assert.match(html, /只有名称、目录或标签确实发生变化的图片才需要人工审核/);
  assert.match(source, /proposal\.changes\?\.fileName/);
  assert.match(source, /addedIds/);
  assert.match(source, /removedIds/);
  assert.match(source, /payload\.summary\?\.noChangeCount/);
});
