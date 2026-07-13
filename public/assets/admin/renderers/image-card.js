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

  return `<article class="admin-image-card${selected ? " is-selected" : ""}" data-image-id="${id}">
    <div class="image-card-stage">
      ${preview}
      <button class="image-card-open" type="button" data-action="open-detail" aria-label="查看 ${fileName} 详情"></button>
      <button class="image-card-select" type="button" data-action="toggle-selection" aria-label="${selected ? "取消选择" : "选择"} ${fileName}" aria-pressed="${selected}" title="${selected ? "取消选择" : "选择"}"><span aria-hidden="true">✓</span></button>
      ${syncWarning}
    </div>
    <div class="image-card-copy"><strong title="${fileName}">${fileName}</strong><div class="image-card-meta">${category}<span class="image-card-tags">${tags}</span></div></div>
  </article>`;
}
