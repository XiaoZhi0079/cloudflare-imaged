export function getTargetIndex({ dragTop, step, itemCount }) {
  if (!Number.isFinite(step) || step <= 0 || itemCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(itemCount - 1, Math.round(dragTop / step)));
}

export function hasExceededDragThreshold({ startX, startY, x, y, threshold = 4 }) {
  return Math.hypot(x - startX, y - startY) >= threshold;
}

export function moveItem(items, fromIndex, toIndex) {
  if (fromIndex === toIndex) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function ordersEqual(left, right) {
  return left.length === right.length
    && left.every((item, index) => Number(item.id) === Number(right[index].id));
}

export function serializeOrder(items) {
  return items.map((item, index) => ({
    id: Number(item.id),
    sortOrder: index + 1,
  }));
}
