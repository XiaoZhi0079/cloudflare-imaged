import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsState } from "../public/assets/admin/settings-state.js";
import { renderTaxonomyItem } from "../public/assets/admin/renderers/taxonomy-item.js";

test("settings state keeps server and draft orders separately", () => {
  const state = createSettingsState({ tags: [{ id: 1 }, { id: 2 }], categories: [{ id: 3 }, { id: 4 }] });
  state.setDraft("tags", [{ id: 2 }, { id: 1 }]);
  assert.equal(state.isDirty("tags"), true);
  assert.equal(state.isDirty("categories"), false);
  assert.deepEqual(state.serialize("tags"), [{ id: 2, sortOrder: 1 }, { id: 1, sortOrder: 2 }]);
  state.resetDraft("tags");
  assert.equal(state.isDirty("tags"), false);
});

test("settings state replaces appends and removes records", () => {
  const state = createSettingsState({ tags: [{ id: 1, name: "A" }], categories: [] });
  state.appendItem("tags", { id: 2, name: "B" });
  state.replaceItem("tags", { id: 2, name: "BB" });
  state.removeItem("tags", 1);
  assert.deepEqual(state.getItems("tags"), [{ id: 2, name: "BB" }]);
});

test("taxonomy renderer escapes text and limits category actions", () => {
  const tag = renderTaxonomyItem({ id: 1, name: '<script>', sortOrder: 1, isVisible: true }, "tags");
  const category = renderTaxonomyItem({ id: 2, name: "风景", directorySlug: "scenery", sortOrder: 1 }, "categories");
  assert.doesNotMatch(tag, /<script>/);
  assert.match(tag, /data-action="toggle-visibility"/);
  assert.match(tag, /data-action="delete"/);
  assert.match(tag, /data-action="move-up"[^>]*aria-label="上移/);
  assert.match(tag, /data-action="move-down"[^>]*aria-label="下移/);
  assert.match(category, /scenery/);
  assert.doesNotMatch(category, /data-action="delete"/);
});
