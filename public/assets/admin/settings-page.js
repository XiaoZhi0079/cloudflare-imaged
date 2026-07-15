import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore, verifyAdminKey } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createNotifier } from "./notifications.js";
import { renderTaxonomyItem } from "./renderers/taxonomy-item.js";
import { createSettingsState } from "./settings-state.js";
import { createSiteSettingsController } from "./site-settings.js";
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
  tabs: [...document.querySelectorAll("[data-settings-tab]")],
  create: document.querySelector("#taxonomy-create"),
  search: document.querySelector("#taxonomy-search"),
  list: document.querySelector("#taxonomy-list"),
  status: document.querySelector("#taxonomy-status"),
  reset: document.querySelector("#taxonomy-reset-order"),
  save: document.querySelector("#taxonomy-save-order"),
  tagCount: document.querySelector("#tag-count"),
  categoryCount: document.querySelector("#category-count"),
  taxonomyPanel: document.querySelector("#taxonomy-panel"),
  sitePanel: document.querySelector("#site-panel"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(document.querySelector("#admin-dialog-host"));
const notifier = createNotifier(document.querySelector("#admin-toast-host"));
let state = createSettingsState();
let activeType = "tags";
let sortable = null;
let busy = false;
let siteController = null;

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

function isSiteTab() {
  return activeType === "site";
}

function setBusy(next) {
  busy = next;
  elements.create.disabled = next || isSiteTab();
  elements.tabs.forEach((tab) => { tab.disabled = next; });
  updateOrderActions();
}

function updateOrderActions() {
  if (isSiteTab()) {
    elements.reset.disabled = true;
    elements.save.disabled = true;
    elements.status.textContent = "";
    return;
  }
  const dirty = state.isDirty(activeType);
  const filtering = Boolean(elements.search.value.trim());
  elements.reset.disabled = busy || !dirty;
  elements.save.disabled = busy || !dirty;
  elements.status.textContent = dirty
    ? "顺序已调整，保存后生效。"
    : filtering ? "清除搜索后可调整顺序。" : "";
}

function visibleItems() {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  const items = state.getItems(activeType);
  return query ? items.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(query)) : items;
}

