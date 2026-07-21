import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore, fetchAdminTaxonomy } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createLibraryState } from "./library-state.js?v=20260715-featured-filter-separation";
import { createNotifier } from "./notifications.js";
import { renderImageCard } from "./renderers/image-card.js?v=20260721-single-image-delete";
import { createUploadRunner, describeUploadFailure, measureImageFile } from "./upload.js";

const elements = {
  authView: document.querySelector("#admin-auth-view"),
  app: document.querySelector("#admin-app"),
  loginForm: document.querySelector("#admin-login-form"),
  loginButton: document.querySelector("#admin-login"),
  loginError: document.querySelector("#admin-login-error"),
  keyInput: document.querySelector("#admin-key"),
  passwordToggle: document.querySelector("[data-toggle-password]"),
  logout: document.querySelector("[data-admin-logout]"),
  visibleCount: document.querySelector("#admin-visible-count"),
  search: document.querySelector("#admin-search"),
  sort: document.querySelector("#admin-sort"),
  filterToggle: document.querySelector("#admin-filter-toggle"),
  filterRail: document.querySelector("#admin-filters"),
  density: document.querySelector("#admin-density"),
  clearFilters: document.querySelector("#admin-clear-filters"),
  tagFilterSearch: document.querySelector("#tag-filter-search"),
  selectedTagCount: document.querySelector("#tag-filter-selected-count"),
  tagFilters: document.querySelector("#tag-filter-list"),
  imageList: document.querySelector("#image-list"),
  loadMore: document.querySelector("#admin-load-more"),
  uploadOpen: document.querySelector("#admin-upload-open"),
  bulkToggle: document.querySelector("#admin-bulk-toggle"),
  uploadDialog: document.querySelector("#admin-upload-dialog"),
  detailOverlay: document.querySelector("#admin-detail-overlay"),
  bulkToolbar: document.querySelector("#admin-bulk-toolbar"),
  bulkCount: document.querySelector("#bulk-selected-count"),
  bulkTags: document.querySelector("#bulk-assign-tags"),
  bulkCategory: document.querySelector("#bulk-assign-category"),
  bulkDelete: document.querySelector("#bulk-delete"),
  bulkClear: document.querySelector("#bulk-clear-selection"),
  dialogHost: document.querySelector("#admin-dialog-host"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(elements.dialogHost);
const notifier = createNotifier(document.querySelector("#admin-toast-host"));
let state = createLibraryState();
let searchTimer = null;
let compact = false;
let bulkMode = false;
let detailImageId = null;
let detailOpener = null;
let uploadSession = null;

function showAuth(message = "") {
  state = createLibraryState();
  bulkMode = false;
  closeDetail({ restoreFocus: false });
  closeUpload({ restoreFocus: false });
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

function errorMessage(error) {
  return error?.message || "操作失败，请稍后重试。";
}

function createElement(tag, attributes = {}, text = "") {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "className") element.className = value;
    else if (name === "checked") element.checked = Boolean(value);
    else if (name === "value") element.value = value;
    else element.setAttribute(name, value);
  }
  if (text) element.textContent = text;
  return element;
}

function focusableElements(root) {
  return [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
}

function trapFocus(event, root) {
  if (event.key !== "Tab") return;
  const focusable = focusableElements(root);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function selectedImages() {
  const ids = state.getSelectedIds();
  return state.getImages().filter((image) => ids.has(Number(image.id)));
}

function replaceImages(updates) {
  const replacements = new Map(updates.map((image) => [Number(image.id), image]));
  state.syncImages(state.getImages().map((image) => replacements.get(Number(image.id)) ?? image));
}

function setBulkMode(next) {
  bulkMode = Boolean(next);
  if (!bulkMode) state.clearSelection();
  renderLibrary();
}

function groupedTags(options = state.getTags()) {
  const optionsByGroup = new Map();
  for (const option of options) {
    const groupId = Number(option.groupId ?? option.group?.id);
    const current = optionsByGroup.get(groupId) ?? [];
    current.push(option);
    optionsByGroup.set(groupId, current);
  }
  const groups = state.getTagGroups().map((group) => ({ ...group, tags: optionsByGroup.get(Number(group.id)) ?? [] }));
  const knownIds = new Set(groups.map((group) => Number(group.id)));
  const ungrouped = options.filter((option) => !knownIds.has(Number(option.groupId ?? option.group?.id)));
  if (ungrouped.length) groups.push({ id: "ungrouped", name: "未分类", tags: ungrouped });
  return groups.filter((group) => group.tags.length);
}

function appendGroupedTagChoices(container, { selectedNames = new Set(), labelClass = "detail-check" } = {}) {
  const inputs = [];
  for (const group of groupedTags()) {
    const section = createElement("section", { className: "tag-choice-group" });
    section.append(createElement("h4", {}, group.name));
    const choices = createElement("div", { className: "tag-choice-options" });
    for (const tag of group.tags) {
      const input = createElement("input", { type: "checkbox", value: tag.id, checked: selectedNames.has(tag.name) });
      const label = createElement("label", { className: labelClass });
      label.append(input, createElement("span", {}, tag.name));
      choices.append(label); inputs.push(input);
    }
    section.append(choices); container.append(section);
  }
  return inputs;
}

function renderFilters() {
  const { tagNames } = state.getFilters();
  const tagQuery = elements.tagFilterSearch.value.trim().toLocaleLowerCase("zh-CN");
  elements.selectedTagCount.textContent = `已选 ${tagNames.size}`;
  elements.tagFilters.replaceChildren();
  const matchingTags = state.getTags().filter((item) => !tagQuery || item.name.toLocaleLowerCase("zh-CN").includes(tagQuery));
  for (const group of groupedTags(matchingTags)) {
    const section = createElement("section", { className: "filter-tag-group" });
    section.append(createElement("h4", {}, group.name));
    const options = createElement("div", { className: "filter-tag-group-options" });
    for (const tag of group.tags) {
      const count = state.getImages().filter((image) => (image.tags ?? []).includes(tag.name)).length;
      const selected = tagNames.has(tag.name);
      const label = createElement("label", { className: `filter-option filter-tag-option${selected ? " is-selected" : ""}` });
      const input = createElement("input", { type: "checkbox", value: tag.name, checked: selected });
      input.addEventListener("change", () => {
        const next = state.getFilters().tagNames;
        if (input.checked) next.add(tag.name); else next.delete(tag.name);
        state.setTagsFilter(next); label.classList.toggle("is-selected", input.checked);
        elements.selectedTagCount.textContent = `已选 ${next.size}`; renderLibrary();
      });
      label.append(input, createElement("span", {}, tag.name), createElement("small", {}, count)); options.append(label);
    }
    section.append(options); elements.tagFilters.append(section);
  }
}

function renderLibrary() {
  const visible = state.visibleImages();
  const rendered = state.renderedImages();
  const selectedIds = state.getSelectedIds();
  elements.visibleCount.textContent = visible.length === state.getImages().length
    ? String(visible.length)
    : `${visible.length} / ${state.getImages().length}`;
  elements.imageList.classList.toggle("is-compact", compact);
  elements.imageList.innerHTML = rendered.length
    ? rendered.map((image) => renderImageCard(image, { selected: selectedIds.has(Number(image.id)), selectionMode: bulkMode })).join("")
    : `<div class="admin-empty">${state.getImages().length ? "没有符合当前筛选的图片" : "图片库为空"}</div>`;
  elements.loadMore.hidden = !state.hasMore();
  elements.bulkToolbar.hidden = !bulkMode;
  elements.bulkCount.textContent = `已选择 ${selectedIds.size} 张`;
  elements.bulkToggle.textContent = bulkMode ? "完成" : "批量管理";
  elements.bulkToggle.setAttribute("aria-pressed", String(bulkMode));
  const actionsDisabled = !bulkMode || selectedIds.size === 0;
  elements.bulkTags.disabled = actionsDisabled;
  elements.bulkCategory.disabled = actionsDisabled;
  elements.bulkDelete.disabled = actionsDisabled;
  elements.bulkClear.disabled = !bulkMode;
}

function renderAll() {
  renderFilters();
  renderLibrary();
}

function renderLoading() {
  elements.imageList.innerHTML = `<div class="admin-skeleton">正在加载图片库...</div>`;
  elements.visibleCount.textContent = "...";
}

function renderLoadError(tags, error) {
  elements.visibleCount.textContent = "-";
  const box = createElement("div", { className: "admin-error" });
  box.append(createElement("span", {}, errorMessage(error)));
  const retry = createElement("button", { type: "button" }, "重新加载");
  retry.addEventListener("click", () => loadLibrary(tags));
  box.append(retry);
  elements.imageList.replaceChildren(box);
}

async function loadLibrary(taxonomy) {
  showApp();
  bulkMode = false;
  renderLoading();
  let payloads;
  try {
    payloads = await Promise.all([
      client.request("/api/admin/images"),
      client.request("/api/admin/categories"),
    ]);
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) throw error;
    renderLoadError(taxonomy, error);
    return;
  }
  const [{ images = [] }, { categories = [] }] = payloads;
  state = createLibraryState();
  state.setTags(taxonomy.tags);
  state.setTagGroups(taxonomy.tagGroups);
  state.setCategories(categories);
  state.setImages(images);
  renderAll();
}

async function authenticate(key) {
  keyStore.set(key);
  const taxonomy = await fetchAdminTaxonomy(client);
  await loadLibrary(taxonomy);
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
    if (!(error instanceof AdminUnauthorizedError)) showAuth(errorMessage(error));
  } finally {
    elements.loginButton.disabled = false;
  }
}

function closeDetail({ restoreFocus = true } = {}) {
  elements.detailOverlay.hidden = true;
  elements.detailOverlay.replaceChildren();
  detailImageId = null;
  if (restoreFocus) detailOpener?.focus();
  detailOpener = null;
}

function checkboxField(tag, checked) {
  const label = createElement("label", { className: "detail-check" });
  label.append(createElement("input", { type: "checkbox", value: tag.id, checked }), createElement("span", {}, tag.name));
  return label;
}

function imageDimensionsDetail(image) {
  const width = Number(image.width);
  const height = Number(image.height);
  const hasDimensions = Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0;
  const details = createElement("div", { className: "detail-dimensions" });
  details.append(
    createElement("strong", {}, hasDimensions ? `${width}×${height}` : "尺寸未知"),
    createElement("span", {}, "图片尺寸"),
  );
  return details;
}

function openDetail(image, opener) {
  detailImageId = Number(image.id);
  detailOpener = opener;
  const header = createElement("header");
  const heading = createElement("h2", { id: "detail-title" }, "图片详情");
  const close = createElement("button", { type: "button", "aria-label": "关闭详情", title: "关闭" }, "×");
  close.addEventListener("click", () => closeDetail());
  header.append(heading, close);

  const preview = image.fileUrl
    ? createElement("img", { className: "detail-preview", src: image.fileUrl, alt: image.fileName })
    : createElement("div", { className: "detail-preview image-preview-fallback" }, "预览不可用");
  const previewStage = createElement("div", { className: "detail-preview-stage" });
  previewStage.append(preview);
  const dimensions = imageDimensionsDetail(image);
  const form = createElement("form", { className: "detail-form" });
  const nameLabel = createElement("label", { className: "admin-field" });
  const fileName = createElement("input", { name: "fileName", value: image.fileName, required: "" });
  nameLabel.append(createElement("span", {}, "文件名"), fileName);
  const categoryLabel = createElement("label", { className: "admin-field" });
  const category = createElement("select", { name: "categoryId" });
  for (const item of state.getCategories()) {
    const option = createElement("option", { value: item.id }, `${item.name} /${item.directorySlug}`);
    option.selected = Number(item.id) === Number(image.category?.id);
    category.append(option);
  }
  categoryLabel.append(createElement("span", {}, "主分类"), category);
  const tags = createElement("fieldset", { className: "detail-tags" });
  tags.append(createElement("legend", {}, "标签"));
  appendGroupedTagChoices(tags, { selectedNames: new Set(image.tags ?? []) });
  const error = createElement("p", { className: "admin-field-error", "aria-live": "polite" });
  const remove = createElement("button", { type: "button", className: "admin-button-danger" }, "删除图片");
  const save = createElement("button", { type: "submit", className: "admin-button-primary" }, "保存修改");
  const actions = createElement("div", { className: "detail-form-actions" });
  actions.append(remove, save);
  form.append(nameLabel, categoryLabel, tags, error, actions);
  form.addEventListener("submit", (event) => saveDetail(event, { fileName, category, tags, error, save }));
  remove.addEventListener("click", () => deleteDetailImage(image, { remove, save, error }));
  const previewPane = createElement("div", { className: "detail-preview-pane" });
  previewPane.append(previewStage, dimensions);
  const editPane = createElement("div", { className: "detail-edit-pane" });
  editPane.append(form);
  const workspace = createElement("div", { className: "admin-detail-workspace" });
  workspace.append(previewPane, editPane);
  const dialog = createElement("section", {
    className: "admin-detail-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "detail-title",
  });
  dialog.append(header, workspace);
  elements.detailOverlay.replaceChildren(dialog);
  elements.detailOverlay.hidden = false;
  requestAnimationFrame(() => fileName.focus());
}

async function saveDetail(event, controls) {
  event.preventDefault();
  let current = state.getImages().find((image) => Number(image.id) === detailImageId);
  if (!current) return;
  const nextName = controls.fileName.value.trim();
  if (!nextName) {
    controls.error.textContent = "文件名不能为空。";
    return;
  }
  controls.save.disabled = true;
  controls.error.textContent = "";
  try {
    if (nextName !== current.fileName) {
      const payload = await client.request("/api/admin/images", {
        method: "PATCH",
        body: JSON.stringify({ imageId: current.id, fileName: nextName }),
      });
      current = payload.image;
      replaceImages([current]);
      renderLibrary();
    }
    if (Number(controls.category.value) !== Number(current.category?.id)) {
      const payload = await client.request("/api/admin/images/category-assignments/bulk", {
        method: "POST",
        body: JSON.stringify({ imageIds: [current.id], categoryId: Number(controls.category.value) }),
      });
      if (payload.failed?.length) throw new Error(payload.failed[0].error);
      current = payload.images[0];
      replaceImages([current]);
      renderAll();
    }
    const tagIds = [...controls.tags.querySelectorAll("input:checked")].map((input) => Number(input.value));
    const currentTagIds = state.getTags().filter((tag) => (current.tags ?? []).includes(tag.name)).map((tag) => Number(tag.id));
    if (tagIds.length !== currentTagIds.length || tagIds.some((id) => !currentTagIds.includes(id))) {
      await client.request("/api/admin/images/tag-assignments", {
        method: "POST",
        body: JSON.stringify({ imageId: current.id, tagIds }),
      });
      const selected = new Set(tagIds);
      current = { ...current, tags: state.getTags().filter((tag) => selected.has(Number(tag.id))).map((tag) => tag.name) };
      replaceImages([current]);
      renderAll();
    }
    closeDetail();
    notifier.success("图片信息已保存");
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) controls.error.textContent = errorMessage(error);
  } finally {
    controls.save.disabled = false;
  }
}

