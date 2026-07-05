export function normalizeTagName(tagName) {
  return String(tagName ?? "").trim();
}

export function slugifyTagName(tagName) {
  return normalizeTagName(tagName)
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sortVisibleTags(tags) {
  return [...tags]
    .filter((tag) => Number(tag.is_visible) === 1)
    .sort((left, right) => {
      const orderDelta = Number(left.sort_order) - Number(right.sort_order);
      if (orderDelta !== 0) {
        return orderDelta;
      }

      return String(left.name).localeCompare(String(right.name), "zh-Hans-CN");
    });
}

export function getDefaultVisibleTag(tags) {
  return sortVisibleTags(tags)[0] ?? null;
}
