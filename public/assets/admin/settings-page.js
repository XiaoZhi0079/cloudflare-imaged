import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore, fetchAdminTaxonomy } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createNotifier } from "./notifications.js";
import { renderTagTreeGroup, renderTaxonomyItem } from "./renderers/taxonomy-item.js";
import { createSettingsState } from "./settings-state.js";
import { createSortableList } from "./sortable-list.js";

const elements = {
  authView: document.querySelector("#admin-auth-view"),
  app: document.querySelector("#admin-app"),
  loginForm: document.querySelector("#admin-login-form"),
  loginButton: document.querySelector("#admin-login"),
  loginError: document.querySelector("#admin-login-error"),
  keyInput: document.querySelector("#admin-key"),
  passwordToggle: document.querySelector("[data-toggle-password]"),
  logout: document.querySelector("[data-admin-logout]"),
  create: document.querySelector("#taxonomy-create"),
  createGroup: document.querySelector("#tag-group-create"),
  createCategory: document.querySelector("#category-create"),
  search: document.querySelector("#taxonomy-search"),
  tagList: document.querySelector("#tag-taxonomy-list"),
  categoryList: document.querySelector("#category-taxonomy-list"),
  tagStatus: document.querySelector("#tag-taxonomy-status"),
  categoryStatus: document.querySelector("#category-taxonomy-status"),
  tagReset: document.querySelector("#tag-taxonomy-reset-order"),
  tagSave: document.querySelector("#tag-taxonomy-save-order"),
  categoryReset: document.querySelector("#category-taxonomy-reset-order"),
  categorySave: document.querySelector("#category-taxonomy-save-order"),
  tagCount: document.querySelector("#tag-count"),
  tagGroupCount: document.querySelector("#tag-group-count"),
  categoryCount: document.querySelector("#category-count"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(document.querySelector("#admin-dialog-host"));
const notifier = createNotifier(document.querySelector("#admin-toast-host"));
let state = createSettingsState();
let categorySortable = null;
let busy = false;
let draggedTagId = null;
const expandedGroups = new Set();

function showAuth(message = "") {
  elements.app.hidden = true;
  elements.authView.hidden = false;
  elements.loginError.textContent = message;
  elements.keyInput.value = keyStore.get();
  requestAnimationFrame(() => elements.keyInput.focus());
}

function showApp() {
  elements.authView.hidden = true;
  elements.app.hidden = false;
}

const client = createAdminApiClient({
  getKey: () => keyStore.get(),
  onUnauthorized: () => {
    keyStore.clear();
    showAuth("登录状态已失效，请重新输入管理密钥。");
  },
});

function messageFor(error) {
  return error?.message || "操作失败，请稍后重试。";
}

function setBusy(next) {
  busy = next;
  elements.create.disabled = next;
  elements.createGroup.disabled = next;
  elements.createCategory.disabled = next;
  updateOrderActions();
}

function updateOrderAction(type, reset, save, status, label) {
  const dirty = state.isDirty(type);
  const filtering = Boolean(elements.search.value.trim());
  reset.disabled = busy || !dirty;
  save.disabled = busy || !dirty;
  status.textContent = dirty
    ? `${label}顺序已调整，保存后生效。`
    : filtering ? "清除搜索后可调整顺序。" : "";
}

function updateOrderActions() {
  updateOrderAction("tagGroups", elements.tagReset, elements.tagSave, elements.tagStatus, "标签分类");
  updateOrderAction("categories", elements.categoryReset, elements.categorySave, elements.categoryStatus, "目录");
}

function tagGroupId(tag) {
  return Number(tag.groupId ?? tag.group?.id);
}

function groupedTags() {
  const tagsByGroup = new Map();
  for (const tag of state.getItems("tags")) {
    const id = tagGroupId(tag);
    const tags = tagsByGroup.get(id) ?? [];
    tags.push(tag);
    tagsByGroup.set(id, tags);
  }
  return state.getItems("tagGroups").map((group) => ({
    ...group,
    tags: tagsByGroup.get(Number(group.id)) ?? [],
  }));
}

function filteredTagGroups() {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  return groupedTags().map((group) => {
    if (!query || group.name.toLocaleLowerCase("zh-CN").includes(query)) return group;
    return { ...group, tags: group.tags.filter((tag) => tag.name.toLocaleLowerCase("zh-CN").includes(query)) };
  }).filter((group) => !query || group.name.toLocaleLowerCase("zh-CN").includes(query) || group.tags.length);
}

function visibleCategoryItems() {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  const items = state.getItems("categories");
  return query ? items.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(query)) : items;
}

function renderTags() {
  const groups = filteredTagGroups();
  const allGroups = state.getItems("tagGroups");
  elements.tagList.classList.toggle("is-filtering", Boolean(elements.search.value.trim()));
  elements.tagList.innerHTML = groups.length
    ? `<div class="tag-tree-list">${groups.map((group) => {
      const index = allGroups.findIndex((item) => Number(item.id) === Number(group.id));
      const expanded = elements.search.value.trim()
        ? true
        : expandedGroups.has(Number(group.id));
      return renderTagTreeGroup({ ...group, sortOrder: index + 1 }, group.tags, {
        expanded,
        canMoveUp: !elements.search.value.trim() && index > 0,
        canMoveDown: !elements.search.value.trim() && index < allGroups.length - 1,
      });
    }).join("")}</div>`
    : `<div class="admin-empty">${elements.search.value ? "没有匹配结果" : "暂无标签分类"}</div>`;
}

function renderCategories() {
  const items = visibleCategoryItems();
  const allItems = state.getItems("categories");
  const filtering = Boolean(elements.search.value.trim());
  elements.categoryList.classList.toggle("is-filtering", filtering);
  elements.categoryList.innerHTML = items.length
    ? items.map((item) => {
      const index = allItems.findIndex((current) => current.id === item.id);
      return renderTaxonomyItem({ ...item, sortOrder: index + 1 }, "categories", {
        canMoveUp: !filtering && index > 0,
        canMoveDown: !filtering && index < allItems.length - 1,
      });
    }).join("")
    : `<div class="admin-empty">${elements.search.value ? "没有匹配结果" : "暂无内容"}</div>`;
  if (filtering) {
    elements.categoryList.querySelectorAll("[data-sort-handle]").forEach((handle) => {
      handle.disabled = true;
      handle.title = "清除搜索后可调整顺序";
    });
  }
}

function renderTaxonomy() {
  elements.tagCount.textContent = state.getItems("tags").length;
  elements.tagGroupCount.textContent = state.getItems("tagGroups").length;
  elements.categoryCount.textContent = state.getItems("categories").length;
  renderTags();
  renderCategories();
  updateOrderActions();
}

function render() {
  categorySortable?.destroy();
  categorySortable = null;
  renderTaxonomy();
  categorySortable = createSortableList({
    container: elements.categoryList,
    getItems: () => state.getItems("categories"),
    setItems: (items) => state.setDraft("categories", items),
    onChange: (_items, { phase }) => {
      if (phase === "preview") updateOrderActions();
      if (phase === "end" || phase === "cancel") render();
    },
  });
}

async function authenticate(key) {
  keyStore.set(key);
  const [taxonomy, { categories = [] }] = await Promise.all([
    fetchAdminTaxonomy(client),
    client.request("/api/admin/categories"),
  ]);
  state = createSettingsState({ ...taxonomy, categories });
  expandedGroups.clear();
  for (const group of taxonomy.tagGroups) expandedGroups.add(Number(group.id));
  showApp();
  render();
}

async function submitLogin(event) {
  event.preventDefault();
  const key = elements.keyInput.value.trim();
  if (!key) {
    elements.loginError.textContent = "请输入管理密钥。";
    return;
  }
  elements.loginButton.disabled = true;
  elements.loginError.textContent = "";
  try {
    await authenticate(key);
  } catch (error) {
    keyStore.clear();
    if (!(error instanceof AdminUnauthorizedError)) showAuth(messageFor(error));
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function tagFormDialog(item = null, initialGroupId = null) {
  const body = document.createElement("div");
  body.className = "site-form";
  const nameLabel = document.createElement("label");
  nameLabel.className = "admin-field";
  const name = document.createElement("input");
  name.value = item?.name ?? "";
  name.required = true;
  nameLabel.append(Object.assign(document.createElement("span"), { textContent: "标签名称" }), name);
  const groupLabel = document.createElement("label");
  groupLabel.className = "admin-field";
  const group = document.createElement("select");
  const selectedGroupId = item?.groupId ?? item?.group?.id ?? initialGroupId;
  for (const tagGroup of state.getItems("tagGroups")) {
    const option = new Option(tagGroup.name, tagGroup.id);
    option.selected = Number(tagGroup.id) === Number(selectedGroupId);
    group.append(option);
  }
  groupLabel.append(Object.assign(document.createElement("span"), { textContent: "标签分类" }), group);
  body.append(nameLabel, groupLabel);
  return dialogs.open({
    title: item ? "编辑标签" : "新增标签",
    body,
    confirmLabel: item ? "保存" : "新增",
    valueReader: () => ({ name: name.value.trim(), groupId: Number(group.value) }),
  });
}

async function createTag(initialGroupId = null) {
  if (!state.getItems("tagGroups").length) {
    notifier.error("请先创建标签分类。");
    return;
  }
  const values = await tagFormDialog(null, initialGroupId);
  if (!values?.name || !values.groupId) return;
  setBusy(true);
  try {
    const { tag } = await client.request("/api/admin/tags", {
      method: "POST",
      body: JSON.stringify({ ...values, sortOrder: state.getItems("tags").length + 1, isVisible: true }),
    });
    state.appendItem("tags", tag);
    expandedGroups.add(Number(values.groupId));
    render();
    notifier.success(`已新增标签：${tag.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function createTagGroup() {
  const name = await dialogs.textInput({ title: "新增标签分类", label: "分类名称", confirmLabel: "新增" });
  if (!name) return;
  setBusy(true);
  try {
    const { tagGroup } = await client.request("/api/admin/tag-groups", {
      method: "POST",
      body: JSON.stringify({ name, sortOrder: state.getItems("tagGroups").length + 1 }),
    });
    state.appendItem("tagGroups", tagGroup);
    expandedGroups.add(Number(tagGroup.id));
    render();
    notifier.success(`已新增标签分类：${tagGroup.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function createCategory() {
  const name = await dialogs.textInput({ title: "新增目录", label: "显示名称", confirmLabel: "下一步" });
  if (!name) return;
  const directorySlug = await dialogs.textInput({ title: "设置目录", label: "目录名称", helper: "创建后不可在管理台修改。", confirmLabel: "新增" });
  if (!directorySlug) return;
  setBusy(true);
  try {
    const { category } = await client.request("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name, directorySlug, sortOrder: state.getItems("categories").length + 1 }),
    });
    state.appendItem("categories", category);
    render();
    notifier.success(`已新增目录：${category.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function renameTag(tag) {
  const values = await tagFormDialog(tag);
  if (!values?.name || (values.name === tag.name && Number(values.groupId) === tagGroupId(tag))) return;
  setBusy(true);
  try {
    const { tag: updated } = await client.request("/api/admin/tags", {
      method: "PATCH",
      body: JSON.stringify({ id: tag.id, ...values }),
    });
    state.replaceItem("tags", updated);
    expandedGroups.add(Number(values.groupId));
    render();
    notifier.success(`已更新标签：${updated.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function renameGroup(group) {
  const name = await dialogs.textInput({ title: "重命名标签分类", label: "分类名称", value: group.name });
  if (!name || name === group.name) return;
  setBusy(true);
  try {
    const { tagGroup } = await client.request("/api/admin/tag-groups", {
      method: "PATCH",
      body: JSON.stringify({ id: group.id, name }),
    });
    state.replaceItem("tagGroups", tagGroup);
    render();
    notifier.success(`已重命名为：${tagGroup.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function renameCategory(category) {
  const name = await dialogs.textInput({ title: "重命名目录", label: "名称", value: category.name });
  if (!name || name === category.name) return;
  setBusy(true);
  try {
    const { category: updated } = await client.request("/api/admin/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: category.id, name }),
    });
    state.replaceItem("categories", updated);
    render();
    notifier.success(`已重命名为：${updated.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function toggleVisibility(tag) {
  setBusy(true);
  try {
    const { tag: updated } = await client.request("/api/admin/tags", {
      method: "PATCH",
      body: JSON.stringify({ id: tag.id, isVisible: !tag.isVisible }),
    });
    state.replaceItem("tags", updated);
    render();
    notifier.success(`${updated.name}已${updated.isVisible ? "显示" : "隐藏"}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function deleteTag(tag) {
  const confirmed = await dialogs.confirm({ title: "删除标签", message: `确定删除“${tag.name}”吗？图片不会被删除。`, confirmLabel: "删除", danger: true });
  if (!confirmed) return;
  setBusy(true);
  try {
    await client.request("/api/admin/tags", { method: "DELETE", body: JSON.stringify({ id: tag.id }) });
    state.removeItem("tags", tag.id);
    render();
    notifier.success(`已删除标签：${tag.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function deleteGroup(group) {
  const confirmed = await dialogs.confirm({ title: "删除标签分类", message: `确定删除“${group.name}”吗？分类内必须没有标签。`, confirmLabel: "删除", danger: true });
  if (!confirmed) return;
  setBusy(true);
  try {
    await client.request("/api/admin/tag-groups", { method: "DELETE", body: JSON.stringify({ id: group.id }) });
    state.removeItem("tagGroups", group.id);
    expandedGroups.delete(Number(group.id));
    render();
    notifier.success(`已删除标签分类：${group.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

function moveDraftItem(type, id, direction) {
  const items = [...state.getItems(type)];
  const index = items.findIndex((item) => Number(item.id) === Number(id));
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  state.setDraft(type, items);
  render();
}

async function moveTagToGroup(tagId, groupId) {
  const tag = state.getItems("tags").find((item) => Number(item.id) === Number(tagId));
  if (!tag || tagGroupId(tag) === Number(groupId)) return;
  setBusy(true);
  try {
    const { tag: updated } = await client.request("/api/admin/tags", {
      method: "PATCH",
      body: JSON.stringify({ id: tag.id, groupId: Number(groupId) }),
    });
    state.replaceItem("tags", updated);
    expandedGroups.add(Number(groupId));
    render();
    notifier.success(`已将“${updated.name}”移入新的标签分类`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function saveOrder(type) {
  setBusy(true);
  try {
    const endpoint = type === "tagGroups" ? "tag-groups" : type;
    const payload = await client.request(`/api/admin/${endpoint}/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ items: state.serialize(type) }),
    });
    state.commitDraft(type, payload[type]);
    render();
    notifier.success("排序已保存");
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
    updateOrderActions();
  } finally {
    setBusy(false);
  }
}

elements.loginForm.addEventListener("submit", submitLogin);
elements.passwordToggle.addEventListener("click", () => {
  const visible = elements.keyInput.type === "text";
  elements.keyInput.type = visible ? "password" : "text";
  elements.passwordToggle.textContent = visible ? "显示" : "隐藏";
  elements.passwordToggle.setAttribute("aria-label", visible ? "显示管理密钥" : "隐藏管理密钥");
});
elements.logout.addEventListener("click", () => {
  keyStore.clear();
  state = createSettingsState();
  showAuth();
});
elements.search.addEventListener("input", render);
elements.create.addEventListener("click", () => createTag());
elements.createGroup.addEventListener("click", createTagGroup);
elements.createCategory.addEventListener("click", createCategory);
elements.tagReset.addEventListener("click", () => { state.resetDraft("tagGroups"); render(); });
elements.tagSave.addEventListener("click", () => saveOrder("tagGroups"));
elements.categoryReset.addEventListener("click", () => { state.resetDraft("categories"); render(); });
elements.categorySave.addEventListener("click", () => saveOrder("categories"));

elements.tagList.addEventListener("click", (event) => {
  if (busy) return;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const tagRow = event.target.closest("[data-tag-id]");
  const groupRow = event.target.closest("[data-tag-group-id]");
  if (action === "toggle-group" && groupRow) {
    const id = Number(groupRow.dataset.tagGroupId);
    if (expandedGroups.has(id)) expandedGroups.delete(id); else expandedGroups.add(id);
    render();
    return;
  }
  if (action === "add-tag" && groupRow) { createTag(Number(groupRow.dataset.tagGroupId)); return; }
  if (action === "rename-group" && groupRow) { const group = state.getItems("tagGroups").find((item) => Number(item.id) === Number(groupRow.dataset.tagGroupId)); if (group) renameGroup(group); return; }
  if (action === "delete-group" && groupRow) { const group = state.getItems("tagGroups").find((item) => Number(item.id) === Number(groupRow.dataset.tagGroupId)); if (group) deleteGroup(group); return; }
  if ((action === "move-up" || action === "move-down") && groupRow) { moveDraftItem("tagGroups", groupRow.dataset.tagGroupId, action === "move-up" ? -1 : 1); return; }
  if (!tagRow) return;
  const tag = state.getItems("tags").find((item) => Number(item.id) === Number(tagRow.dataset.tagId));
  if (!tag) return;
  if (action === "edit-tag") renameTag(tag);
  if (action === "toggle-visibility") toggleVisibility(tag);
  if (action === "delete-tag") deleteTag(tag);
});

elements.categoryList.addEventListener("click", (event) => {
  if (busy) return;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const row = event.target.closest("[data-sort-id]");
  if (!row) return;
  const item = state.getItems("categories").find((candidate) => String(candidate.id) === row.dataset.sortId);
  if (!item) return;
  if (action === "move-up" || action === "move-down") moveDraftItem("categories", item.id, action === "move-up" ? -1 : 1);
  if (action === "rename") renameCategory(item);
});

elements.tagList.addEventListener("dragstart", (event) => {
  const tagRow = event.target.closest("[data-tag-id]");
  if (!tagRow || busy) return;
  draggedTagId = Number(tagRow.dataset.tagId);
  tagRow.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedTagId));
});
elements.tagList.addEventListener("dragend", (event) => {
  event.target.closest("[data-tag-id]")?.classList.remove("is-dragging");
  elements.tagList.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
  draggedTagId = null;
});
elements.tagList.addEventListener("dragover", (event) => {
  const group = event.target.closest("[data-tag-drop-zone]");
  if (!group || draggedTagId === null || busy) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  group.classList.add("is-drop-target");
});
elements.tagList.addEventListener("dragleave", (event) => {
  const group = event.target.closest("[data-tag-drop-zone]");
  if (group && (!event.relatedTarget || !group.contains(event.relatedTarget))) group.classList.remove("is-drop-target");
});
elements.tagList.addEventListener("drop", (event) => {
  const group = event.target.closest("[data-tag-drop-zone]");
  if (!group || draggedTagId === null || busy) return;
  event.preventDefault();
  const tagId = draggedTagId;
  draggedTagId = null;
  group.classList.remove("is-drop-target");
  elements.tagList.querySelectorAll(".is-dragging").forEach((item) => item.classList.remove("is-dragging"));
  moveTagToGroup(tagId, Number(group.dataset.tagGroupId));
});

if (keyStore.get()) {
  authenticate(keyStore.get()).catch((error) => {
    if (!(error instanceof AdminUnauthorizedError)) showAuth(messageFor(error));
  });
} else {
  showAuth();
}