async function deleteDetailImage(image, controls) {
  const confirmed = await dialogs.confirm({
    title: "删除图片",
    message: `确定永久删除“${image.fileName}”吗？图片文件及其标签、图集和精选关系都会被移除，此操作无法撤销。`,
    confirmLabel: "删除",
    danger: true,
  });
  if (!confirmed) return;

  controls.remove.disabled = true;
  controls.save.disabled = true;
  controls.error.textContent = "";
  try {
    const payload = await client.request("/api/admin/images", {
      method: "DELETE",
      body: JSON.stringify({ imageId: image.id }),
    });
    const deletedImageId = Number(payload.deletedImageId ?? image.id);
    state.syncImages(state.getImages().filter((item) => Number(item.id) !== deletedImageId));
    closeDetail();
    renderAll();
    notifier.success(`已删除图片：${image.fileName}`);
  } catch (error) {
    const failedId = Number(error?.payload?.imageId);
    if (failedId) {
      replaceImages(state.getImages()
        .filter((item) => Number(item.id) === failedId)
        .map((item) => ({ ...item, syncStatus: "delete_failed", note: errorMessage(error) })));
      renderLibrary();
    }
    if (!(error instanceof AdminUnauthorizedError)) controls.error.textContent = errorMessage(error);
  } finally {
    controls.remove.disabled = false;
    controls.save.disabled = false;
  }
}

