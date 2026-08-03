function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function pickerTier(image) {
  const eligibility = image?.featuredEligibility;
  return eligibility?.eligible === true ? eligibility.resolutionTier : "ineligible";
}

function renderMember(image, index, total, coverImageId) {
  const eligible = image?.featuredEligibility?.eligible === true;
  const isCover = Number(image.id) === Number(coverImageId);
  return `<article class="site-featured-item ${eligible ? "is-eligible" : ""}${isCover ? " is-cover" : ""}" data-member-id="${image.id}">
    <div class="album-member-preview">
      <img src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}" loading="lazy" decoding="async" />
      <button class="album-member-open" type="button" data-action="preview" aria-label="预览 ${escapeHtml(image.fileName)}"></button>
      ${isCover ? '<span class="album-cover-badge" data-role="cover-image">封面</span>' : ""}
    </div>
    <div class="site-featured-copy"><strong title="${escapeHtml(image.fileName)}">${escapeHtml(image.fileName)}</strong><span>第 ${index + 1} 张 · ${escapeHtml(image.width ?? "?")}×${escapeHtml(image.height ?? "?")}</span></div>
    <div class="site-featured-item-actions"><button type="button" data-action="move-up" aria-label="向前移动" title="向前移动" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-action="move-down" aria-label="向后移动" title="向后移动" ${index === total - 1 ? "disabled" : ""}>↓</button><button type="button" data-action="remove" class="admin-button-danger">移除</button></div>
  </article>`;
}

