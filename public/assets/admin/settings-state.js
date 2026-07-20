import { ordersEqual, serializeOrder } from "./sort-order.js";

const TYPES = new Set(["tags", "tagGroups", "categories"]);

function assertType(type) {
  if (!TYPES.has(type)) {
    throw new TypeError(`Unknown settings type: ${type}`);
  }
}

function copyItems(items) {
  return Array.isArray(items) ? [...items] : [];
}

export function createSettingsState(initial = {}) {
  const server = {
    tags: copyItems(initial.tags),
    tagGroups: copyItems(initial.tagGroups),
    categories: copyItems(initial.categories),
  };
  const drafts = {
    tags: copyItems(server.tags),
    tagGroups: copyItems(server.tagGroups),
    categories: copyItems(server.categories),
  };

  function updateBoth(type, update) {
    assertType(type);
    server[type] = update(server[type]);
    drafts[type] = update(drafts[type]);
  }

  return {
    getItems(type) {
      assertType(type);
      return drafts[type];
    },
    setDraft(type, items) {
      assertType(type);
      drafts[type] = copyItems(items);
    },
    commitDraft(type, items = drafts[type]) {
      assertType(type);
      server[type] = copyItems(items);
      drafts[type] = copyItems(items);
    },
    resetDraft(type) {
      assertType(type);
      drafts[type] = copyItems(server[type]);
    },
    replaceItem(type, item) {
      updateBoth(type, (items) => items.map((current) => current.id === item.id ? item : current));
    },
    appendItem(type, item) {
      updateBoth(type, (items) => [...items, item]);
    },
    removeItem(type, id) {
      updateBoth(type, (items) => items.filter((item) => item.id !== id));
    },
    isDirty(type) {
      assertType(type);
      return !ordersEqual(server[type], drafts[type]);
    },
    serialize(type) {
      assertType(type);
      return serializeOrder(drafts[type]);
    },
  };
}
