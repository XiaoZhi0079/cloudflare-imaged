import {
  getTargetIndex,
  hasExceededDragThreshold,
  moveItem,
} from "./sort-order.js";

const DEFAULT_ROW_SELECTOR = "[data-sort-id]";
const DEFAULT_HANDLE_SELECTOR = "[data-sort-handle]";

function itemId(item) {
  return String(item.id);
}

export function createSortableList({
  container,
  getItems,
  setItems,
  onChange = () => {},
  rowSelector = DEFAULT_ROW_SELECTOR,
  handleSelector = DEFAULT_HANDLE_SELECTOR,
  threshold = 4,
}) {
  if (!container || typeof getItems !== "function" || typeof setItems !== "function") {
    throw new TypeError("container, getItems, and setItems are required");
  }

  let pending = null;
  let drag = null;

  function rowsById() {
    return new Map(
      [...container.querySelectorAll(rowSelector)].map((row) => [String(row.dataset.sortId), row]),
    );
  }

  function prepareSlots() {
    const rows = [...container.querySelectorAll(rowSelector)];
    const containerRect = container.getBoundingClientRect();
    const rects = rows.map((row) => row.getBoundingClientRect());
    const rowHeight = rects[0]?.height ?? 1;
    const step = rects.length > 1 ? rects[1].top - rects[0].top : rowHeight;
    const left = (rects[0]?.left ?? containerRect.left) - containerRect.left;
    const width = rects[0]?.width ?? containerRect.width;

    container.style.height = `${Math.max(rowHeight, rects.at(-1)?.bottom - containerRect.top)}px`;
    container.classList.add("is-sorting");
    rows.forEach((row, index) => {
      row.style.position = "absolute";
      row.style.inset = "auto";
      row.style.top = "0";
      row.style.left = `${left}px`;
      row.style.width = `${width}px`;
      row.style.transform = `translate3d(0, ${index * step}px, 0)`;
      row.style.willChange = "transform";
    });

    return { containerRect, rowHeight, step };
  }

  function positionRows(items, dragTop = null) {
    const map = rowsById();
    items.forEach((item, index) => {
      const row = map.get(itemId(item));
      if (!row) return;
      const y = drag?.id === itemId(item) && dragTop !== null ? dragTop : index * drag.step;
      row.style.transform = `translate3d(0, ${y}px, 0)`;
    });
  }

  function beginDrag(event) {
    const row = pending.handle.closest(rowSelector);
    const items = [...getItems()];
    const index = items.findIndex((item) => itemId(item) === String(row.dataset.sortId));
    if (index < 0) return;

    const geometry = prepareSlots();
    drag = {
      id: String(row.dataset.sortId),
      handle: pending.handle,
      pointerId: event.pointerId,
      startItems: items,
      listTop: geometry.containerRect.top,
      pointerOffset: pending.startY - row.getBoundingClientRect().top,
      rowHeight: geometry.rowHeight,
      step: geometry.step,
      top: index * geometry.step,
    };
    pending = null;
    row.classList.add("is-dragging");
    drag.handle.setAttribute("aria-grabbed", "true");
    document.body.classList.add("is-sorting");
    positionRows(items, drag.top);
    onChange(items, { phase: "start" });
  }

  function updateDrag(event) {
    const items = [...getItems()];
    const maxTop = (items.length - 1) * drag.step;
    drag.top = Math.max(0, Math.min(maxTop, event.clientY - drag.listTop - drag.pointerOffset));
    const fromIndex = items.findIndex((item) => itemId(item) === drag.id);
    const targetIndex = getTargetIndex({ dragTop: drag.top, step: drag.step, itemCount: items.length });
    const next = fromIndex === targetIndex ? items : moveItem(items, fromIndex, targetIndex);
    if (next !== items) {
      setItems(next);
      onChange(next, { phase: "preview" });
    }
    positionRows(next, drag.top);
  }

  function resetInlineStyles(items) {
    const map = rowsById();
    items.forEach((item) => {
      const row = map.get(itemId(item));
      if (row) container.append(row);
    });
    for (const row of map.values()) {
      row.classList.remove("is-dragging");
      row.style.position = "";
      row.style.inset = "";
      row.style.top = "";
      row.style.left = "";
      row.style.width = "";
      row.style.transform = "";
      row.style.willChange = "";
    }
    container.style.height = "";
    container.classList.remove("is-sorting");
    document.body.classList.remove("is-sorting");
  }

  function finishDrag({ cancel = false } = {}) {
    if (!drag) return;
    const active = drag;
    const items = cancel ? active.startItems : [...getItems()];
    drag = null;
    pending = null;
    setItems(items);
    active.handle.setAttribute("aria-grabbed", "false");
    resetInlineStyles(items);
    if (active.handle.hasPointerCapture(active.pointerId)) {
      active.handle.releasePointerCapture(active.pointerId);
    }
    active.handle.focus();
    onChange(items, { phase: cancel ? "cancel" : "end" });
  }

  function onPointerDown(event) {
    const handle = event.target.closest(handleSelector);
    if (!handle || !container.contains(handle) || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("aria-grabbed", "false");
    pending = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function onPointerMove(event) {
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      updateDrag(event);
      return;
    }
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (hasExceededDragThreshold({
      startX: pending.startX,
      startY: pending.startY,
      x: event.clientX,
      y: event.clientY,
      threshold,
    })) {
      beginDrag(event);
    }
  }

  function onPointerUp(event) {
    if (drag?.pointerId === event.pointerId) {
      finishDrag();
    } else if (pending?.pointerId === event.pointerId) {
      if (pending.handle.hasPointerCapture(event.pointerId)) {
        pending.handle.releasePointerCapture(event.pointerId);
      }
      pending = null;
    }
  }

  function onPointerCancel(event) {
    if (drag?.pointerId === event.pointerId) finishDrag({ cancel: true });
    pending = null;
  }

  function onLostPointerCapture(event) {
    if (drag?.pointerId === event.pointerId) finishDrag({ cancel: true });
    if (pending?.pointerId === event.pointerId) pending = null;
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && drag) finishDrag({ cancel: true });
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("lostpointercapture", onLostPointerCapture);
  document.addEventListener("keydown", onKeyDown);

  return {
    cancel() {
      finishDrag({ cancel: true });
    },
    destroy() {
      finishDrag({ cancel: true });
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("lostpointercapture", onLostPointerCapture);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
