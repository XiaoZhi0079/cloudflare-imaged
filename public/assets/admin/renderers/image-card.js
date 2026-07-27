import { buildImageVariantUrl } from "../../image-variants.js?v=20260728-image-delivery";

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

function normalizedLabel(value) {
  return String(value ?? "").trim();
}

export function buildImagePreviewUrl(fileUrl, version) {
  const value = String(fileUrl ?? "").trim();
  if (!value) return "";

  const previewSource = buildImageVariantUrl(value, 480) ?? value;
  const hashIndex = previewSource.indexOf("#");
  const source = hashIndex >= 0 ? previewSource.slice(0, hashIndex) : previewSource;
  const hash = hashIndex >= 0 ? previewSource.slice(hashIndex) : "";
  const separator = source.includes("?") ? "&" : "?";
  return `${source}${separator}gallery-preview=${encodeURIComponent(String(version ?? ""))}${hash}`;
}

export function renderImageCard(image, { selected = false, selectionMode = false } = {}) {
  const id = escapeHtml(image.id);
  const fileName = escapeHtml(image.fileName || "未命名图片");
  const fileUrl = String(image.fileUrl ?? "").trim();
  const previewUrl = buildImagePreviewUrl(fileUrl, image.id);
  const preview = fileUrl
    ? `<img src="${escapeHtml(previewUrl)}" alt="${fileName}" loading="lazy" decoding="async" fetchpriority="low" data-preview-image /><span class="image-preview-fallback" data-preview-fallback hidden>预览不可用</span>`
    : `<span class="image-preview-fallback" data-preview-fallback>预览不可用</span>`;
  const tagNames = [...new Set((image.tags ?? [])
    .map(imageTagName)
    .map(normalizedLabel)
    .filter(Boolean))];
  const tags = tagNames.map((tagName) => `<span>${escapeHtml(tagName)}</span>`).join("");
  const selectionButton = selectionMode
    ? `<button class="image-card-select" type="button" data-action="toggle-selection" aria-label="${selected ? "取消选择" : "选择"} ${fileName}" aria-pressed="${selected}" title="${selected ? "取消选择" : "选择"}"><span aria-hidden="true">✓</span></button>`
    : "";
  const syncWarning = image.syncStatus && image.syncStatus !== "ok"
    ? `<span class="image-sync-warning" title="${escapeHtml(image.note || "文件状态异常")}">待修复</span>`
    : "";
  return `<article class="admin-image-card${selected ? " is-selected" : ""}" data-image-id="${id}">
    <div class="image-card-stage">
      ${preview}
      <button class="image-card-open" type="button" data-action="open-detail" aria-label="查看 ${fileName} 详情"></button>
      ${selectionButton}
      ${syncWarning}
    </div>
    <div class="image-card-copy"><strong title="${fileName}">${fileName}</strong><div class="image-card-meta"><span class="image-card-tags">${tags}</span></div></div>
  </article>`;
}
