import { applyResponsiveImageAttributes, buildImageVariantUrl } from "./image-variants.js?v=20260728-image-delivery";

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

  function setLoadingPreview(url) {
    const previewUrl = String(url ?? "").trim();
    stage.classList.toggle("has-preview", Boolean(previewUrl));
    stage.classList.add("is-loading");
    stage.classList.remove("is-error");
    stage.setAttribute("aria-busy", "true");
    stage.style.backgroundImage = previewUrl ? `url(${JSON.stringify(previewUrl)})` : "";
  }

  function clearLoadingPreview({ failed = false } = {}) {
    stage.classList.remove("is-loading");
    stage.classList.toggle("is-error", failed);
    stage.setAttribute("aria-busy", "false");
    if (!failed) {
      stage.classList.remove("has-preview");
      stage.style.removeProperty("background-image");
    }
  }

  function preloadOne(item) {
    const url = item?.fileUrl;
    if (!url || preloadedUrls.has(url)) return;
    preloadedUrls.add(url);
    const preloadImage = createPreloadImage();
    preloadImage.fetchPriority = "low";
    applyResponsiveImageAttributes(preloadImage, item, "viewer");
  }

  function preloadAdjacent(currentItems, index) {
    for (const url of getAdjacentImageUrls(currentItems, index)) {
      const adjacent = currentItems.find((item) => item?.fileUrl === url);
      preloadOne(adjacent);
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

  function showAtIndex(index, { historyMode = "replace", previewUrl = "" } = {}) {
    const currentItems = items();
    const normalizedIndex = wrapViewerIndex(index, currentItems.length);
    if (normalizedIndex < 0) return false;

    const wasOpen = isOpen();
    const current = currentItems[normalizedIndex];
    const imageName = String(current?.fileName ?? "").trim() || "未命名图片";
    const tagText = (current?.tags ?? []).filter(Boolean).join(" · ");
    currentIndex = normalizedIndex;
    setLoadingPreview(previewUrl || buildImageVariantUrl(current.fileUrl, 640));
    image.fetchPriority = "high";
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
    clearLoadingPreview();
    currentIndex = -1;
    touchStart = null;
    if (wasOpen && restoreFocus && opener?.focus) {
      opener.focus({ preventScroll: true });
    }
    opener = null;
  }

  function openById(imageId, { opener: nextOpener = null, historyMode = "push", previewUrl = "" } = {}) {
    const index = items().findIndex((item) => String(item?.id) === String(imageId));
    if (index < 0) return false;
    opener = nextOpener;
    return showAtIndex(index, { historyMode, previewUrl });
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
      if (!trigger || trigger.dataset.viewerBound === "true") return;
      trigger.dataset.viewerBound = "true";
      const warm = () => preloadOne(items().find((item) => String(item?.id) === String(card.dataset.imageId)));
      trigger.addEventListener("pointerenter", warm, { once: true });
      trigger.addEventListener("focus", warm, { once: true });
      trigger.addEventListener("pointerdown", warm, { once: true });
      trigger.addEventListener("click", () => {
        const preview = card.querySelector?.("img");
        openById(card.dataset.imageId, {
          opener: trigger,
          previewUrl: preview?.currentSrc || preview?.src || "",
        });
      });
    });
  }

  const onPreviousClick = () => move(-1);
  const onNextClick = () => move(1);
  const onCloseClick = () => close();
  const onPopState = () => syncFromUrl();
  const onImageLoad = () => clearLoadingPreview();
  const onImageError = () => clearLoadingPreview({ failed: true });
  previousButton.addEventListener("click", onPreviousClick);
  nextButton.addEventListener("click", onNextClick);
  closeButton.addEventListener("click", onCloseClick);
  modal.addEventListener("click", onBackdropClick);
  stage.addEventListener("touchstart", onTouchStart);
  stage.addEventListener("touchend", onTouchEnd);
  image.addEventListener("load", onImageLoad);
  image.addEventListener("error", onImageError);
  windowObject.addEventListener("keydown", onKeydown);
  windowObject.addEventListener("popstate", onPopState);

  function destroy() {
    previousButton.removeEventListener("click", onPreviousClick);
    nextButton.removeEventListener("click", onNextClick);
    closeButton.removeEventListener("click", onCloseClick);
    modal.removeEventListener("click", onBackdropClick);
    stage.removeEventListener("touchstart", onTouchStart);
    stage.removeEventListener("touchend", onTouchEnd);
    image.removeEventListener("load", onImageLoad);
    image.removeEventListener("error", onImageError);
    windowObject.removeEventListener("keydown", onKeydown);
    windowObject.removeEventListener("popstate", onPopState);
    hideViewer({ restoreFocus: false });
  }

  return { bindCards, syncFromUrl, openById, close, destroy };
}
