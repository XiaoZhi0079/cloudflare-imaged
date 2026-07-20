import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore, fetchAdminTaxonomy } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createNotifier } from "./notifications.js";
import { renderTaxonomyItem } from "./renderers/taxonomy-item.js";
import { createSettingsState } from "./settings-state.js";
import { createSortableList } from "./sortable-list.js";

const elements = {
  authView: document.querySelector("#admin-auth-view"), app: document.querySelector("#admin-app"),
  loginForm: document.querySelector("#admin-login-form"), loginButton: document.querySelector("#admin-login"),
  loginError: document.querySelector("#admin-login-error"), keyInput: document.querySelector("#admin-key"),
  passwordToggle: document.querySelector("[data-toggle-password]"), logout: document.querySelector("[data-admin-logout]"),
  tabs: [...document.querySelectorAll("[data-settings-tab]")], create: document.querySelector("#taxonomy-create"),
  search: document.querySelector("#taxonomy-search"), list: document.querySelector("#taxonomy-list"),
  status: document.querySelector("#taxonomy-status"), reset: document.querySelector("#taxonomy-reset-order"),
  save: document.querySelector("#taxonomy-save-order"), tagCount: document.querySelector("#tag-count"),
  tagGroupCount: document.querySelector("#tag-group-count"), categoryCount: document.querySelector("#category-count"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(document.querySelector("#admin-dialog-host"));
const notifier = createNotifier(document.querySelector("#admin-toast-host"));
let state = createSettingsState();
let activeType = "tags";
let sortable = null;
let busy = false;

function showAuth(message = "") {
  elements.app.hidden = true; elements.authView.hidden = false; elements.loginError.textContent = message;
  elements.keyInput.value = keyStore.get(); requestAnimationFrame(() => elements.keyInput.focus());
}

function showApp() { elements.authView.hidden = true; elements.app.hidden = false; }

const client = createAdminApiClient({
  getKey: () => keyStore.get(),
  onUnauthorized: () => { keyStore.clear(); showAuth("登录状态已失效，请重新输入管理密钥。"); },
});

function messageFor(error) { return error?.message || "操作失败，请稍后重试。"; }

function setBusy(next) {
  busy = next; elements.create.disabled = next; elements.tabs.forEach((tab) => { tab.disabled = next; }); updateOrderActions();
}

function updateOrderActions() {
  const dirty = state.isDirty(activeType); const filtering = Boolean(elements.search.value.trim());
  elements.reset.disabled = busy || !dirty; elements.save.disabled = busy || !dirty;
  elements.status.textContent = dirty ? "顺序已调整，保存后生效。" : filtering ? "清除搜索后可调整顺序。" : "";
}

function visibleItems() {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  const items = state.getItems(activeType);
  return query ? items.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(query)) : items;
}

function renderTaxonomy() {
  const items = visibleItems(); const allItems = state.getItems(activeType); const filtering = Boolean(elements.search.value.trim());
  const tags = state.getItems("tags");
  elements.tagCount.textContent = tags.length;
  elements.tagGroupCount.textContent = state.getItems("tagGroups").length;
  elements.categoryCount.textContent = state.getItems("categories").length;
  elements.tabs.forEach((tab) => { const selected = tab.dataset.settingsTab === activeType; tab.classList.toggle("is-active", selected); tab.setAttribute("aria-selected", String(selected)); });
  const labels = { tags: ["新增标签", "搜索标签名称"], tagGroups: ["新增标签分类", "搜索标签分类名称"], categories: ["新增主分类", "搜索分类名称"] };
  elements.create.textContent = labels[activeType][0]; elements.search.placeholder = labels[activeType][1]; elements.list.classList.toggle("is-filtering", filtering);
  elements.list.innerHTML = items.length ? items.map((item) => {
    const index = allItems.findIndex((current) => current.id === item.id);
    const enriched = activeType === "tagGroups" ? { ...item, tagCount: tags.filter((tag) => Number(tag.groupId ?? tag.group_id) === Number(item.id)).length } : item;
    return renderTaxonomyItem({ ...enriched, sortOrder: index + 1 }, activeType, { canMoveUp: !filtering && index > 0, canMoveDown: !filtering && index < allItems.length - 1 });
  }).join("") : `<div class="admin-empty">${elements.search.value ? "没有匹配结果" : "暂无内容"}</div>`;
  if (filtering) elements.list.querySelectorAll("[data-sort-handle]").forEach((handle) => { handle.disabled = true; handle.title = "清除搜索后可调整顺序"; });
  updateOrderActions();
}

function render() { renderTaxonomy(); sortable?.destroy(); sortable = createSortableList({
  container: elements.list, getItems: () => state.getItems(activeType), setItems: (items) => state.setDraft(activeType, items),
  onChange: (_items, { phase }) => { if (phase === "preview") updateOrderActions(); if (phase === "end" || phase === "cancel") render(); },
}); }

async function authenticate(key) {
  keyStore.set(key);
  const [taxonomy, { categories = [] }] = await Promise.all([fetchAdminTaxonomy(client), client.request("/api/admin/categories")]);
  state = createSettingsState({ ...taxonomy, categories }); showApp(); render();
}

async function submitLogin(event) {
  event.preventDefault(); const key = elements.keyInput.value.trim();
  if (!key) { elements.loginError.textContent = "请输入管理密钥。"; return; }
  elements.loginButton.disabled = true; elements.loginError.textContent = "";
  try { await authenticate(key); } catch (error) { keyStore.clear(); if (!(error instanceof AdminUnauthorizedError)) showAuth(messageFor(error)); }
  finally { elements.loginButton.disabled = false; }
}

async function tagFormDialog(item = null) {
  const body = document.createElement("div"); body.className = "site-form";
  const nameLabel = document.createElement("label"); nameLabel.className = "admin-field";
  const name = document.createElement("input"); name.value = item?.name ?? ""; name.required = true;
  nameLabel.append(Object.assign(document.createElement("span"), { textContent: "标签名称" }), name);
  const groupLabel = document.createElement("label"); groupLabel.className = "admin-field";
  const group = document.createElement("select");
  for (const tagGroup of state.getItems("tagGroups")) { const option = new Option(tagGroup.name, tagGroup.id); option.selected = Number(tagGroup.id) === Number(item?.groupId ?? item?.group?.id); group.append(option); }
  groupLabel.append(Object.assign(document.createElement("span"), { textContent: "标签分类" }), group);
  body.append(nameLabel, groupLabel);
  return dialogs.open({ title: item ? "编辑标签" : "新增标签", body, confirmLabel: item ? "保存" : "新增", valueReader: () => ({ name: name.value.trim(), groupId: Number(group.value) }) });
}

async function createItem() {
  if (activeType === "tags") {
    if (!state.getItems("tagGroups").length) { notifier.error("请先创建标签分类。"); return; }
    const values = await tagFormDialog(); if (!values?.name || !values.groupId) return;
    setBusy(true);
    try { const { tag } = await client.request("/api/admin/tags", { method: "POST", body: JSON.stringify({ ...values, sortOrder: state.getItems("tags").length + 1, isVisible: true }) }); state.appendItem("tags", tag); render(); notifier.success(`已新增标签：${tag.name}`); }
    catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); } finally { setBusy(false); }
    return;
  }
  if (activeType === "tagGroups") {
    const name = await dialogs.textInput({ title: "新增标签分类", label: "分类名称", confirmLabel: "新增" }); if (!name) return;
    setBusy(true);
    try { const { tagGroup } = await client.request("/api/admin/tag-groups", { method: "POST", body: JSON.stringify({ name, sortOrder: state.getItems("tagGroups").length + 1 }) }); state.appendItem("tagGroups", tagGroup); render(); notifier.success(`已新增标签分类：${tagGroup.name}`); }
    catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); } finally { setBusy(false); }
    return;
  }
  const name = await dialogs.textInput({ title: "新增主分类", label: "分类名称", confirmLabel: "下一步" }); if (!name) return;
  const directorySlug = await dialogs.textInput({ title: "设置目录", label: "目录名称", helper: "创建后不可在管理台修改。", confirmLabel: "新增" }); if (!directorySlug) return;
  setBusy(true);
  try { const { category } = await client.request("/api/admin/categories", { method: "POST", body: JSON.stringify({ name, directorySlug, sortOrder: state.getItems("categories").length + 1 }) }); state.appendItem("categories", category); render(); notifier.success(`已新增主分类：${category.name}`); }
  catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); } finally { setBusy(false); }
}

