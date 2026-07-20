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
  const isTagGroup = type === "tagGroups";
  const id = escapeHtml(item.id);
  const name = escapeHtml(item.name);
  const detail = isTag
    ? `<span class="taxonomy-visibility ${item.isVisible ? "is-visible" : "is-hidden"}">${item.isVisible ? "前台显示" : "已隐藏"}</span><span class="taxonomy-group-name">${escapeHtml(item.group?.name ?? item.groupName ?? "未分类")}</span>`
    : isTagGroup
      ? `<span class="taxonomy-directory">${Number(item.tagCount ?? 0)} 个标签</span>`
      : `<span class="taxonomy-directory">目录 /${escapeHtml(item.directorySlug)}</span>`;
  const tagActions = isTag
    ? `<button type="button" data-action="toggle-visibility">${item.isVisible ? "隐藏" : "显示"}</button><button class="taxonomy-delete" type="button" data-action="delete">删除</button>`
    : isTagGroup
      ? `<button class="taxonomy-delete" type="button" data-action="delete">删除</button>`
      : "";

  return `<article class="taxonomy-item" data-sort-id="${id}">
    <button class="taxonomy-drag-handle" type="button" data-sort-handle aria-label="拖动调整 ${name} 的顺序" aria-grabbed="false" title="拖动调整顺序"><span aria-hidden="true">⋮⋮</span></button>
    <span class="taxonomy-order" aria-label="当前顺序">${escapeHtml(item.sortOrder)}</span>
    <div class="taxonomy-copy"><strong>${name}</strong>${detail}</div>
    <div class="taxonomy-actions"><button class="taxonomy-order-action" type="button" data-action="move-up" aria-label="上移 ${name}" title="上移"${canMoveUp ? "" : " disabled"}>↑</button><button class="taxonomy-order-action" type="button" data-action="move-down" aria-label="下移 ${name}" title="下移"${canMoveDown ? "" : " disabled"}>↓</button><button type="button" data-action="rename">${isTag ? "编辑" : "重命名"}</button>${tagActions}</div>
  </article>`;
}

export function renderTagTreeTag(tag) {
  const id = escapeHtml(tag.id);
  const name = escapeHtml(tag.name);
  return `<article class="tag-tree-tag" draggable="true" data-tag-id="${id}" data-source-group-id="${escapeHtml(tag.groupId ?? tag.group?.id)}">
    <span class="tag-tree-tag-drag" aria-hidden="true" title="拖动到其他标签分类">⋮⋮</span>
    <div class="taxonomy-copy"><strong>${name}</strong><span class="taxonomy-visibility ${tag.isVisible ? "is-visible" : "is-hidden"}">${tag.isVisible ? "前台显示" : "已隐藏"}</span></div>
    <div class="taxonomy-actions"><button type="button" data-action="edit-tag">编辑</button><button type="button" data-action="toggle-visibility">${tag.isVisible ? "隐藏" : "显示"}</button><button class="taxonomy-delete" type="button" data-action="delete-tag">删除</button></div>
  </article>`;
}

export function renderTagTreeGroup(group, tags, { expanded = true, canMoveUp = true, canMoveDown = true } = {}) {
  const id = escapeHtml(group.id);
  const name = escapeHtml(group.name);
  const children = tags.length
    ? tags.map(renderTagTreeTag).join("")
    : `<div class="tag-tree-empty">暂无标签，可拖入标签或直接新增。</div>`;
  return `<section class="tag-tree-group${expanded ? " is-expanded" : ""}" data-sort-id="${id}" data-tag-group-id="${id}" data-tag-drop-zone="${id}">
    <header class="tag-tree-group-header">
      <button class="tag-tree-toggle" type="button" data-action="toggle-group" aria-expanded="${expanded}" aria-label="${expanded ? "收起" : "展开"} ${name}"><span aria-hidden="true">›</span></button>
      <span class="taxonomy-order" aria-label="当前顺序">${escapeHtml(group.sortOrder)}</span>
      <div class="taxonomy-copy"><strong>${name}</strong><span class="taxonomy-directory">${tags.length} 个标签</span></div>
      <div class="taxonomy-actions"><button class="taxonomy-order-action" type="button" data-action="move-up" aria-label="上移 ${name}" title="上移"${canMoveUp ? "" : " disabled"}>↑</button><button class="taxonomy-order-action" type="button" data-action="move-down" aria-label="下移 ${name}" title="下移"${canMoveDown ? "" : " disabled"}>↓</button><button type="button" data-action="add-tag">新增标签</button><button type="button" data-action="rename-group">重命名</button><button class="taxonomy-delete" type="button" data-action="delete-group">删除</button></div>
    </header>
    <div class="tag-tree-children"${expanded ? "" : " hidden"}>${children}</div>
  </section>`;
}