function renderTaxonomy() {
  const items = visibleItems();
  const allItems = state.getItems(activeType);
  const filtering = Boolean(elements.search.value.trim());
  elements.tagCount.textContent = state.getItems("tags").length;
  elements.categoryCount.textContent = state.getItems("categories").length;
  elements.tabs.forEach((tab) => {
    const selected = tab.dataset.settingsTab === activeType;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  elements.create.hidden = isSiteTab();
  elements.create.textContent = activeType === "tags" ? "新增标签" : "新增主分类";
  elements.search.placeholder = activeType === "tags" ? "搜索标签名称" : "搜索分类名称";
  elements.list.classList.toggle("is-filtering", filtering);
  elements.list.innerHTML = items.length
    ? items.map((item) => {
      const index = allItems.findIndex((current) => current.id === item.id);
      return renderTaxonomyItem({ ...item, sortOrder: index + 1 }, activeType, {
        canMoveUp: !filtering && index > 0,
        canMoveDown: !filtering && index < allItems.length - 1,
      });
    }).join("")
    : `<div class="admin-empty">${elements.search.value ? "没有匹配结果" : "暂无内容"}</div>`;
  if (filtering) {
    elements.list.querySelectorAll("[data-sort-handle]").forEach((handle) => {
      handle.disabled = true;
      handle.title = "清除搜索后可调整顺序";
    });
  }
  updateOrderActions();
}

function render() {
  const siteMode = isSiteTab();
  elements.taxonomyPanel.hidden = siteMode;
  elements.sitePanel.hidden = !siteMode;
  elements.tabs.forEach((tab) => {
    const selected = tab.dataset.settingsTab === activeType;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  elements.create.hidden = siteMode;
  if (!siteMode) {
    renderTaxonomy();
    attachSortable();
  } else {
    sortable?.destroy();
    sortable = null;
    updateOrderActions();
  }
}

function attachSortable() {
  sortable?.destroy();
  if (isSiteTab()) {
    sortable = null;
    return;
  }
  sortable = createSortableList({
    container: elements.list,
    getItems: () => state.getItems(activeType),
    setItems: (items) => state.setDraft(activeType, items),
    onChange: (_items, { phase }) => {
      if (phase === "preview") updateOrderActions();
      if (phase === "end" || phase === "cancel") render();
    },
  });
}

async function ensureSiteController() {
  if (siteController) return siteController;
  siteController = createSiteSettingsController({
    root: elements.sitePanel,
    client,
    dialogs,
    notifier,
    onBusyChange: (next) => setBusy(next),
  });
  siteController.bind();
  return siteController;
}

async function authenticate(key) {
  keyStore.set(key);
  const tags = await verifyAdminKey(client);
  const { categories = [] } = await client.request("/api/admin/categories");
  state = createSettingsState({ tags, categories });
  showApp();
  render();
  if (isSiteTab()) {
    await (await ensureSiteController()).load();
  } else {
    attachSortable();
  }
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
    if (!(error instanceof AdminUnauthorizedError)) {
      showAuth(messageFor(error));
    }
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function createItem() {
  if (isSiteTab()) return;
  if (activeType === "tags") {
    const name = await dialogs.textInput({ title: "新增标签", label: "标签名称", confirmLabel: "新增" });
    if (!name) return;
    setBusy(true);
    try {
      const { tag } = await client.request("/api/admin/tags", {
        method: "POST",
        body: JSON.stringify({ name, sortOrder: state.getItems("tags").length + 1, isVisible: true }),
      });
      state.appendItem("tags", tag);
      render();
      notifier.success(`已新增标签：${tag.name}`);
    } catch (error) {
      if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
    } finally {
      setBusy(false);
    }
    return;
  }

  const name = await dialogs.textInput({ title: "新增主分类", label: "分类名称", confirmLabel: "下一步" });
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
    notifier.success(`已新增主分类：${category.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function renameItem(item) {
  const name = await dialogs.textInput({ title: `重命名${activeType === "tags" ? "标签" : "主分类"}`, label: "名称", value: item.name });
  if (!name || name === item.name) return;
  setBusy(true);
  try {
    const path = activeType === "tags" ? "/api/admin/tags" : "/api/admin/categories";
    const payload = await client.request(path, { method: "PATCH", body: JSON.stringify({ id: item.id, name }) });
    const updated = payload[activeType === "tags" ? "tag" : "category"];
    state.replaceItem(activeType, updated);
    render();
    notifier.success(`已重命名为：${updated.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function toggleVisibility(item) {
  setBusy(true);
  try {
    const { tag } = await client.request("/api/admin/tags", {
      method: "PATCH",
      body: JSON.stringify({ id: item.id, isVisible: !item.isVisible }),
    });
    state.replaceItem("tags", tag);
    render();
    notifier.success(`${tag.name}已${tag.isVisible ? "显示" : "隐藏"}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function deleteTag(item) {
  const confirmed = await dialogs.confirm({
    title: "删除标签",
    message: `确定删除“${item.name}”吗？图片不会被删除。`,
    confirmLabel: "删除",
    danger: true,
  });
  if (!confirmed) return;
  setBusy(true);
  try {
    await client.request("/api/admin/tags", { method: "DELETE", body: JSON.stringify({ id: item.id }) });
    state.removeItem("tags", item.id);
    render();
    notifier.success(`已删除标签：${item.name}`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
  } finally {
    setBusy(false);
  }
}

async function saveOrder() {
  if (isSiteTab()) return;
  const type = activeType;
  setBusy(true);
  try {
    const payload = await client.request(`/api/admin/${type}/reorder`, {
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
elements.tabs.forEach((tab) => tab.addEventListener("click", async () => {
  activeType = tab.dataset.settingsTab;
  elements.search.value = "";
  render();
  if (isSiteTab()) {
    try {
      await (await ensureSiteController()).load();
    } catch (error) {
      if (!(error instanceof AdminUnauthorizedError)) notifier.error(messageFor(error));
    }
  }
}));
elements.search.addEventListener("input", () => {
  if (!isSiteTab()) render();
});
elements.create.addEventListener("click", createItem);
elements.reset.addEventListener("click", () => {
  if (isSiteTab()) return;
  state.resetDraft(activeType);
  render();
});
elements.save.addEventListener("click", saveOrder);
elements.list.addEventListener("click", (event) => {
  if (busy || isSiteTab()) return;
  const action = event.target.closest("[data-action]")?.dataset.action;
  const row = event.target.closest("[data-sort-id]");
  if (!action || !row) return;
  const item = state.getItems(activeType).find((candidate) => String(candidate.id) === row.dataset.sortId);
  if (!item) return;
  if (action === "move-up" || action === "move-down") {
    const items = [...state.getItems(activeType)];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + (action === "move-up" ? -1 : 1);
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    state.setDraft(activeType, items);
    render();
    requestAnimationFrame(() => elements.list.querySelector(`[data-sort-id="${item.id}"] [data-action="${action}"]`)?.focus());
    return;
  }
  if (action === "rename") renameItem(item);
  if (action === "toggle-visibility") toggleVisibility(item);
  if (action === "delete") deleteTag(item);
});

if (keyStore.get()) {
  authenticate(keyStore.get()).catch((error) => {
    if (!(error instanceof AdminUnauthorizedError)) showAuth(messageFor(error));
  });
} else {
  showAuth();
}
