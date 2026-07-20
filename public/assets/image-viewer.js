import { applyResponsiveImageAttributes } from "./image-variants.js?v=20260720-multilevel-tags";

const SWIPE_THRESHOLD = 48;

export function wrapViewerIndex(index, length) {
  const count = Number(length);
  if (!Number.isInteger(count) || count <= 0) {
    return -1;
  }
  return ((Number(index) % count) + count) % count;
}

function toRelativeUrl(value) {
  return `${value.pathname}${value.search}${value.hash}`;
}

export function buildViewerUrl(currentUrl, imageId) {
  const url = new URL(currentUrl, "https://gallery.invalid");
  url.searchParams.set("image", String(imageId));
  return toRelativeUrl(url);
}

export function clearViewerImageUrl(currentUrl) {
  const url = new URL(currentUrl, "https://gallery.invalid");
  url.searchParams.delete("image");
  return toRelativeUrl(url);
}

export function getViewerKeyAction(key) {
  if (key === "ArrowLeft") return "previous";
  if (key === "ArrowRight") return "next";
  if (key === "Escape") return "close";
  return null;
}

export function getSwipeAction({ startX, startY, endX, endY }) {
  const deltaX = Number(endX) - Number(startX);
  const deltaY = Number(endY) - Number(startY);
  if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) {
    return null;
  }
  return deltaX < 0 ? "next" : "previous";
}

export function getAdjacentImageUrls(images, currentIndex) {
  const items = Array.isArray(images) ? images : [];
  if (items.length <= 1) {
    return [];
  }
  const index = wrapViewerIndex(currentIndex, items.length);
  const candidates = [
    items[wrapViewerIndex(index - 1, items.length)]?.fileUrl,
    items[wrapViewerIndex(index + 1, items.length)]?.fileUrl,
  ];
  const currentUrl = items[index]?.fileUrl;
  return [...new Set(candidates.filter((url) => url && url !== currentUrl))];
}