export function createAlbumManagementController({ root, client, dialogs, notifier }) {
  const elements = {
    list: root.querySelector("#album-list"), name: root.querySelector("#album-name"),
    description: root.querySelector("#album-description"), cover: root.querySelector("#album-cover"),
    isHome: root.querySelector("#album-is-home"), members: root.querySelector("#album-members"),
    status: root.querySelector("#album-status"), create: document.querySelector('[data-action="create-album"]'),
    add: root.querySelector('[data-action="add-images"]'), save: root.querySelector('[data-action="save-album"]'),
    delete: root.querySelector('[data-action="delete-album"]'),
  };
  let albums = [];
  let selectedId = null;
  let draft = null;
  let library = null;
  let libraryNextOffset = 0;
  let libraryHasMore = true;
  let busy = false;
  let dirty = false;

  function current() { return albums.find((album) => Number(album.id) === Number(selectedId)) ?? null; }
  function deleteProtected() { return current()?.isHome === true || draft?.isHome === true; }
  function setDisabled(value) {
    for (const element of [elements.name, elements.description, elements.cover, elements.isHome, elements.add, elements.delete]) element.disabled = value;
    elements.save.disabled = value || !draft || !dirty;
    elements.create.disabled = busy;
  }
  function renderStatus() {
    if (!draft) { elements.status.textContent = ""; return; }
    const heroCount = draft.images.filter((image) => image?.featuredEligibility?.eligible === true).length;
    elements.status.textContent = `图集共 ${draft.images.length} 张，轮播可用 ${heroCount} 张${dirty ? " · 有未保存修改" : ""}。`;
  }
  function syncDraftFromEditor() {
    if (!draft) return;
    draft.name = elements.name.value;
    draft.description = elements.description.value;
    draft.isHome = elements.isHome.checked;
    draft.coverImageId = Number(elements.cover.value) || null;
  }
  function markEditorDirty() {
    if (!draft || busy) return;
    syncDraftFromEditor();
    dirty = true;
    renderStatus();
    elements.save.disabled = false;
    elements.delete.disabled = deleteProtected();
  }
  function renderList() {
    elements.list.innerHTML = albums.map((album) => `<button type="button" data-album-id="${album.id}" class="album-list-item${album.id === selectedId ? " is-active" : ""}"><strong>${escapeHtml(album.name)}</strong><span>${album.imageCount} 张${album.isHome ? " · 首页" : ""}</span></button>`).join("");
  }
  function renderEditor() {
    renderList();
    if (!draft) { elements.members.innerHTML = `<div class="admin-empty">请先选择或创建图集</div>`; setDisabled(true); return; }
    elements.name.value = draft.name;
    elements.description.value = draft.description;
    elements.isHome.checked = draft.isHome;
    elements.cover.innerHTML = draft.images.length
      ? draft.images.map((image) => `<option value="${image.id}"${Number(image.id) === Number(draft.coverImageId) ? " selected" : ""}>${escapeHtml(image.fileName)}</option>`).join("")
      : `<option value="">暂无图片</option>`;
    if (draft.images.length) elements.cover.value = String(draft.coverImageId ?? draft.images[0].id);
    elements.members.innerHTML = draft.images.length
      ? draft.images.map((image, index) => renderMember(image, index, draft.images.length, draft.coverImageId)).join("")
      : `<div class="admin-empty">这个图集还没有图片</div>`;
    renderStatus();
    setDisabled(busy);
    elements.delete.disabled = busy || deleteProtected();
  }
  function select(albumId) {
    selectedId = Number(albumId);
    const album = current();
    draft = album ? { ...album, images: [...album.images] } : null;
    dirty = false;
    renderEditor();
  }
  async function confirmDiscard() {
    if (!dirty) return true;
    return await dialogs.confirm({
      title: "放弃未保存修改？",
      message: "切换或新建图集会丢失当前尚未保存的修改。",
      confirmLabel: "放弃并继续",
      danger: true,
    });
  }
  async function requestSelect(albumId) {
    const nextId = Number(albumId);
    if (nextId === selectedId) return;
    if (!await confirmDiscard()) return;
    select(nextId);
  }
  async function load() {
    busy = true; setDisabled(true);
    try {
      const payload = await client.request("/api/admin/albums");
      albums = payload.albums ?? [];
      select(albums.find((album) => album.isHome)?.id ?? albums[0]?.id ?? null);
    } finally { busy = false; renderEditor(); }
  }
  async function createAlbum() {
    if (!await confirmDiscard()) return;
    busy = true; setDisabled(true);
    try {
      const payload = await client.request("/api/admin/albums", { method: "POST", body: JSON.stringify({ name: `新图集 ${albums.length + 1}` }) });
      albums.push(payload.album); select(payload.album.id); notifier.success("图集已创建");
    } catch (error) { notifier.error(error?.message || "创建失败"); } finally { busy = false; renderEditor(); }
  }
  async function saveAlbum() {
    if (!draft) return;
    syncDraftFromEditor();
    const submission = {
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      isHome: draft.isHome,
      coverImageId: draft.coverImageId,
      imageIds: draft.images.map((image) => image.id),
    };
    if (!submission.name) {
      elements.status.textContent = "图集名字不能为空。";
      elements.name.focus();
      return;
    }
    draft = { ...draft, ...submission };
    busy = true;
    elements.status.textContent = "正在保存图集...";
    setDisabled(true);
    try {
      const payload = await client.request("/api/admin/albums", { method: "PATCH", body: JSON.stringify(submission) });
      if (Number(payload.album.coverImageId) !== Number(submission.coverImageId)) throw new Error("图集封面保存结果不一致，请重试。");
      albums = albums.map((album) => album.id === payload.album.id ? payload.album : { ...album, isHome: payload.album.isHome ? false : album.isHome });
      select(payload.album.id); notifier.success("图集已保存");
    } catch (error) { notifier.error(error?.message || "保存失败"); } finally { busy = false; renderEditor(); }
  }
  async function deleteAlbum() {
    if (!draft || deleteProtected()) return;
    busy = true; setDisabled(true);
    try {
      await client.request("/api/admin/albums", { method: "DELETE", body: JSON.stringify({ id: draft.id }) });
      albums = albums.filter((album) => album.id !== draft.id); select(albums[0]?.id ?? null); notifier.success("图集已删除");
    } catch (error) { notifier.error(error?.message || "删除失败"); } finally { busy = false; renderEditor(); }
  }
  async function addImages() {
    if (!draft) return;
    if (!library) library = [];
    const loadLibraryPage = async () => {
      if (!libraryHasMore) return;
      const page = await client.request(`/api/admin/images?limit=100&offset=${libraryNextOffset}&sort=newest`);
      const known = new Set(library.map((image) => Number(image.id)));
      library.push(...(page.images ?? []).filter((image) => !known.has(Number(image.id))));
      libraryNextOffset = Number(page.nextOffset ?? library.length);
      libraryHasMore = Boolean(page.hasMore);
    };
    if (!library.length) await loadLibraryPage();
    const selected = new Set(draft.images.map((image) => Number(image.id)));
    const filters = [{ value: "all", label: "全部" }, { value: "4k", label: "4K" }, { value: "2k", label: "2K" }, { value: "1k", label: "1K" }, { value: "other", label: "其他" }, { value: "ineligible", label: "非轮播比例" }];
    const body = document.createElement("div"); body.className = "site-picker"; let active = "all";
    body.innerHTML = `<div class="site-picker-filters">${filters.map((filter) => `<button type="button" data-tier="${filter.value}">${filter.label}</button>`).join("")}</div><div class="site-picker-grid"></div><button type="button" data-action="load-more-library">继续加载图片</button>`;
    const grid = body.querySelector(".site-picker-grid");
    const loadMore = body.querySelector('[data-action="load-more-library"]');
    const render = () => { const visible = library.filter((image) => active === "all" || pickerTier(image) === active); grid.innerHTML = visible.map((image) => `<label class="site-picker-card"><input type="checkbox" value="${image.id}"${selected.has(Number(image.id)) ? " checked" : ""}><img src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}"><span>${escapeHtml(image.fileName)}</span><small>${escapeHtml(image.width)}×${escapeHtml(image.height)}</small></label>`).join(""); loadMore.hidden = !libraryHasMore; loadMore.textContent = `继续加载（已加载 ${library.length} 张）`; };
    body.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-tier]"); if (button) { active = button.dataset.tier; render(); return; }
      if (event.target.closest('[data-action="load-more-library"]')) { loadMore.disabled = true; await loadLibraryPage(); loadMore.disabled = false; render(); }
    });
    body.addEventListener("change", (event) => { if (!event.target.matches('input[type="checkbox"]')) return; const id = Number(event.target.value); if (event.target.checked) selected.add(id); else selected.delete(id); });
    render();
    if (!await dialogs.open({ title: "添加图片到图集", body, confirmLabel: "应用", valueReader: () => true })) return;
    const existing = draft.images.filter((image) => selected.has(Number(image.id)));
    const existingIds = new Set(existing.map((image) => Number(image.id)));
    draft.images = [...existing, ...library.filter((image) => selected.has(Number(image.id)) && !existingIds.has(Number(image.id)))];
    draft.coverImageId = draft.images.some((image) => Number(image.id) === Number(draft.coverImageId)) ? draft.coverImageId : draft.images[0]?.id ?? null;
    dirty = true;
    renderEditor();
  }
  function previewImage(image) {
    const body = document.createElement("div");
    body.className = "album-preview-stage";
    const preview = document.createElement("img");
    preview.src = image.fileUrl;
    preview.alt = image.fileName || "图集图片预览";
    body.append(preview);
    return dialogs.open({ title: image.fileName || "图片预览", body, confirmLabel: "关闭", panelClass: "album-preview-dialog" });
  }
  function bind() {
    elements.list.addEventListener("click", async (event) => { const button = event.target.closest("[data-album-id]"); if (button && !busy) await requestSelect(button.dataset.albumId); });
    elements.name.addEventListener("input", markEditorDirty);
    elements.description.addEventListener("input", markEditorDirty);
    elements.isHome.addEventListener("change", markEditorDirty);
    elements.cover.addEventListener("change", () => { markEditorDirty(); renderEditor(); });
    elements.create.addEventListener("click", async () => { if (!busy) await createAlbum(); });
    elements.add.addEventListener("click", async () => { if (!busy) await addImages(); });
    elements.save.addEventListener("click", async () => { if (!busy) await saveAlbum(); });
    elements.delete.addEventListener("click", async () => { if (!busy) await deleteAlbum(); });
    elements.members.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action; const row = event.target.closest("[data-member-id]"); if (!action || !row || !draft) return;
      const index = draft.images.findIndex((image) => Number(image.id) === Number(row.dataset.memberId));
      if (action === "preview" && index >= 0) { previewImage(draft.images[index]); return; }
      if (action === "remove") draft.images.splice(index, 1);
      if (action === "move-up" && index > 0) [draft.images[index - 1], draft.images[index]] = [draft.images[index], draft.images[index - 1]];
      if (action === "move-down" && index < draft.images.length - 1) [draft.images[index + 1], draft.images[index]] = [draft.images[index], draft.images[index + 1]];
      dirty = true;
      renderEditor();
    });
  }
  return { load, bind };
}
