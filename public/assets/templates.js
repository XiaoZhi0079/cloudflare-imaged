function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPublicTagText(tags) {
  return (tags ?? []).filter(Boolean).join(" · ");
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
      const tagText = formatPublicTagText(image.tags);
      const label = String(image.fileName ?? "").trim() || "未命名图片";
      const tagMarkup = tagText ? `<span class="card-tags">${escapeHtml(tagText)}</span>` : "";
      const metaMarkup = `<span class="gallery-hover-meta"><strong class="card-title">${escapeHtml(label)}</strong>${tagMarkup}</span>`;

      return `
        <article class="gallery-card" data-image-id="${escapeHtml(image.id)}">
          <button type="button" data-action="open-image" aria-label="${escapeHtml(label)}">
            <span class="gallery-image-stage">
              <img src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(label)}" loading="lazy" />
              <span class="gallery-hover-shade" aria-hidden="true"></span>
              ${metaMarkup}
            </span>
          </button>
        </article>
      `;
    })
    .join("");
}