export function createImageViewer({
  elements,
  getImages,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  locationObject = globalThis.location,
  historyObject = globalThis.history,
  createPreloadImage = () => new Image(),
}) {
  const {
    modal,
    image,
    title,
    tags,
    close: closeButton,
    previous: previousButton,
    next: nextButton,
    counter,
    stage,
  } = elements;
  const preloadedUrls = new Set();
  let currentIndex = -1;
  let opener = null;
  let touchStart = null;

  function items() {
    const value = getImages?.();
    return Array.isArray(value) ? value : [];
  }

  function isOpen() {
    return !modal.classList.contains("hidden");
  }

  function preloadAdjacent(currentItems, index) {
    for (const url of getAdjacentImageUrls(currentItems, index)) {
      if (preloadedUrls.has(url)) continue;
      preloadedUrls.add(url);
      const adjacent = currentItems.find((item) => item?.fileUrl === url);
      if (!adjacent) continue;
      const preloadImage = createPreloadImage();
      applyResponsiveImageAttributes(preloadImage, adjacent, "viewer");
    }
  }

  function updateHistory(mode, imageId) {
    if (mode === "push") {
      historyObject.pushState(
        { ...(historyObject.state ?? {}), galleryViewer: true },
        "",
        buildViewerUrl(locationObject.href, imageId),
      );
    } else if (mode === "replace") {
      historyObject.replaceState(
        historyObject.state,
        "",
        buildViewerUrl(locationObject.href, imageId),
      );
    }
  }

  function showAtIndex(index, { historyMode = "replace" } = {}) {
    const currentItems = items();
    const normalizedIndex = wrapViewerIndex(index, currentItems.length);
    if (normalizedIndex < 0) return false;

    const wasOpen = isOpen();
    const current = currentItems[normalizedIndex];
    const imageName = String(current?.fileName ?? "").trim() || "未命名图片";
    const tagText = (current?.tags ?? []).filter(Boolean).join(" · ");
    currentIndex = normalizedIndex;
    applyResponsiveImageAttributes(image, current, "viewer");
    image.alt = imageName;
    title.textContent = imageName;
    tags.textContent = tagText;
    tags.hidden = !tagText;
    counter.textContent = `${normalizedIndex + 1} / ${currentItems.length}`;
    previousButton.hidden = currentItems.length <= 1;
    nextButton.hidden = currentItems.length <= 1;
    modal.classList.remove("hidden");
    documentObject.documentElement.classList.add("viewer-open");
    updateHistory(historyMode, current.id);
    preloadAdjacent(currentItems, normalizedIndex);
    if (!wasOpen) closeButton.focus({ preventScroll: true });
    return true;
  }

  function hideViewer({ restoreFocus = true } = {}) {
    const wasOpen = isOpen();
    modal.classList.add("hidden");
    documentObject.documentElement.classList.remove("viewer-open");
    image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.removeAttribute("width");
    image.removeAttribute("height");
    currentIndex = -1;
    touchStart = null;
    if (wasOpen && restoreFocus && opener?.focus) {
      opener.focus({ preventScroll: true });
    }
    opener = null;
  }

  function openById(imageId, { opener: nextOpener = null, historyMode = "push" } = {}) {
    const index = items().findIndex((item) => String(item?.id) === String(imageId));
    if (index < 0) return false;
    opener = nextOpener;
    return showAtIndex(index, { historyMode });
  }

  function move(offset) {
    if (!isOpen() || currentIndex < 0 || items().length <= 1) return false;
    return showAtIndex(currentIndex + offset, { historyMode: "replace" });
  }

  function close() {
    if (!isOpen()) return;
    const shouldGoBack = historyObject.state?.galleryViewer === true;
    hideViewer();
    if (shouldGoBack) {
      historyObject.back();
    } else {
      historyObject.replaceState(
        historyObject.state,
        "",
        clearViewerImageUrl(locationObject.href),
      );
    }
  }

  function syncFromUrl() {
    const imageId = new URL(locationObject.href).searchParams.get("image");
    if (!imageId) {
      hideViewer();
      return false;
    }
    const opened = openById(imageId, { historyMode: "none" });
    if (!opened) {
      hideViewer();
      historyObject.replaceState(
        historyObject.state,
        "",
        clearViewerImageUrl(locationObject.href),
      );
    }
    return opened;
  }

  function perform(action) {
    if (action === "previous") return move(-1);
    if (action === "next") return move(1);
    if (action === "close") {
      close();
      return true;
    }
    return false;
  }

  function onKeydown(event) {
    if (!isOpen()) return;
    const action = getViewerKeyAction(event.key);
    if (!action) return;
    event.preventDefault();
    perform(action);
  }

  function onTouchStart(event) {
    if (!isOpen() || event.touches?.length !== 1) {
      touchStart = null;
      return;
    }
    touchStart = {
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
    };
  }

  function onTouchEnd(event) {
    const point = event.changedTouches?.[0];
    if (!touchStart || !point) return;
    const action = getSwipeAction({
      ...touchStart,
      endX: point.clientX,
      endY: point.clientY,
    });
    touchStart = null;
    if (action) perform(action);
  }

  function onBackdropClick(event) {
    if (event.target === modal) close();
  }

  function bindCards(root) {
    root?.querySelectorAll?.("[data-image-id]").forEach((card) => {
      const trigger = card.querySelector?.("[data-action='open-image']");
      trigger?.addEventListener("click", () => {
        openById(card.dataset.imageId, { opener: trigger });
      });
    });
  }

  const onPreviousClick = () => move(-1);
  const onNextClick = () => move(1);
  const onCloseClick = () => close();
  const onPopState = () => syncFromUrl();
  previousButton.addEventListener("click", onPreviousClick);
  nextButton.addEventListener("click", onNextClick);
  closeButton.addEventListener("click", onCloseClick);
  modal.addEventListener("click", onBackdropClick);
  stage.addEventListener("touchstart", onTouchStart);
  stage.addEventListener("touchend", onTouchEnd);
  windowObject.addEventListener("keydown", onKeydown);
  windowObject.addEventListener("popstate", onPopState);

  function destroy() {
    previousButton.removeEventListener("click", onPreviousClick);
    nextButton.removeEventListener("click", onNextClick);
    closeButton.removeEventListener("click", onCloseClick);
    modal.removeEventListener("click", onBackdropClick);
    stage.removeEventListener("touchstart", onTouchStart);
    stage.removeEventListener("touchend", onTouchEnd);
    windowObject.removeEventListener("keydown", onKeydown);
    windowObject.removeEventListener("popstate", onPopState);
    hideViewer({ restoreFocus: false });
  }

  return { bindCards, syncFromUrl, openById, close, destroy };
}