function openChoiceDialog({ title, options, selected = new Set(), single = false, grouped = false, confirmLabel = "保存" }) {
  const opener = document.activeElement;
  return new Promise((resolve) => {
    const backdrop = createElement("div", { className: "admin-dialog-backdrop" });
    const panel = createElement("section", { className: "admin-dialog", role: "dialog", "aria-modal": "true", "aria-label": title });
    const header = createElement("header");
    const close = createElement("button", { type: "button", "aria-label": "关闭", title: "关闭" }, "×");
    header.append(createElement("h2", {}, title), close);
    const body = createElement("div", { className: "admin-dialog-body choice-list" });
    const renderOptions = (target, entries) => {
      for (const option of entries) {
        const label = createElement("label", { className: "filter-option" });
        label.append(createElement("input", { type: single ? "radio" : "checkbox", name: "dialog-choice", value: option.id, checked: selected.has(Number(option.id)) }), createElement("span", {}, option.name));
        target.append(label);
      }
    };
    if (grouped) {
      for (const group of groupedTags(options)) {
        const section = createElement("section", { className: "tag-choice-group" });
        section.append(createElement("h4", {}, group.name));
        const choices = createElement("div", { className: "tag-choice-options" }); renderOptions(choices, group.tags); section.append(choices); body.append(section);
      }
    } else {
      renderOptions(body, options);
    }
    const footer = createElement("footer");
    const cancel = createElement("button", { type: "button" }, "取消");
    const confirm = createElement("button", { type: "button", className: "admin-button-primary" }, confirmLabel);
    footer.append(cancel, confirm);
    panel.append(header, body, footer);
    backdrop.append(panel);
    elements.dialogHost.replaceChildren(backdrop);
    const finish = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      elements.dialogHost.replaceChildren();
      opener?.focus();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(null);
      else trapFocus(event, panel);
    };
    document.addEventListener("keydown", onKeyDown);
    close.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) finish(null); });
    confirm.addEventListener("click", () => {
      const values = [...body.querySelectorAll("input:checked")].map((input) => Number(input.value));
      if (single && !values.length) return;
      finish(single ? values[0] : values);
    });
    requestAnimationFrame(() => body.querySelector("input")?.focus());
  });
}

