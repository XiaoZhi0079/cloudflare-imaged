export function createProgressiveGallery({
  root,
  loadMoreButton,
  renderCards,
  bindCards,
  batchSize = 48,
  IntersectionObserverClass = globalThis.IntersectionObserver,
}) {
  let items = [];
  let renderedCount = 0;
  let rendering = false;

  function syncButton() {
    loadMoreButton.hidden = renderedCount >= items.length;
    loadMoreButton.setAttribute("aria-label", `加载更多图片，已显示 ${renderedCount} / ${items.length}`);
  }

  function showMore() {
    if (rendering || renderedCount >= items.length) return false;
    rendering = true;
    const nextCount = Math.min(renderedCount + batchSize, items.length);
    root.insertAdjacentHTML("beforeend", renderCards(items.slice(renderedCount, nextCount)));
    renderedCount = nextCount;
    bindCards(root);
    syncButton();
    rendering = false;
    return true;
  }

  function setItems(nextItems, { emptyMarkup = "" } = {}) {
    items = Array.isArray(nextItems) ? nextItems : [];
    renderedCount = 0;
    root.innerHTML = "";
    root.classList.toggle("is-empty", items.length === 0);
    if (!items.length) {
      root.innerHTML = emptyMarkup;
      syncButton();
      return;
    }
    showMore();
  }

  const onLoadMore = () => showMore();
  loadMoreButton.addEventListener("click", onLoadMore);
  const observer = typeof IntersectionObserverClass === "function"
    ? new IntersectionObserverClass((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      }, { rootMargin: "600px 0px" })
    : null;
  observer?.observe(loadMoreButton);

  function destroy() {
    observer?.disconnect();
    loadMoreButton.removeEventListener("click", onLoadMore);
  }

  return { setItems, showMore, destroy, getRenderedCount: () => renderedCount };
}
