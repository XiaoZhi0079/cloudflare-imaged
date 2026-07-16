function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function pickerTier(image) {
  const eligibility = image?.featuredEligibility;
  return eligibility?.eligible === true ? eligibility.resolutionTier : "ineligible";
}

function renderMember(image, index, total) {
  const eligible = image?.featuredEligibility?.eligible === true;
  return `<article class="site-featured-item ${eligible ? "is-eligible" : ""}" data-member-id="${image.id}">
    <img src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}" loading="lazy" />
    <div class="site-featured-copy"><strong>${escapeHtml(image.fileName)}</strong><span>第 ${index + 1} 张 · ${escapeHtml(image.width ?? "?")}×${escapeHtml(image.height ?? "?")}</span></div>
    <div class="site-featured-item-actions"><button data-action="move-up" ${index === 0 ? "disabled" : ""}>↑</button><button data-action="move-down" ${index === total - 1 ? "disabled" : ""}>↓</button><button data-action="remove" class="admin-button-danger">移除</button></div>
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
  let busy = false;

  function current() { return albums.find((album) => Number(album.id) === Number(selectedId)) ?? null; }
  function setDisabled(value) {
    for (const element of [elements.name, elements.description, elements.cover, elements.isHome, elements.add, elements.save, elements.delete]) element.disabled = value;
    elements.create.disabled = busy;
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
    elements.members.innerHTML = draft.images.length
      ? draft.images.map((image, index) => renderMember(image, index, draft.images.length)).join("")
      : `<div class="admin-empty">这个图集还没有图片</div>`;
    const heroCount = draft.images.filter((image) => image?.featuredEligibility?.eligible === true).length;
    elements.status.textContent = `图集共 ${draft.images.length} 张，轮播可用 ${heroCount} 张。`;
    setDisabled(busy);
    elements.delete.disabled = busy || draft.isHome;
  }
  function select(albumId) {
    selectedId = Number(albumId);
    const album = current();
    draft = album ? { ...album, images: [...album.images] } : null;
    renderEditor();
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
    busy = true; renderEditor();
    try {
      const payload = await client.request("/api/admin/albums", { method: "POST", body: JSON.stringify({ name: `新图集 ${albums.length + 1}` }) });
      albums.push(payload.album); select(payload.album.id); notifier.success("图集已创建");
    } catch (error) { notifier.error(error?.message || "创建失败"); } finally { busy = false; renderEditor(); }
  }
  async function saveAlbum() {
    if (!draft) return;
    busy = true; renderEditor();
    try {
      const payload = await client.request("/api/admin/albums", { method: "PATCH", body: JSON.stringify({
        id: draft.id, name: elements.name.value.trim(), description: elements.description.value.trim(),
        isHome: elements.isHome.checked, coverImageId: Number(elements.cover.value) || null,
        imageIds: draft.images.map((image) => image.id),
      }) });
      albums = albums.map((album) => album.id === payload.album.id ? payload.album : { ...album, isHome: payload.album.isHome ? false : album.isHome });
      select(payload.album.id); notifier.success("图集已保存");
    } catch (error) { notifier.error(error?.message || "保存失败"); } finally { busy = false; renderEditor(); }
  }
  async function deleteAlbum() {
    if (!draft || draft.isHome) return;
    busy = true; renderEditor();
    try {
      await client.request("/api/admin/albums", { method: "DELETE", body: JSON.stringify({ id: draft.id }) });
      albums = albums.filter((album) => album.id !== draft.id); select(albums[0]?.id ?? null); notifier.success("图集已删除");
    } catch (error) { notifier.error(error?.message || "删除失败"); } finally { busy = false; renderEditor(); }
  }
  async function addImages() {
    if (!draft) return;
    if (!library) library = (await client.request("/api/admin/images")).images ?? [];
    const selected = new Set(draft.images.map((image) => Number(image.id)));
    const filters = [{ value: "all", label: "全部" }, { value: "4k", label: "4K" }, { value: "2k", label: "2K" }, { value: "1k", label: "1K" }, { value: "other", label: "其他" }, { value: "ineligible", label: "非轮播比例" }];
    const body = document.createElement("div"); body.className = "site-picker"; let active = "all";
    body.innerHTML = `<div class="site-picker-filters">${filters.map((filter) => `<button type="button" data-tier="${filter.value}">${filter.label}</button>`).join("")}</div><div class="site-picker-grid"></div>`;
    const grid = body.querySelector(".site-picker-grid");
    const render = () => { const visible = library.filter((image) => active === "all" || pickerTier(image) === active); grid.innerHTML = visible.map((image) => `<label class="site-picker-card"><input type="checkbox" value="${image.id}"${selected.has(Number(image.id)) ? " checked" : ""}><img src="${escapeHtml(image.fileUrl)}" alt="${escapeHtml(image.fileName)}"><span>${escapeHtml(image.fileName)}</span><small>${escapeHtml(image.width)}×${escapeHtml(image.height)}</small></label>`).join(""); };
    body.addEventListener("click", (event) => { const button = event.target.closest("[data-tier]"); if (button) { active = button.dataset.tier; render(); } });
    body.addEventListener("change", (event) => { if (!event.target.matches('input[type="checkbox"]')) return; const id = Number(event.target.value); if (event.target.checked) selected.add(id); else selected.delete(id); });
    render();
    if (!await dialogs.open({ title: "添加图片到图集", body, confirmLabel: "应用", valueReader: () => true })) return;
    const existing = draft.images.filter((image) => selected.has(Number(image.id)));
    const existingIds = new Set(existing.map((image) => Number(image.id)));
    draft.images = [...existing, ...library.filter((image) => selected.has(Number(image.id)) && !existingIds.has(Number(image.id)))];
    draft.coverImageId = draft.images.some((image) => Number(image.id) === Number(draft.coverImageId)) ? draft.coverImageId : draft.images[0]?.id ?? null;
    renderEditor();
  }
  function bind() {
    elements.list.addEventListener("click", (event) => { const button = event.target.closest("[data-album-id]"); if (button && !busy) select(button.dataset.albumId); });
    elements.create.addEventListener("click", () => !busy && createAlbum());
    elements.add.addEventListener("click", () => !busy && addImages());
    elements.save.addEventListener("click", () => !busy && saveAlbum());
    elements.delete.addEventListener("click", () => !busy && deleteAlbum());
    elements.members.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action; const row = event.target.closest("[data-member-id]"); if (!action || !row || !draft) return;
      const index = draft.images.findIndex((image) => Number(image.id) === Number(row.dataset.memberId));
      if (action === "remove") draft.images.splice(index, 1);
      if (action === "move-up" && index > 0) [draft.images[index - 1], draft.images[index]] = [draft.images[index], draft.images[index - 1]];
      if (action === "move-down" && index < draft.images.length - 1) [draft.images[index + 1], draft.images[index]] = [draft.images[index], draft.images[index + 1]];
      renderEditor();
    });
  }
  return { load, bind };
}
