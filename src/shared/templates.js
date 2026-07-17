import { getResponsiveImageAttributes } from "./image-variants.js?v=20260717-cloudflare-image-performance";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderResponsiveImageAttributes(image, presetName) {
  const attributes = getResponsiveImageAttributes(image, presetName);
  const parts = [`src="${escapeHtml(attributes.src)}"`];
  if (attributes.srcset) {
    parts.push(`srcset="${escapeHtml(attributes.srcset)}"`);
    parts.push(`sizes="${escapeHtml(attributes.sizes)}"`);
  }
  if (attributes.width) parts.push(`width="${attributes.width}"`);
  if (attributes.height) parts.push(`height="${attributes.height}"`);
  return parts.join(" ");
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

export function renderAlbumCards(albums) {
  return (albums ?? []).map((album) => {
    const cover = album.coverImage;
    const coverMarkup = cover?.fileUrl
      ? `<img ${renderResponsiveImageAttributes(cover, "cover")} alt="${escapeHtml(cover.fileName || album.name)}" loading="lazy" decoding="async" />`
      : `<span class="album-cover-empty">暂无封面</span>`;
    return `<a class="album-card" href="/album.html?slug=${encodeURIComponent(album.slug)}">
      <span class="album-cover">${coverMarkup}</span>
      <span class="album-card-copy"><strong>${escapeHtml(album.name)}</strong><span>${escapeHtml(album.description || "")}</span><small>${Number(album.imageCount ?? 0)} 张</small></span>
    </a>`;
  }).join("");
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
              <img ${renderResponsiveImageAttributes(image, "gallery")} alt="${escapeHtml(label)}" loading="lazy" decoding="async" />
              <span class="gallery-hover-shade" aria-hidden="true"></span>
              ${metaMarkup}
            </span>
          </button>
        </article>
      `;
    })
    .join("");
}
