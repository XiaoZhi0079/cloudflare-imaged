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

export function renderAdminTagList(tags) {
  return tags
    .map((tag) => {
      const isVisible = Boolean(tag.isVisible);
      const visibilityText = isVisible ? "\u663e\u793a" : "\u9690\u85cf";
      const visibilityClass = isVisible ? "is-visible" : "is-hidden";

      return `
        <div class="admin-tag-row list-item" data-tag-id="${escapeHtml(tag.id)}">
          <div class="admin-row-main">
            <div class="admin-row-titleline">
              <strong class="admin-row-title">${escapeHtml(tag.name)}</strong>
              <span class="visibility-pill ${visibilityClass}">${visibilityText}</span>
            </div>
            <div class="admin-row-meta">
              <span>slug: ${escapeHtml(tag.slug)}</span>
              <span>\u6392\u5e8f: ${escapeHtml(tag.sortOrder)}</span>
            </div>
          </div>
          <div class="admin-row-actions inline-actions">
            <button class="button-secondary" type="button" data-action="rename-tag">\u91cd\u547d\u540d</button>
            <button class="button-secondary" type="button" data-action="assign-order">\u6392\u5e8f</button>
            <button class="button-secondary" type="button" data-action="toggle-tag">${isVisible ? "\u9690\u85cf" : "\u663e\u793a"}</button>
            <button class="button-danger" type="button" data-action="delete-tag">\u5220\u9664</button>
          </div>
        </div>
      `;
    })
    .join("");
}
export function renderAdminTagRail(tags, activeTagName = "") {
  return tags
    .map((tag) => {
      const isVisible = Boolean(tag.isVisible);
      const visibilityText = isVisible ? "显示" : "隐藏";
      const visibilityClass = isVisible ? "is-visible" : "is-hidden";
      const rowClass = tag.name === activeTagName ? "admin-tag-filter-row is-active" : "admin-tag-filter-row";

      return `
        <button class="${rowClass}" type="button" data-tag-filter="${escapeHtml(tag.name)}" data-tag-id="${escapeHtml(tag.id)}">
          <span class="admin-tag-filter-name">${escapeHtml(tag.name)}</span>
          <span class="visibility-pill ${visibilityClass}">${visibilityText}</span>
        </button>
      `;
    })
    .join("");
}
export function renderAdminImageGrid(images) {
  return images
    .map((image) => {
      const tagNames = image.tags ?? [];
      const tagHtml = tagNames.length
        ? tagNames.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")
        : `<span class="tag-pill is-empty">\u672a\u5206\u914d\u6807\u7b7e</span>`;
      const syncStatus = image.syncStatus ?? "ok";
      const syncClass = syncStatus === "ok" ? "is-ok" : "is-warning";
      const preview = image.fileUrl
        ? `<img class="admin-image-card-thumb" src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}" loading="lazy" />`
        : `<span class="admin-image-card-thumb is-empty">IMG</span>`;

      return `
        <article class="admin-image-card" data-image-id="${escapeHtml(image.id)}">
          <label class="admin-image-card-select" aria-label="\u9009\u62e9 ${escapeHtml(image.fileName)}">
            <input type="checkbox" data-image-select value="${escapeHtml(image.id)}" />
          </label>
          <button class="admin-image-card-open" type="button" data-action="open-detail" aria-label="\u7f16\u8f91 ${escapeHtml(image.fileName)}">
            <span class="admin-image-card-media">${preview}</span>
          </button>
          <div class="admin-image-card-meta">
            <div class="admin-image-card-titleline">
              <strong class="admin-row-title">${escapeHtml(image.fileName)}</strong>
              <span class="sync-pill ${syncClass}">${escapeHtml(syncStatus || "OK")}</span>
            </div>
            <div class="admin-tag-pills">${tagHtml}</div>
          </div>
        </article>
      `;
    })
    .join("");
}
export function renderAdminImageList(images) {
  return images
    .map((image) => {
      const tagNames = image.tags ?? [];
      const tagHtml = tagNames.length
        ? tagNames.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")
        : `<span class="tag-pill is-empty">\u672a\u5206\u914d\u6807\u7b7e</span>`;
      const syncStatus = image.syncStatus ?? "ok";
      const syncClass = syncStatus === "ok" ? "is-ok" : "is-warning";
      const preview = image.fileUrl
        ? `<img class="admin-image-thumb" src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}" loading="lazy" />`
        : `<span class="admin-image-thumb is-empty">IMG</span>`;
      const syncLine = syncStatus && syncStatus !== "ok"
        ? `<div class="admin-sync-note">\u72b6\u6001: ${escapeHtml(syncStatus)}${image.note ? ` · ${escapeHtml(image.note)}` : ""}</div>`
        : "";

      return `
        <div class="admin-image-row list-item" data-image-id="${escapeHtml(image.id)}">
          <div class="admin-image-preview">${preview}</div>
          <div class="admin-row-main">
            <div class="admin-row-titleline">
              <strong class="admin-row-title">${escapeHtml(image.fileName)}</strong>
              <span class="sync-pill ${syncClass}">${escapeHtml(syncStatus || "OK")}</span>
            </div>
            <div class="admin-tag-pills">${tagHtml}</div>
            ${syncLine}
          </div>
          <div class="admin-row-actions inline-actions">
            <button class="button-secondary" type="button" data-action="assign-tags">\u8bbe\u7f6e\u6807\u7b7e</button>
            <button class="button-secondary" type="button" data-action="rename-image">\u91cd\u547d\u540d</button>
            <button class="button-secondary" type="button" data-action="move-image">\u79fb\u52a8\u76ee\u5f55</button>
            <button class="button-danger" type="button" data-action="delete-image">\u5220\u9664</button>
          </div>
        </div>
      `;
    })
    .join("");
}