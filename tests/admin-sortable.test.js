import test from "node:test";
import assert from "node:assert/strict";

import {
  getTargetIndex,
  hasExceededDragThreshold,
  moveItem,
  ordersEqual,
  serializeOrder,
} from "../public/assets/admin/sort-order.js";

test("drag target changes only after crossing a slot midpoint", () => {
  assert.equal(getTargetIndex({ dragTop: 33, step: 68, itemCount: 5 }), 0);
  assert.equal(getTargetIndex({ dragTop: 35, step: 68, itemCount: 5 }), 1);
  assert.equal(getTargetIndex({ dragTop: 999, step: 68, itemCount: 5 }), 4);
});

test("drag activation requires four pixels of movement", () => {
  assert.equal(hasExceededDragThreshold({ startX: 10, startY: 10, x: 12, y: 13, threshold: 4 }), false);
  assert.equal(hasExceededDragThreshold({ startX: 10, startY: 10, x: 14, y: 10, threshold: 4 }), true);
});

test("moving down and back restores the original order", () => {
  const original = [1, 2, 3, 4, 5];
  const moved = moveItem(original, 1, 4);
  assert.deepEqual(moved, [1, 3, 4, 5, 2]);
  assert.deepEqual(moveItem(moved, 4, 1), original);
});

test("order helpers compare ids and serialize contiguous positions", () => {
  const original = [{ id: 4 }, { id: 9 }];
  assert.equal(ordersEqual(original, [{ id: 4 }, { id: 9 }]), true);
  assert.equal(ordersEqual(original, [{ id: 9 }, { id: 4 }]), false);
  assert.deepEqual(serializeOrder(original), [
    { id: 4, sortOrder: 1 },
    { id: 9, sortOrder: 2 },
  ]);
});
