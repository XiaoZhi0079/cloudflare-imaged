import test from "node:test";
import assert from "node:assert/strict";

import {
  getDefaultVisibleTag,
  normalizeTagName,
  slugifyTagName,
  sortVisibleTags,
} from "../src/shared/tag-utils.js";

test("slugifyTagName lowercases latin text and replaces spaces with hyphens", () => {
  assert.equal(slugifyTagName("Short Hair Beauty"), "short-hair-beauty");
});

test("slugifyTagName preserves cjk text while collapsing separators", () => {
  assert.equal(slugifyTagName("  日本 美女  "), "日本-美女");
});

test("normalizeTagName trims surrounding whitespace", () => {
  assert.equal(normalizeTagName("  校园风情 "), "校园风情");
});

test("sortVisibleTags removes hidden tags and orders by sort_order then name", () => {
  const tags = [
    { id: 1, name: "欧美美女", slug: "oumei", sort_order: 3, is_visible: 1 },
    { id: 2, name: "田园景色", slug: "tianyuan", sort_order: 1, is_visible: 1 },
    { id: 3, name: "隐藏分类", slug: "hidden", sort_order: 0, is_visible: 0 },
    { id: 4, name: "日本美女", slug: "riben", sort_order: 1, is_visible: 1 },
  ];

  assert.deepEqual(
    sortVisibleTags(tags).map((tag) => tag.slug),
    ["riben", "tianyuan", "oumei"],
  );
});

test("getDefaultVisibleTag returns the first visible sorted tag", () => {
  const tags = [
    { name: "短发美女", slug: "duanfa", sort_order: 5, is_visible: 1 },
    { name: "校园风情", slug: "campus", sort_order: 1, is_visible: 1 },
  ];

  assert.deepEqual(getDefaultVisibleTag(tags), tags[1]);
});