async function renameItem(item) {
  const values = activeType === "tags" ? await tagFormDialog(item) : { name: await dialogs.textInput({ title: `重命名${activeType === "tagGroups" ? "标签分类" : "主分类"}`, label: "名称", value: item.name }) };
  if (!values?.name || (values.name === item.name && activeType !== "tags" && values.groupId === undefined) || (activeType === "tags" && values.name === item.name && Number(values.groupId) === Number(item.groupId ?? item.group?.id))) return;
  setBusy(true);
  try {
    const path = activeType === "tags" ? "/api/admin/tags" : activeType === "tagGroups" ? "/api/admin/tag-groups" : "/api/admin/categories";
    const payload = await client.request(path, { method: "PATCH", body: JSON.stringify({ id: item.id, ...values }) });
    const updated = payload[activeType === "tags" ? "tag" : activeType === "tagGroups" ? "tagGroup" : "category"];
    state.replaceItem(activeType, updated); render(); notifier.success(`已更新：${updated.name}`);
  } catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); } finally { setBusy(false); }
}

async function toggleVisibility(item) {
  setBusy(true);
  try { const { tag } = await client.request("/api/admin/tags", { method: "PATCH", body: JSON.stringify({ id: item.id, isVisible: !item.isVisible }) }); state.replaceItem("tags", tag); render(); notifier.success(`${tag.name}已${tag.isVisible ? "显示" : "隐藏"}`); }
  catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); } finally { setBusy(false); }
}