async function bulkAssignTags() {
  const imageIds = [...state.getSelectedIds()];
  const tagIds = await openChoiceDialog({ title: "批量设置标签", options: state.getTags(), grouped: true, confirmLabel: "应用标签" });
  if (tagIds === null) return;
  try {
    await client.request("/api/admin/images/tag-assignments/bulk", {
      method: "POST",
      body: JSON.stringify({ imageIds, tagIds }),
    });
    const selected = new Set(tagIds);
    const names = state.getTags().filter((tag) => selected.has(Number(tag.id))).map((tag) => tag.name);
    replaceImages(state.getImages().filter((image) => imageIds.includes(Number(image.id))).map((image) => ({ ...image, tags: names })));
    state.clearSelection();
    renderAll();
    notifier.success(`已更新 ${imageIds.length} 张图片的标签`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(errorMessage(error));
  }
}

async function bulkAssignCategory() {
  const imageIds = [...state.getSelectedIds()];
  const categoryId = await openChoiceDialog({ title: "批量移动主分类", options: state.getCategories(), single: true, confirmLabel: "移动" });
  if (categoryId === null) return;
  try {
    const payload = await client.request("/api/admin/images/category-assignments/bulk", {
      method: "POST",
      body: JSON.stringify({ imageIds, categoryId }),
    });
    const failures = new Set((payload.failed ?? []).map((item) => Number(item.imageId)));
    const failedUpdates = state.getImages().filter((image) => failures.has(Number(image.id))).map((image) => ({ ...image, syncStatus: "move_failed", note: "批量移动分类时底层文件移动失败。" }));
    replaceImages([...(payload.images ?? []), ...failedUpdates]);
    state.selectImages(failures);
    renderAll();
    if (failures.size) notifier.error(`${payload.images.length} 张移动成功，${failures.size} 张失败并保持选中。`);
    else notifier.success(`已移动 ${payload.images.length} 张图片`);
  } catch (error) {
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(errorMessage(error));
  }
}

async function bulkDelete() {
  const imageIds = [...state.getSelectedIds()];
  const confirmed = await dialogs.confirm({ title: "批量删除图片", message: `确定永久删除选中的 ${imageIds.length} 张图片吗？`, confirmLabel: "删除", danger: true });
  if (!confirmed) return;
  try {
    await client.request("/api/admin/images/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ imageIds }),
    });
    state.syncImages(state.getImages().filter((image) => !imageIds.includes(Number(image.id))));
    renderAll();
    notifier.success(`已删除 ${imageIds.length} 张图片`);
  } catch (error) {
    const failedId = Number(error?.payload?.imageId);
    if (failedId) replaceImages(state.getImages().filter((image) => Number(image.id) === failedId).map((image) => ({ ...image, syncStatus: "delete_failed", note: errorMessage(error) })));
    if (!(error instanceof AdminUnauthorizedError)) notifier.error(errorMessage(error));
    renderLibrary();
  }
}

