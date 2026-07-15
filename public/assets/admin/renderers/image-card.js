function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageTagName(tag) {
  return typeof tag === "string" ? tag : tag?.name;
}

function labelText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function renderFeaturedBadge(image) {
  const eligibility = image.featuredEligibility && typeof image.featuredEligibility === "object"
    ? image.featuredEligibility
    : {};
  const dimensions = labelText(eligibility.dimensions, "尺寸未知");
  const status = eligibility.eligible === false
    ? labelText(eligibility.reason || eligibility.statusLabel, "状态未知")
    : labelText(eligibility.statusLabel, "状态未知");
  const quality = String(eligibility.qualityLabel ?? "").trim();
  const statusClass = eligibility.is4K === true
    ? "is-4k"
    : eligibility.eligible === true
      ? "is-eligible"
      : eligibility.eligible === false
        ? "is-invalid"
        : "is-unknown";
  const qualityBadge = quality
    ? `<span class="image-featured-quality">${escapeHtml(quality)}</span>`
    : "";

  return `<div class="image-featured-badge ${statusClass}">
        <span class="image-featured-dimensions">${escapeHtml(dimensions)}</span>
        <span class="image-featured-status">${escapeHtml(status)}</span>
        ${qualityBadge}
      </div>`;
}

export function renderImageCard(image, { selected = false } = {}) {
  const id = escapeHtml(image.id);
  const fileName = escapeHtml(image.fileName || "未命名图片");
  const fileUrl = String(image.fileUrl ?? "").trim();
  const preview = fileUrl
    ? `<img src="${escapeHtml(fileUrl)}" alt="${fileName}" loading="lazy" decoding="async" data-preview-image /><span class="image-preview-fallback" data-preview-fallback hidden>预览不可用</span>`
    : `<span class="image-preview-fallback" data-preview-fallback>预览不可用</span>`;
  const category = image.category?.name
    ? `<span class="image-card-category">${escapeHtml(image.category.name)}</span>`
    : `<span class="image-card-category is-empty">未分类</span>`;
  const tags = (image.tags ?? []).slice(0, 2).map((tag) => `<span>${escapeHtml(imageTagName(tag))}</span>`).join("");
  const syncWarning = image.syncStatus && image.syncStatus !== "ok"
    ? `<span class="image-sync-warning" title="${escapeHtml(image.note || "文件状态异常")}">待修复</span>`
    : "";
  const featuredBadge = renderFeaturedBadge(image);

  return `<article class="admin-image-card${selected ? " is-selected" : ""}" data-image-id="${id}">
    <div class="image-card-stage">
      ${preview}
      <button class="image-card-open" type="button" data-action="open-detail" aria-label="查看 ${fileName} 详情"></button>
      <button class="image-card-select" type="button" data-action="toggle-selection" aria-label="${selected ? "取消选择" : "选择"} ${fileName}" aria-pressed="${selected}" title="${selected ? "取消选择" : "选择"}"><span aria-hidden="true">✓</span></button>
      ${featuredBadge}
      ${syncWarning}
    </div>
    <div class="image-card-copy"><strong title="${fileName}">${fileName}</strong><div class="image-card-meta">${category}<span class="image-card-tags">${tags}</span></div></div>
  </article>`;
}