async function deleteItem(item) {
  const isGroup = activeType === "tagGroups"; const label = isGroup ? "标签分类" : activeType === "tags" ? "标签" : "主分类";
  const confirmed = await dialogs.confirm({ title: `删除${label}`, message: `确定删除“${item.name}”吗？${isGroup ? "分类内必须没有标签。" : "图片不会被删除。"}`, confirmLabel: "删除", danger: true }); if (!confirmed) return;
  setBusy(true);
  try {
    const path = isGroup ? "/api/admin/tag-groups" : activeType === "tags" ? "/api/admin/tags" : "/api/admin/categories";
    await client.request(path, { method: "DELETE", body: JSON.stringify({ id: item.id }) }); state.removeItem(activeType, item.id); render(); notifier.success(`已删除${label}：${item.name}`);
  } catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); } finally { setBusy(false); }
}

async function saveOrder() {
  const type = activeType; setBusy(true);
  try { const payload = await client.request(`/api/admin/${type === "tagGroups" ? "tag-groups" : type}/reorder`, { method: "PATCH", body: JSON.stringify({ items: state.serialize(type) }) }); state.commitDraft(type, payload[type]); render(); notifier.success("排序已保存"); }
  catch (error) { if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error)); updateOrderActions(); } finally { setBusy(false); }
}

elements.loginForm.addEventListener("submit", submitLogin);
elements.passwordToggle.addEventListener("click", () => { const visible = elements.keyInput.type === "text"; elements.keyInput.type = visible ? "password" : "text"; elements.passwordToggle.textContent = visible ? "显示" : "隐藏"; elements.passwordToggle.setAttribute("aria-label", visible ? "显示管理密钥" : "隐藏管理密钥"); });
elements.logout.addEventListener("click", () => { keyStore.clear(); state = createSettingsState(); showAuth(); });
elements.tabs.forEach((tab) => tab.addEventListener("click", () => { activeType = tab.dataset.settingsTab; elements.search.value = ""; render(); }));
elements.search.addEventListener("input", render); elements.create.addEventListener("click", createItem);
elements.reset.addEventListener("click", () => { state.resetDraft(activeType); render(); }); elements.save.addEventListener("click", saveOrder);
elements.list.addEventListener("click", (event) => {
  if (busy) return; const action = event.target.closest("[data-action]")?.dataset.action; const row = event.target.closest("[data-sort-id]"); if (!action || !row) return;
  const item = state.getItems(activeType).find((candidate) => String(candidate.id) === row.dataset.sortId); if (!item) return;
  if (action === "move-up" || action === "move-down") { const items = [...state.getItems(activeType)]; const index = items.findIndex((candidate) => candidate.id === item.id); const target = index + (action === "move-up" ? -1 : 1); if (target < 0 || target >= items.length) return; [items[index], items[target]] = [items[target], items[index]]; state.setDraft(activeType, items); render(); requestAnimationFrame(() => elements.list.querySelector(`[data-sort-id="${item.id}"] [data-action="${action}"]`)?.focus()); return; }
  if (action === "rename") renameItem(item); if (action === "toggle-visibility") toggleVisibility(item); if (action === "delete") deleteItem(item);
});

if (keyStore.get()) authenticate(keyStore.get()).catch((error) => { if (!(error instanceof AdminUnauthorizedError)) showAuth(messageFor(error)); }); else showAuth();