async function uploadToSignedUrl(file, upload) {
  const response = await fetch(upload.uploadUrl, {
    method: upload.method ?? "PUT",
    headers: upload.headers ?? {},
    body: file,
  });
  if (!response.ok) {
    throw new Error(await describeUploadFailure(response, file.name));
  }
}

function mergeUploadResults(runner) {
  const results = runner.tasks().filter((task) => task.status === "success" && task.result).map((task) => task.result);
  if (!results.length) return;
  const resultIds = new Set(results.map((image) => Number(image.id)));
  state.syncImages([...results, ...state.getImages().filter((image) => !resultIds.has(Number(image.id)))]);
  renderAll();
}

function uploadStatusText(task) {
  return {
    queued: "等待上传",
    signing: "申请地址",
    uploading: "正在上传",
    completing: "正在写入",
    success: "已完成",
    error: task.error || "上传失败",
  }[task.status];
}

function renderUploadTasks(runner, controls) {
  const tasks = runner.tasks();
  controls.tasks.replaceChildren();
  for (const task of tasks) {
    const row = createElement("div", { className: `upload-task is-${task.status}` });
    const copy = createElement("div", { className: "upload-task-copy" });
    copy.append(createElement("strong", {}, task.file.name), createElement("small", {}, uploadStatusText(task)));
    row.append(copy, createElement("span", { className: "upload-task-state" }, task.status === "success" ? "完成" : task.status === "error" ? "失败" : "处理中"));
    controls.tasks.append(row);
  }
  const counts = runner.counts();
  controls.summary.textContent = counts.total ? `${counts.success} / ${counts.total} 已完成` : "尚未选择图片";
  controls.retry.hidden = counts.error === 0;
  controls.start.disabled = counts.total === 0 || counts.active > 0 || counts.queued === 0;
  controls.files.disabled = counts.active > 0;
  controls.category.disabled = counts.active > 0;
  controls.tagInputs.forEach((input) => { input.disabled = counts.active > 0; });
}

