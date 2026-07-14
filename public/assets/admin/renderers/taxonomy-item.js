function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderTaxonomyItem(item, type, { canMoveUp = true, canMoveDown = true } = {}) {
  const isTag = type === "tags";
  const id = escapeHtml(item.id);
  const name = escapeHtml(item.name);
  const detail = isTag
    ? `<span class="taxonomy-visibility ${item.isVisible ? "is-visible" : "is-hidden"}">${item.isVisible ? "前台显示" : "已隐藏"}</span>`
    : `<span class="taxonomy-directory">目录 /${escapeHtml(item.directorySlug)}</span>`;
  const tagActions = isTag
    ? `<button type="button" data-action="toggle-visibility">${item.isVisible ? "隐藏" : "显示"}</button><button class="taxonomy-delete" type="button" data-action="delete">删除</button>`
    : "";

  return `<article class="taxonomy-item" data-sort-id="${id}">
    <button class="taxonomy-drag-handle" type="button" data-sort-handle aria-label="拖动调整 ${name} 的顺序" aria-grabbed="false" title="拖动调整顺序"><span aria-hidden="true">⋮⋮</span></button>
    <span class="taxonomy-order" aria-label="当前顺序">${escapeHtml(item.sortOrder)}</span>
    <div class="taxonomy-copy"><strong>${name}</strong>${detail}</div>
    <div class="taxonomy-actions"><button class="taxonomy-order-action" type="button" data-action="move-up" aria-label="上移 ${name}" title="上移"${canMoveUp ? "" : " disabled"}>↑</button><button class="taxonomy-order-action" type="button" data-action="move-down" aria-label="下移 ${name}" title="下移"${canMoveDown ? "" : " disabled"}>↓</button><button type="button" data-action="rename">重命名</button>${tagActions}</div>
  </article>`;
}
