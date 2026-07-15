function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function tagName(tag) {
  return typeof tag === "string" ? tag : tag?.name;
}

export function filterImages(images, { query = "", tagNames = new Set(), featured = "all" } = {}) {
  const needle = normalizedText(query);
  const requiredTags = [...tagNames].map(normalizedText).filter(Boolean);

  return images.filter((image) => {
    const imageTags = (image.tags ?? []).map((tag) => normalizedText(tagName(tag)));
    const searchable = [normalizedText(image.fileName), ...imageTags];
    const matchesQuery = !needle || searchable.some((value) => value.includes(needle));
    const matchesTags = requiredTags.every((required) => imageTags.includes(required));
    const matchesFeatured = featured === "eligible"
      ? image.featuredEligibility?.eligible === true
      : featured === "4k"
        ? image.featuredEligibility?.is4K === true
        : true;
    return matchesQuery && matchesTags && matchesFeatured;
  });
}

function sortImages(images, sort) {
  const next = [...images];
  if (sort === "name") {
    return next.sort((left, right) => String(left.fileName ?? "").localeCompare(String(right.fileName ?? ""), "zh-CN"));
  }
  return next.sort((left, right) => Number(right.id) - Number(left.id));
}

export function createLibraryState({ initialRenderLimit = 120, renderIncrement = 120 } = {}) {
  let images = [];
  let tags = [];
  let categories = [];
  let query = "";
  let selectedTagNames = new Set();
  let selectedIds = new Set();
  let sort = "newest";
  let featuredFilter = "all";
  let renderLimit = initialRenderLimit;

  function resetRenderLimit() {
    renderLimit = initialRenderLimit;
  }

  function syncSelection() {
    const currentIds = new Set(images.map((image) => Number(image.id)));
    selectedIds = new Set([...selectedIds].filter((id) => currentIds.has(id)));
  }

  const state = {
    getImages: () => images,
    getTags: () => tags,
    getCategories: () => categories,
    getSelectedIds: () => new Set(selectedIds),
    getFilters: () => ({ query, tagNames: new Set(selectedTagNames), sort, featured: featuredFilter }),
    setImages(next) {
      images = Array.isArray(next) ? [...next] : [];
      syncSelection();
      resetRenderLimit();
    },
    syncImages(next) {
      state.setImages(next);
    },
    setTags(next) {
      tags = Array.isArray(next) ? [...next] : [];
    },
    setCategories(next) {
      categories = Array.isArray(next) ? [...next] : [];
    },
    setQuery(next) {
      query = String(next ?? "");
      resetRenderLimit();
    },
    setTagsFilter(next) {
      selectedTagNames = new Set(next ?? []);
      resetRenderLimit();
    },
    setSort(next) {
      sort = next === "name" ? "name" : "newest";
      resetRenderLimit();
    },
    setFeaturedFilter(next) {
      featuredFilter = next === "eligible" || next === "4k" ? next : "all";
      resetRenderLimit();
    },
    resetFilters() {
      query = "";
      selectedTagNames = new Set();
      featuredFilter = "all";
      resetRenderLimit();
    },
    toggleSelection(id, force) {
      const imageId = Number(id);
      if (!images.some((image) => Number(image.id) === imageId)) return;
      const shouldSelect = force ?? !selectedIds.has(imageId);
      if (shouldSelect) selectedIds.add(imageId);
      else selectedIds.delete(imageId);
    },
    selectImages(ids) {
      const currentIds = new Set(images.map((image) => Number(image.id)));
      selectedIds = new Set([...ids].map(Number).filter((id) => currentIds.has(id)));
    },
    clearSelection() {
      selectedIds.clear();
    },
    visibleImages() {
      return sortImages(filterImages(images, { query, tagNames: selectedTagNames, featured: featuredFilter }), sort);
    },
    renderedImages() {
      return state.visibleImages().slice(0, renderLimit);
    },
    hasMore() {
      return renderLimit < state.visibleImages().length;
    },
    showMore() {
      renderLimit += renderIncrement;
    },
  };

  return state;
}
