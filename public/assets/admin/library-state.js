function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function tagName(tag) {
  return typeof tag === "string" ? tag : tag?.name;
}

export function filterImages(images, { query = "", tagNames = new Set(), categoryId = null } = {}) {
  const needle = normalizedText(query);
  const requiredTags = [...tagNames].map(normalizedText).filter(Boolean);
  const selectedCategoryId = categoryId === null || categoryId === "" ? null : Number(categoryId);

  return images.filter((image) => {
    const imageTags = (image.tags ?? []).map((tag) => normalizedText(tagName(tag)));
    const searchable = [normalizedText(image.fileName), ...imageTags];
    const matchesQuery = !needle || searchable.some((value) => value.includes(needle));
    const matchesTags = requiredTags.every((required) => imageTags.includes(required));
    const matchesCategory = selectedCategoryId === null || Number(image.category?.id) === selectedCategoryId;
    return matchesQuery && matchesTags && matchesCategory;
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
  let categoryId = null;
  let selectedTagNames = new Set();
  let selectedIds = new Set();
  let sort = "newest";
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
    getFilters: () => ({ query, categoryId, tagNames: new Set(selectedTagNames), sort }),
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
    setCategory(next) {
      categoryId = next === null || next === "" ? null : Number(next);
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
    resetFilters() {
      query = "";
      categoryId = null;
      selectedTagNames = new Set();
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
      return sortImages(filterImages(images, { query, categoryId, tagNames: selectedTagNames }), sort);
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
