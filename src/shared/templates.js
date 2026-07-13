function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderTagChips(tags, activeSlug) {
  return tags
    .map((tag) => {
      const className = tag.slug === activeSlug ? "tag-chip active" : "tag-chip";

      return `<button type="button" class="${className}" data-tag-slug="${escapeHtml(tag.slug)}">${escapeHtml(tag.name)}</button>`;
    })
    .join("");
}

export function renderGalleryCards(images) {
  return images
    .map((image) => {
      const tagText = (image.tags ?? []).join(" / ") || "\u672a\u5206\u914d\u6807\u7b7e";

      return `
        <article class="gallery-card" data-image-id="${escapeHtml(image.id)}">
          <button type="button" data-action="open-image" aria-label="\u6253\u5f00 ${escapeHtml(image.fileName)}">
            <span class="gallery-image-stage">
              <img src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}" loading="lazy" />
              <span class="gallery-hover-shade" aria-hidden="true"></span>
              <span class="gallery-hover-meta">
                <span class="card-title">${escapeHtml(image.fileName)}</span>
                <span class="card-tags">${escapeHtml(tagText)}</span>
              </span>
            </span>
          </button>
        </article>
      `;
    })
    .join("");
}
