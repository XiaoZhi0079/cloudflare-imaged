import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsState } from "../public/assets/admin/settings-state.js";
import {
  renderTagTreeGroup,
  renderTagTreeTag,
  renderTaxonomyItem,
} from "../public/assets/admin/renderers/taxonomy-item.js";

test("settings state keeps server and draft orders separately", () => {
  const state = createSettingsState({ tags: [{ id: 1 }, { id: 2 }], tagGroups: [{ id: 5 }, { id: 6 }], categories: [{ id: 3 }, { id: 4 }] });
  state.setDraft("tags", [{ id: 2 }, { id: 1 }]);
  assert.equal(state.isDirty("tags"), true);
  assert.equal(state.isDirty("categories"), false);
  state.setDraft("tagGroups", [{ id: 6 }, { id: 5 }]);
  assert.deepEqual(state.serialize("tagGroups"), [{ id: 6, sortOrder: 1 }, { id: 5, sortOrder: 2 }]);
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
  const tag = renderTaxonomyItem({ id: 1, name: '<script>', sortOrder: 1, isVisible: true, group: { name: "人物" } }, "tags");
  const tagGroup = renderTaxonomyItem({ id: 3, name: "人物", tagCount: 2, sortOrder: 1 }, "tagGroups");
  const category = renderTaxonomyItem({ id: 2, name: "风景", directorySlug: "scenery", sortOrder: 1 }, "categories");
  assert.doesNotMatch(tag, /<script>/);
  assert.match(tag, /data-action="toggle-visibility"/);
  assert.match(tag, /data-action="delete"/);
  assert.match(tag, /data-action="move-up"[^>]*aria-label="上移/);
  assert.match(tag, /data-action="move-down"[^>]*aria-label="下移/);
  assert.match(tag, /人物/);
  assert.match(tagGroup, /2 个标签/);
  assert.match(tagGroup, /data-action="delete"/);
  assert.match(category, /scenery/);
  assert.doesNotMatch(category, /data-action="delete"/);
});

test("tag tree renderer nests draggable tags under expandable groups", () => {
  const tag = { id: 7, name: '<bad "tag">', groupId: 3, isVisible: true };
  const child = renderTagTreeTag(tag);
  const group = renderTagTreeGroup({ id: 3, name: "人物", sortOrder: 1 }, [tag], { expanded: false });

  assert.match(child, /draggable="true"/);
  assert.match(child, /data-tag-id="7"/);
  assert.match(child, /data-source-group-id="3"/);
  assert.doesNotMatch(child, /<bad/);
  assert.match(group, /data-tag-drop-zone="3"/);
  assert.match(group, /data-action="toggle-group"[^>]*aria-expanded="false"/);
  assert.match(group, /class="tag-tree-children" hidden/);
  assert.match(group, /data-action="add-tag"/);
});