function closeUpload({ restoreFocus = true } = {}) {
  if (uploadSession?.runner.isRunning()) return;
  elements.uploadDialog.hidden = true;
  elements.uploadDialog.replaceChildren();
  if (restoreFocus) uploadSession?.opener?.focus();
  uploadSession = null;
}

async function runUpload(runner, controls, retry = false) {
  const categoryId = Number(controls.category.value);
  const tagIds = controls.tagInputs.filter((input) => input.checked).map((input) => Number(input.value));
  if (!categoryId) {
    controls.error.textContent = "请选择一个主分类。";
    return;
  }
  if (!tagIds.length) {
    controls.error.textContent = "请至少选择一个标签。";
    return;
  }
  controls.error.textContent = "";
  runner.setMetadata({ categoryId, tagIds });
  if (retry) await runner.retryFailed(); else await runner.run();
  mergeUploadResults(runner);
  const counts = runner.counts();
  if (counts.error === 0 && counts.total > 0) {
    closeUpload();
    notifier.success(`已上传 ${counts.success} 张图片`);
  }
}

function openUploadDialog() {
  if (uploadSession) return;
  const opener = document.activeElement;
  const panel = createElement("section", { className: "upload-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "upload-title" });
  const header = createElement("header");
  const close = createElement("button", { type: "button", "aria-label": "关闭上传", title: "关闭" }, "×");
  header.append(createElement("h2", { id: "upload-title" }, "上传图片"), close);
  const body = createElement("div", { className: "upload-panel-body" });
  const formGrid = createElement("div", { className: "upload-fields" });
  const filesLabel = createElement("label", { className: "admin-field" });
  const files = createElement("input", { type: "file", accept: "image/*", multiple: "" });
  filesLabel.append(createElement("span", {}, "图片文件"), files);
  const categoryLabel = createElement("label", { className: "admin-field" });
  const category = createElement("select");
  category.append(createElement("option", { value: "" }, "选择主分类"));
  for (const item of state.getCategories()) {
    const option = createElement("option", { value: item.id }, `${item.name} /${item.directorySlug}`);
    category.append(option);
  }
  categoryLabel.append(createElement("span", {}, "主分类"), category);
  const tagsField = createElement("fieldset", { className: "upload-tags" });
  tagsField.append(createElement("legend", {}, "标签（至少一个）"));
  const activeTags = state.getFilters().tagNames;
  const tagInputs = appendGroupedTagChoices(tagsField, { selectedNames: activeTags, labelClass: "detail-check" });
  formGrid.append(filesLabel, categoryLabel, tagsField);
  const error = createElement("p", { className: "admin-field-error", "aria-live": "polite" });
  const summary = createElement("p", { className: "upload-summary", "aria-live": "polite" }, "尚未选择图片");
  const tasks = createElement("div", { className: "upload-task-list" });
  body.append(formGrid, error, summary, tasks);
  const footer = createElement("footer");
  const cancel = createElement("button", { type: "button" }, "取消");
  const retry = createElement("button", { type: "button", hidden: "" }, "重试失败项");
  const start = createElement("button", { type: "button", className: "admin-button-primary", disabled: "" }, "开始上传");
  footer.append(cancel, retry, start);
  panel.append(header, body, footer);
  elements.uploadDialog.replaceChildren(panel);
  elements.uploadDialog.hidden = false;

  const controls = { files, category, tagInputs, error, summary, tasks, retry, start };
  const runner = createUploadRunner({
    batchSize: 12,
    requestUploadUrls: async (batch, metadata) => {
      const payload = await client.request("/api/admin/images/upload/init", {
        method: "POST",
        body: JSON.stringify({ files: batch.map((task) => task.draft), ...metadata }),
      });
      return (payload.uploads ?? []).map((upload, index) => ({ ...upload, taskId: batch[index]?.id }));
    },
    uploadFile: uploadToSignedUrl,
    completeUploads: async (batch, metadata) => {
      const payload = await client.request("/api/admin/images/upload/complete", {
        method: "POST",
        body: JSON.stringify({
          files: batch.map((task) => ({
            storageKey: task.upload.storageKey,
            fileName: task.upload.fileName,
            width: task.draft.width,
            height: task.draft.height,
          })),
          ...metadata,
        }),
      });
      return payload.images ?? [];
    },
    onChange: () => renderUploadTasks(runner, controls),
  });
  uploadSession = { runner, opener, panel };
  renderUploadTasks(runner, controls);

  files.addEventListener("change", async () => {
    start.disabled = true;
    error.textContent = "正在读取图片尺寸...";
    const selected = [...files.files];
    const dimensions = await Promise.all(selected.map((file) => measureImageFile(file)));
    if (!uploadSession || uploadSession.runner !== runner) return;
    runner.setFiles(selected, dimensions);
    error.textContent = "";
  });
  close.addEventListener("click", () => closeUpload());
  cancel.addEventListener("click", () => closeUpload());
  elements.uploadDialog.onclick = (event) => { if (event.target === elements.uploadDialog) closeUpload(); };
  start.addEventListener("click", () => runUpload(runner, controls));
  retry.addEventListener("click", () => runUpload(runner, controls, true));
  requestAnimationFrame(() => files.focus());
}

elements.loginForm.addEventListener("submit", submitLogin);
elements.passwordToggle.addEventListener("click", () => {
  const visible = elements.keyInput.type === "text";
  elements.keyInput.type = visible ? "password" : "text";
  elements.passwordToggle.textContent = visible ? "显示" : "隐藏";
  elements.passwordToggle.setAttribute("aria-label", visible ? "显示管理密钥" : "隐藏管理密钥");
});
elements.logout.addEventListener("click", () => { keyStore.clear(); showAuth(); });
elements.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.setQuery(elements.search.value); renderLibrary(); }, 150);
});
elements.sort.addEventListener("change", () => { state.setSort(elements.sort.value); renderLibrary(); });
elements.density.addEventListener("click", () => {
  compact = !compact;
  elements.density.textContent = compact ? "舒适视图" : "紧凑视图";
  elements.density.setAttribute("aria-pressed", String(compact));
  renderLibrary();
});
elements.bulkToggle.addEventListener("click", () => setBulkMode(!bulkMode));
elements.filterToggle.addEventListener("click", () => {
  const open = elements.filterRail.classList.toggle("is-open");
  elements.filterToggle.setAttribute("aria-expanded", String(open));
});
elements.clearFilters.addEventListener("click", () => {
  state.resetFilters();
  elements.search.value = "";
  elements.tagFilterSearch.value = "";
  renderAll();
});
elements.tagFilterSearch.addEventListener("input", renderFilters);
elements.loadMore.addEventListener("click", () => { state.showMore(); renderLibrary(); });
elements.imageList.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const card = event.target.closest("[data-image-id]");
  if (!action || !card) return;
  const image = state.getImages().find((item) => String(item.id) === card.dataset.imageId);
  if (!image) return;
  if (action === "toggle-selection") { state.toggleSelection(image.id); renderLibrary(); }
  if (action === "open-detail") openDetail(image, event.target);
});
elements.imageList.addEventListener("error", (event) => {
  if (!event.target.matches("[data-preview-image]")) return;
  event.target.hidden = true;
  event.target.nextElementSibling.hidden = false;
}, true);
elements.bulkClear.addEventListener("click", () => setBulkMode(false));
elements.bulkTags.addEventListener("click", bulkAssignTags);
elements.bulkCategory.addEventListener("click", bulkAssignCategory);
elements.bulkDelete.addEventListener("click", bulkDelete);
elements.uploadOpen.addEventListener("click", openUploadDialog);
elements.detailOverlay.addEventListener("click", (event) => {
  if (event.target === elements.detailOverlay) closeDetail();
});
document.addEventListener("keydown", (event) => {
  if (elements.dialogHost.childElementCount) return;
  if (event.key === "Tab") {
    if (uploadSession) trapFocus(event, uploadSession.panel);
    else if (detailImageId !== null) trapFocus(event, elements.detailOverlay);
    return;
  }
  if (event.key === "Escape") {
    if (uploadSession) closeUpload();
    else if (detailImageId !== null) closeDetail();
  }
});

if (keyStore.get()) {
  authenticate(keyStore.get()).catch((error) => {
    if (!(error instanceof AdminUnauthorizedError)) showAuth(errorMessage(error));
  });
} else {
  showAuth();
}
