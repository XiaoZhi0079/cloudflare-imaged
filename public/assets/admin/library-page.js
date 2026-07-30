import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore, fetchAdminTaxonomy } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createLibraryState } from "./library-state.js?v=20260715-featured-filter-separation";
import { createNotifier } from "./notifications.js";
import { buildImagePreviewUrl, renderImageCard } from "./renderers/image-card.js?v=20260728-image-delivery";
import { buildDirectImageUrl, buildDownloadImageUrl } from "./image-links.js?v=20260727-technical-info";
import { createUploadRunner, describeUploadFailure, inspectImageFile } from "./upload.js?v=20260730-content-deduplication";
import { buildImageVariantUrl } from "../image-variants.js?v=20260728-image-delivery";

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
  uploadStatus: document.querySelector("#admin-upload-status"),
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
let detailControls = null;
let detailDrafts = new Map();
let detailSaving = false;
let detailSequenceIds = [];
let detailPreloadImages = new Map();
let uploadSession = null;
let uploadRenderFrame = null;

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

function setUploadAvailability(ready, message = "") {
  elements.uploadOpen.disabled = !ready;
  elements.uploadOpen.title = ready ? "" : message;
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
  state = createLibraryState();
  state.setTags(taxonomy.tags);
  state.setTagGroups(taxonomy.tagGroups);
  setUploadAvailability(false, "正在加载目录和标签");
  renderLoading();
  try {
    const { categories = [] } = await client.request("/api/admin/categories");
    state.setCategories(categories);
    const uploadReady = state.getCategories().length > 0 && state.getTags().length > 0;
    setUploadAvailability(uploadReady, uploadReady ? "" : "请先创建至少一个目录和标签");
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) throw error;
    renderLoadError(taxonomy, error);
    return;
  }
  try {
    const { images = [] } = await client.request("/api/admin/images");
    state.setImages(images);
    renderAll();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) throw error;
    renderLoadError(taxonomy, error);
  }
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
  detailControls = null;
  detailDrafts = new Map();
  detailSaving = false;
  detailSequenceIds = [];
  detailPreloadImages.clear();
  if (restoreFocus) detailOpener?.focus();
  detailOpener = null;
}

function detailDraftCount() {
  return detailDrafts.size;
}

function detailDraftsHaveChanges() {
  return detailDraftCount() > 0;
}

function sortedTagIds(tagIds) {
  return [...new Set(tagIds.map(Number).filter(Number.isSafeInteger))].sort((left, right) => left - right);
}

function detailDraftFor(image) {
  const draft = detailDrafts.get(Number(image.id));
  if (draft) return draft;
  return {
    fileName: String(image.fileName ?? ""),
    categoryId: Number(image.category?.id ?? 0),
    tagIds: sortedTagIds(state.getTags()
      .filter((tag) => (image.tags ?? []).includes(tag.name))
      .map((tag) => Number(tag.id))),
  };
}

function detailDraftMatchesImage(image, draft) {
  const currentTagIds = sortedTagIds(state.getTags()
    .filter((tag) => (image.tags ?? []).includes(tag.name))
    .map((tag) => Number(tag.id)));
  return String(draft.fileName ?? "").trim() === String(image.fileName ?? "").trim()
    && Number(draft.categoryId) === Number(image.category?.id ?? 0)
    && JSON.stringify(sortedTagIds(draft.tagIds ?? [])) === JSON.stringify(currentTagIds);
}

function renderDetailSaveState() {
  if (!detailControls) return;
  const count = detailDraftCount();
  detailControls.save.textContent = detailSaving
    ? `正在保存 ${count} 张...`
    : count > 1 ? `保存全部（${count}）` : "保存修改";
  detailControls.save.disabled = detailSaving;
  detailControls.remove.disabled = detailSaving;
  detailControls.fileName.disabled = detailSaving;
  detailControls.category.disabled = detailSaving;
  detailControls.tags.disabled = detailSaving;
  detailControls.previous.disabled = detailSaving || !detailControls.canPrevious;
  detailControls.next.disabled = detailSaving || !detailControls.canNext;
}

function captureDetailDraft(imageId = detailImageId, controls = detailControls) {
  if (!controls || imageId === null) return;
  const image = state.getImages().find((item) => Number(item.id) === Number(imageId));
  if (!image) return;
  const draft = {
    fileName: controls.fileName.value,
    categoryId: Number(controls.category.value),
    tagIds: sortedTagIds([...controls.tags.querySelectorAll("input:checked")].map((input) => Number(input.value))),
  };
  if (detailDraftMatchesImage(image, draft)) detailDrafts.delete(Number(imageId));
  else detailDrafts.set(Number(imageId), draft);
  renderDetailSaveState();
}

function captureActiveDetailDraft() {
  captureDetailDraft(detailImageId, detailControls);
}

async function confirmDiscardDetailChanges() {
  if (detailSaving) return false;
  captureActiveDetailDraft();
  if (!detailDraftsHaveChanges()) return true;
  return await confirmDetailAction({
    title: "放弃未保存修改",
    message: `当前有 ${detailDraftCount()} 张图片的信息尚未保存，关闭后将丢弃这些修改。`,
    confirmLabel: "放弃修改",
  });
}

async function confirmDetailAction(options) {
  elements.detailOverlay.setAttribute("aria-hidden", "true");
  try {
    return await dialogs.confirm(options);
  } finally {
    if (detailImageId !== null) elements.detailOverlay.removeAttribute("aria-hidden");
  }
}

async function requestCloseDetail() {
  if (!await confirmDiscardDetailChanges()) return;
  closeDetail();
}

function detailNavigationState(imageId) {
  const currentIds = new Set(state.getImages().map((image) => Number(image.id)));
  detailSequenceIds = detailSequenceIds.filter((id) => currentIds.has(Number(id)));
  const index = detailSequenceIds.findIndex((id) => Number(id) === Number(imageId));
  return {
    index,
    total: detailSequenceIds.length,
    previousId: index > 0 ? detailSequenceIds[index - 1] : null,
    nextId: index >= 0 && index < detailSequenceIds.length - 1 ? detailSequenceIds[index + 1] : null,
  };
}

function detailPreviewUrl(image) {
  return buildImageVariantUrl(image.fileUrl, 1280) ?? buildImagePreviewUrl(image.fileUrl, image.id);
}

function cardPreviewUrl(opener, image) {
  const card = opener?.closest?.("[data-image-id]");
  const preview = card?.querySelector?.("[data-preview-image]");
  if (String(card?.dataset?.imageId ?? "") === String(image.id) && preview) {
    return preview.currentSrc || preview.src || "";
  }
  return buildImagePreviewUrl(image.fileUrl, image.id);
}

function retryFailedCardPreview(image) {
  const card = elements.imageList.querySelector(`[data-image-id="${Number(image.id)}"]`);
  const preview = card?.querySelector?.("[data-preview-image]");
  const fallback = card?.querySelector?.("[data-preview-fallback]");
  if (!preview || (!preview.hidden && fallback?.hidden !== false)) return;
  preview.dataset.previewRetry = "";
  preview.hidden = false;
  if (fallback) fallback.hidden = true;
  preview.src = buildImagePreviewUrl(image.fileUrl, `${image.id}-${Date.now().toString(36)}`);
}

function preloadDetailNeighbors(imageId) {
  const navigation = detailNavigationState(imageId);
  for (const neighborId of [navigation.previousId, navigation.nextId]) {
    if (!neighborId) continue;
    const neighbor = state.getImages().find((image) => Number(image.id) === Number(neighborId));
    const url = neighbor ? detailPreviewUrl(neighbor) : "";
    if (!url || detailPreloadImages.has(url)) continue;
    const preload = new Image();
    preload.decoding = "async";
    preload.fetchPriority = "low";
    preload.src = url;
    detailPreloadImages.set(url, preload);
    while (detailPreloadImages.size > 8) {
      detailPreloadImages.delete(detailPreloadImages.keys().next().value);
    }
  }
}

function navigateDetail(direction) {
  if (detailSaving) return;
  captureActiveDetailDraft();
  const navigation = detailNavigationState(detailImageId);
  const targetId = direction < 0 ? navigation.previousId : navigation.nextId;
  if (!targetId) return;
  const target = state.getImages().find((image) => Number(image.id) === Number(targetId));
  if (target) openDetail(target, detailOpener, { focusField: false });
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

async function copyTechnicalValue(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    notifier.success(`已复制${label}`);
  } catch {
    notifier.error(`无法复制${label}`);
  }
}

function technicalInfoRow(label, value, actions = []) {
  const row = createElement("div", { className: "detail-technical-row" });
  row.append(
    createElement("span", { className: "detail-technical-label" }, label),
    createElement("code", { className: "detail-technical-value", title: value }, value || "暂无"),
  );
  const actionGroup = createElement("div", { className: "detail-technical-actions" });
  for (const action of actions) actionGroup.append(action);
  row.append(actionGroup);
  return row;
}

function technicalCopyButton(label, value) {
  const button = createElement("button", {
    type: "button",
    className: "detail-technical-button",
    "aria-label": `复制${label}`,
    title: `复制${label}`,
  }, "复制");
  button.disabled = !value;
  button.addEventListener("click", () => { void copyTechnicalValue(value, label); });
  return button;
}

function technicalLink(label, href, text) {
  const attributes = {
    className: "detail-technical-button",
    href: href || "#",
    "aria-label": label === "浏览地址" ? "在新窗口浏览原图" : "下载原图",
    title: label === "浏览地址" ? "在新窗口浏览原图" : "下载原图",
    ...(href ? {} : { "aria-disabled": "true" }),
  };
  if (label === "浏览地址") {
    attributes.target = "_blank";
    attributes.rel = "noopener noreferrer";
  }
  return createElement("a", attributes, text);
}

function imageTechnicalInfo(image) {
  const directUrl = buildDirectImageUrl(image.fileUrl);
  const downloadUrl = buildDownloadImageUrl(image.fileUrl);
  const section = createElement("section", {
    className: "detail-technical",
    "aria-labelledby": "detail-technical-title",
  });
  section.append(createElement("h3", { id: "detail-technical-title" }, "技术信息"));
  const rows = createElement("div", { className: "detail-technical-list" });
  const values = [
    ["数字 ID", String(image.id ?? "")],
    ["永久 ID", String(image.publicId ?? "")],
    ["SHA-256", String(image.contentSha256 ?? "")],
    ["R2 路径", String(image.storageKey ?? "")],
  ];
  for (const [label, value] of values) {
    rows.append(technicalInfoRow(label, value, [technicalCopyButton(label, value)]));
  }
  rows.append(
    technicalInfoRow("浏览地址", directUrl, [
      technicalCopyButton("浏览地址", directUrl),
      technicalLink("浏览地址", directUrl, "打开"),
    ]),
    technicalInfoRow("下载地址", downloadUrl, [
      technicalCopyButton("下载地址", downloadUrl),
      technicalLink("下载地址", downloadUrl, "下载"),
    ]),
  );
  section.append(rows);
  return section;
}

function openDetail(image, opener, { sequenceIds = null, focusField = true } = {}) {
  detailImageId = Number(image.id);
  if (opener) detailOpener = opener;
  if (sequenceIds) detailSequenceIds = [...new Set(sequenceIds.map(Number))];
  if (!detailSequenceIds.length) detailSequenceIds = state.visibleImages().map((item) => Number(item.id));
  const draft = detailDraftFor(image);
  const navigation = detailNavigationState(image.id);
  const header = createElement("header");
  const heading = createElement("h2", { id: "detail-title" }, "图片详情");
  const headerActions = createElement("div", { className: "detail-header-actions" });
  const position = createElement("span", { className: "detail-position" }, navigation.index >= 0 ? `${navigation.index + 1} / ${navigation.total}` : "");
  const close = createElement("button", { type: "button", "aria-label": "关闭详情", title: "关闭" }, "×");
  close.addEventListener("click", () => { void requestCloseDetail(); });
  headerActions.append(position, close);
  header.append(heading, headerActions);

  const preview = image.fileUrl
    ? createElement("img", { className: "detail-preview", src: detailPreviewUrl(image), alt: image.fileName, decoding: "async", fetchpriority: "high" })
    : createElement("div", { className: "detail-preview image-preview-fallback" }, "预览不可用");
  const previewStage = createElement("div", { className: "detail-preview-stage" });
  const previewPlaceholder = image.fileUrl ? cardPreviewUrl(opener, image) : "";
  if (previewPlaceholder) {
    previewStage.classList.add("has-preview", "is-loading");
    previewStage.style.backgroundImage = `url(${JSON.stringify(previewPlaceholder)})`;
    previewStage.setAttribute("aria-busy", "true");
  }
  const previous = createElement("button", { type: "button", className: "detail-preview-nav detail-preview-prev", "aria-label": "上一张", title: "上一张" }, "‹");
  const next = createElement("button", { type: "button", className: "detail-preview-nav detail-preview-next", "aria-label": "下一张", title: "下一张" }, "›");
  previous.disabled = navigation.previousId === null;
  next.disabled = navigation.nextId === null;
  previous.addEventListener("click", () => { void navigateDetail(-1); });
  next.addEventListener("click", () => { void navigateDetail(1); });
  previewStage.append(previous, preview, next);
  if (preview instanceof HTMLImageElement) {
    preview.addEventListener("load", () => {
      previewStage.classList.remove("has-preview", "is-loading", "is-error");
      previewStage.style.removeProperty("background-image");
      previewStage.setAttribute("aria-busy", "false");
      retryFailedCardPreview(image);
    }, { once: true });
    preview.addEventListener("error", () => {
      previewStage.classList.remove("is-loading");
      previewStage.classList.add("is-error");
      previewStage.setAttribute("aria-busy", "false");
    }, { once: true });
  }
  const dimensions = imageDimensionsDetail(image);
  const form = createElement("form", { className: "detail-form" });
  const nameLabel = createElement("label", { className: "admin-field" });
  const fileName = createElement("input", { name: "fileName", value: draft.fileName, required: "" });
  nameLabel.append(createElement("span", {}, "文件名"), fileName);
  const categoryLabel = createElement("label", { className: "admin-field" });
  const category = createElement("select", { name: "categoryId" });
  for (const item of state.getCategories()) {
    const option = createElement("option", { value: item.id }, `${item.name} /${item.directorySlug}`);
    option.selected = Number(item.id) === Number(draft.categoryId);
    category.append(option);
  }
  categoryLabel.append(createElement("span", {}, "目录"), category);
  const tags = createElement("fieldset", { className: "detail-tags" });
  tags.append(createElement("legend", {}, "标签"));
  const selectedTagIds = new Set(draft.tagIds.map(Number));
  appendGroupedTagChoices(tags, {
    selectedNames: new Set(state.getTags().filter((tag) => selectedTagIds.has(Number(tag.id))).map((tag) => tag.name)),
  });
  const technicalInfo = imageTechnicalInfo(image);
  const error = createElement("p", { className: "admin-field-error", "aria-live": "polite" });
  const remove = createElement("button", { type: "button", className: "admin-button-danger" }, "删除图片");
  const save = createElement("button", { type: "submit", className: "admin-button-primary" }, "保存修改");
  const actions = createElement("div", { className: "detail-form-actions" });
  actions.append(remove, save);
  form.append(nameLabel, categoryLabel, tags, error, actions);
  const controls = {
    imageId: Number(image.id),
    fileName,
    category,
    tags,
    error,
    remove,
    save,
    previous,
    next,
    canPrevious: navigation.previousId !== null,
    canNext: navigation.nextId !== null,
  };
  detailControls = controls;
  form.addEventListener("input", () => captureDetailDraft(image.id, controls));
  form.addEventListener("change", () => captureDetailDraft(image.id, controls));
  form.addEventListener("submit", saveDetail);
  remove.addEventListener("click", () => deleteDetailImage(image, { remove, save, error }));
  const previewPane = createElement("div", { className: "detail-preview-pane" });
  previewPane.append(previewStage, dimensions, technicalInfo);
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
  renderDetailSaveState();
  preloadDetailNeighbors(image.id);
  requestAnimationFrame(() => {
    if (focusField) fileName.focus();
    else if (!next.disabled) next.focus();
    else if (!previous.disabled) previous.focus();
    else fileName.focus();
  });
}

async function persistDetailDraft(image, draft) {
  let current = image;
  const nextName = String(draft.fileName ?? "").trim();
  if (!nextName) throw new Error(`“${image.fileName}”的文件名不能为空。`);

  if (nextName !== current.fileName) {
    const payload = await client.request("/api/admin/images", {
      method: "PATCH",
      body: JSON.stringify({ imageId: current.id, fileName: nextName }),
    });
    current = payload.image;
    replaceImages([current]);
  }

  if (Number(draft.categoryId) !== Number(current.category?.id)) {
    const payload = await client.request("/api/admin/images/category-assignments/bulk", {
      method: "POST",
      body: JSON.stringify({ imageIds: [current.id], categoryId: Number(draft.categoryId) }),
    });
    if (payload.failed?.length) throw new Error(payload.failed[0].error);
    current = payload.images[0];
    replaceImages([current]);
  }

  const tagIds = sortedTagIds(draft.tagIds ?? []);
  const currentTagIds = sortedTagIds(state.getTags()
    .filter((tag) => (current.tags ?? []).includes(tag.name))
    .map((tag) => Number(tag.id)));
  if (JSON.stringify(tagIds) !== JSON.stringify(currentTagIds)) {
    await client.request("/api/admin/images/tag-assignments", {
      method: "POST",
      body: JSON.stringify({ imageId: current.id, tagIds }),
    });
    const selected = new Set(tagIds);
    current = {
      ...current,
      tags: state.getTags().filter((tag) => selected.has(Number(tag.id))).map((tag) => tag.name),
    };
    replaceImages([current]);
  }

  return current;
}

async function saveDetail(event) {
  event.preventDefault();
  if (detailSaving) return;
  captureActiveDetailDraft();
  const entries = [...detailDrafts.entries()];
  if (!entries.length) {
    detailControls.error.textContent = "没有需要保存的修改。";
    return;
  }

  const invalid = entries.find(([, draft]) => !String(draft.fileName ?? "").trim());
  if (invalid) {
    const image = state.getImages().find((item) => Number(item.id) === Number(invalid[0]));
    if (image && Number(image.id) !== Number(detailImageId)) openDetail(image, detailOpener);
    detailControls.error.textContent = "文件名不能为空。";
    detailControls.fileName.focus();
    return;
  }

  detailSaving = true;
  detailControls.error.textContent = "";
  detailControls.remove.disabled = true;
  renderDetailSaveState();
  try {
    const results = await Promise.all(entries.map(async ([imageId, draft]) => {
      const image = state.getImages().find((item) => Number(item.id) === Number(imageId));
      if (!image) return { imageId, image: null, error: new Error("图片已不存在。") };
      try {
        return { imageId, draft, image: await persistDetailDraft(image, draft), error: null };
      } catch (error) {
        return { imageId, draft, image, error };
      }
    }));

    const unauthorized = results.find((result) => result.error instanceof AdminUnauthorizedError);
    if (unauthorized) return;

    const failures = [];
    let savedCount = 0;
    for (const result of results) {
      if (result.error) {
        failures.push(result);
        continue;
      }
      if (detailDrafts.get(Number(result.imageId)) === result.draft) {
        detailDrafts.delete(Number(result.imageId));
      }
      savedCount += 1;
    }

    renderAll();
    const active = state.getImages().find((image) => Number(image.id) === Number(detailImageId));
    const firstFailedImage = failures.length
      ? state.getImages().find((image) => Number(image.id) === Number(failures[0].imageId))
      : null;
    const displayImage = firstFailedImage ?? active;
    if (displayImage) openDetail(displayImage, detailOpener, { focusField: false });
    if (failures.length) {
      detailControls.error.textContent = failures.length === 1
        ? `“${firstFailedImage?.fileName ?? "图片"}”：${errorMessage(failures[0].error)}`
        : `${failures.length} 张图片保存失败，请重试。`;
      notifier.error(savedCount ? `已保存 ${savedCount} 张，${failures.length} 张失败` : "图片信息保存失败");
    } else {
      notifier.success(`已保存 ${savedCount} 张图片`);
    }
  } finally {
    detailSaving = false;
    if (detailControls) {
      detailControls.remove.disabled = false;
      renderDetailSaveState();
    }
  }
}

async function deleteDetailImage(image, controls) {
  const navigation = detailNavigationState(image.id);
  const fallbackId = navigation.nextId ?? navigation.previousId;
  const confirmed = await confirmDetailAction({
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
    detailDrafts.delete(deletedImageId);
    detailSequenceIds = detailSequenceIds.filter((id) => Number(id) !== deletedImageId);
    state.syncImages(state.getImages().filter((item) => Number(item.id) !== deletedImageId));
    renderAll();
    const fallback = state.getImages().find((item) => Number(item.id) === Number(fallbackId));
    if (fallback) openDetail(fallback, detailOpener, { focusField: false });
    else closeDetail();
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
  const categoryId = await openChoiceDialog({ title: "批量移动目录", options: state.getCategories(), single: true, confirmLabel: "移动" });
  if (categoryId === null) return;
  try {
    const payload = await client.request("/api/admin/images/category-assignments/bulk", {
      method: "POST",
      body: JSON.stringify({ imageIds, categoryId }),
    });
    const failures = new Set((payload.failed ?? []).map((item) => Number(item.imageId)));
    const failedUpdates = state.getImages().filter((image) => failures.has(Number(image.id))).map((image) => ({ ...image, syncStatus: "move_failed", note: "批量移动目录时底层文件移动失败。" }));
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
    preparing: "读取图片尺寸",
    signing: "申请地址",
    uploading: "正在上传",
    completing: "正在写入",
    success: "已完成",
    error: task.error || "上传失败",
  }[task.status];
}

function uploadFailureCounts(tasks) {
  return tasks.reduce((counts, task) => {
    if (task.status !== "error") return counts;
    if (task.errorCode === "DUPLICATE_IMAGE_CONTENT") counts.duplicate += 1;
    else if (task.retryable !== false) counts.retryable += 1;
    return counts;
  }, { duplicate: 0, retryable: 0 });
}

function visibleUploadTasks(tasks, limit = 80) {
  if (tasks.length <= limit) return tasks;
  const important = tasks.filter((task) => task.status === "error" || ["preparing", "signing", "uploading", "completing"].includes(task.status));
  const selected = new Set(important.slice(0, limit).map((task) => task.id));
  for (let index = tasks.length - 1; index >= 0 && selected.size < limit; index -= 1) selected.add(tasks[index].id);
  return tasks.filter((task) => selected.has(task.id));
}

function renderUploadTaskRows(tasks, container) {
  const visible = visibleUploadTasks(tasks);
  container.replaceChildren();
  for (const task of visible) {
    const row = createElement("div", { className: `upload-task is-${task.status}` });
    const copy = createElement("div", { className: "upload-task-copy" });
    copy.append(createElement("strong", {}, task.file.name), createElement("small", {}, uploadStatusText(task)));
    const stateText = task.status === "success"
      ? "完成"
      : task.errorCode === "DUPLICATE_IMAGE_CONTENT"
        ? "已跳过"
        : task.status === "error"
          ? "失败"
          : "处理中";
    row.append(copy, createElement("span", { className: "upload-task-state" }, stateText));
    container.append(row);
  }
  if (visible.length < tasks.length) container.append(createElement("p", { className: "upload-task-limit" }, `仅显示 ${visible.length} / ${tasks.length} 项`));
}

function renderUploadDialogTasks(runner, controls) {
  const tasks = runner.tasks();
  renderUploadTaskRows(tasks, controls.tasks);
  const counts = runner.counts();
  controls.summary.textContent = counts.total ? `${counts.total} 张图片等待后台处理` : "尚未选择图片";
  controls.start.disabled = counts.total === 0;
}

function uploadIsBusy() {
  if (!uploadSession?.started) return false;
  const counts = uploadSession.runner.counts();
  return uploadSession.runner.isRunning() || counts.queued > 0 || counts.active > 0;
}

function hideUploadDialog({ restoreFocus = true } = {}) {
  elements.uploadDialog.hidden = true;
  elements.uploadDialog.replaceChildren();
  elements.uploadDialog.onclick = null;
  if (uploadSession) uploadSession.modalOpen = false;
  if (restoreFocus) uploadSession?.opener?.focus();
}

function closeUpload({ restoreFocus = true } = {}) {
  if (uploadSession?.started) return;
  hideUploadDialog({ restoreFocus });
  uploadSession = null;
}

function dismissUploadSession({ restoreFocus = false } = {}) {
  if (uploadIsBusy()) return;
  const opener = uploadSession?.opener;
  hideUploadDialog({ restoreFocus: false });
  elements.uploadStatus.hidden = true;
  elements.uploadStatus.replaceChildren();
  elements.uploadOpen.textContent = "上传图片";
  uploadSession = null;
  if (restoreFocus) opener?.focus();
}

function renderBackgroundUpload() {
  if (!uploadSession?.started) {
    elements.uploadStatus.hidden = true;
    elements.uploadStatus.replaceChildren();
    return;
  }
  const { runner } = uploadSession;
  const counts = runner.counts();
  const failures = uploadFailureCounts(runner.tasks());
  const completed = counts.success + counts.error;
  const busy = uploadIsBusy();
  const panel = createElement("div", { className: "admin-upload-status-panel" });
  const header = createElement("header");
  const copy = createElement("div", { className: "admin-upload-status-copy" });
  copy.append(
    createElement("strong", {}, busy
      ? "后台上传中"
      : failures.retryable
        ? "上传需要处理"
        : failures.duplicate
          ? "重复图片已跳过"
          : "上传已完成"),
    createElement("span", { "aria-live": "polite" }, counts.error
      ? [
        `${counts.success} 张成功`,
        failures.duplicate ? `${failures.duplicate} 张重复已跳过` : "",
        failures.retryable ? `${failures.retryable} 张失败` : "",
      ].filter(Boolean).join("，")
      : `${completed} / ${counts.total} 已完成`),
  );
  const actions = createElement("div", { className: "admin-upload-status-actions" });
  const toggle = createElement("button", { type: "button" }, uploadSession.expanded ? "收起" : "展开");
  const retry = createElement("button", { type: "button" }, "重试失败项");
  retry.hidden = busy || failures.retryable === 0;
  const dismiss = createElement("button", { type: "button", "aria-label": "关闭上传任务", title: "关闭" }, "×");
  dismiss.disabled = busy;
  actions.append(toggle, retry, dismiss);
  header.append(copy, actions);

  const progress = createElement("progress", {
    max: Math.max(1, counts.total),
    value: completed,
    "aria-label": `上传进度 ${completed} / ${counts.total}`,
  });
  panel.append(header, progress);
  if (uploadSession.expanded) {
    const tasks = createElement("div", { className: "admin-upload-status-tasks" });
    renderUploadTaskRows(runner.tasks(), tasks);
    panel.append(tasks);
  }
  toggle.addEventListener("click", () => { uploadSession.expanded = !uploadSession.expanded; renderBackgroundUpload(); });
  retry.addEventListener("click", () => retryBackgroundUpload());
  dismiss.addEventListener("click", () => dismissUploadSession({ restoreFocus: true }));
  elements.uploadStatus.classList.toggle("is-collapsed", !uploadSession.expanded);
  elements.uploadStatus.replaceChildren(panel);
  elements.uploadStatus.hidden = false;
  elements.uploadOpen.textContent = busy ? "查看上传" : counts.error ? "查看失败项" : "上传图片";
}

function renderUploadSession() {
  if (!uploadSession) return;
  if (!uploadSession.started && uploadSession.controls) renderUploadDialogTasks(uploadSession.runner, uploadSession.controls);
  renderBackgroundUpload();
}

function scheduleUploadRender() {
  if (uploadRenderFrame !== null) return;
  uploadRenderFrame = requestAnimationFrame(() => {
    uploadRenderFrame = null;
    renderUploadSession();
  });
}

async function runBackgroundUpload({ retry = false } = {}) {
  const session = uploadSession;
  if (!session?.started || session.runner.isRunning()) return;
  try {
    if (retry) await session.runner.retryFailed(); else await session.runner.run();
  } finally {
    if (uploadSession !== session) return;
    mergeUploadResults(session.runner);
    renderUploadSession();
    const counts = session.runner.counts();
    const failures = uploadFailureCounts(session.runner.tasks());
    if (failures.retryable) {
      notifier.error(`${counts.success} 张上传成功，${failures.retryable} 张失败，可在上传任务中重试。`);
    } else if (failures.duplicate) {
      notifier.success(`${counts.success} 张上传成功，${failures.duplicate} 张重复图片已跳过。`);
    } else if (counts.total) {
      notifier.success(`已上传 ${counts.success} 张图片`);
    }
  }
}

function retryBackgroundUpload() {
  if (!uploadSession?.started || uploadIsBusy()) return;
  uploadSession.expanded = true;
  void runBackgroundUpload({ retry: true });
}

function startUploadInBackground(runner, controls) {
  const categoryId = Number(controls.category.value);
  const tagIds = controls.tagInputs.filter((input) => input.checked).map((input) => Number(input.value));
  const counts = runner.counts();
  if (!counts.total) {
    controls.error.textContent = "请至少选择一张图片。";
    return;
  }
  if (!categoryId) {
    controls.error.textContent = "请选择一个目录。";
    return;
  }
  if (!tagIds.length) {
    controls.error.textContent = "请至少选择一个标签。";
    return;
  }
  controls.error.textContent = "";
  runner.setMetadata({ categoryId, tagIds });
  uploadSession.started = true;
  uploadSession.expanded = true;
  uploadSession.controls = null;
  hideUploadDialog();
  renderUploadSession();
  notifier.success(`${counts.total} 张图片已转入后台上传`);
  void runBackgroundUpload();
}

function openUploadDialog() {
  if (!state.getCategories().length || !state.getTags().length) {
    notifier.error("目录和标签尚未加载完成，请稍后重试。");
    return;
  }
  if (uploadSession?.started) {
    const counts = uploadSession.runner.counts();
    if (!uploadIsBusy() && counts.error === 0) dismissUploadSession();
    else {
      uploadSession.expanded = true;
      renderBackgroundUpload();
      elements.uploadStatus.querySelector("button")?.focus();
      return;
    }
  }
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
  category.append(createElement("option", { value: "" }, "选择目录"));
  for (const item of state.getCategories()) {
    const option = createElement("option", { value: item.id }, `${item.name} /${item.directorySlug}`);
    category.append(option);
  }
  categoryLabel.append(createElement("span", {}, "目录"), category);
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
  const start = createElement("button", { type: "button", className: "admin-button-primary", disabled: "" }, "开始后台上传");
  footer.append(cancel, start);
  panel.append(header, body, footer);
  elements.uploadDialog.replaceChildren(panel);
  elements.uploadDialog.hidden = false;

  const controls = { files, category, tagInputs, error, summary, tasks, start };
  const runner = createUploadRunner({
    batchSize: 12,
    prepareFile: inspectImageFile,
    requestUploadUrls: async (batch, metadata) => {
      const payload = await client.request("/api/admin/images/upload/init", {
        method: "POST",
        body: JSON.stringify({
          files: batch.map((task) => ({
            ...task.draft,
            uploadId: task.uploadId,
            clientItemId: task.id,
          })),
          ...metadata,
        }),
      });
      return (payload.uploads ?? []).map((upload, index) => ({ ...upload, taskId: batch[index]?.id }));
    },
    uploadFile: uploadToSignedUrl,
    completeUploads: async (batch, metadata) => {
      const payload = await client.request("/api/admin/images/upload/complete", {
        method: "POST",
        body: JSON.stringify({
          files: batch.map((task) => ({
            uploadId: task.upload.uploadId,
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
    onChange: scheduleUploadRender,
  });
  uploadSession = { runner, opener, panel, controls, modalOpen: true, started: false, expanded: true };
  renderUploadSession();

  files.addEventListener("change", () => {
    runner.setFiles([...files.files]);
    error.textContent = "";
  });
  close.addEventListener("click", () => closeUpload());
  cancel.addEventListener("click", () => closeUpload());
  elements.uploadDialog.onclick = (event) => { if (event.target === elements.uploadDialog) closeUpload(); };
  start.addEventListener("click", () => startUploadInBackground(runner, controls));
  requestAnimationFrame(() => files.focus());
}

elements.loginForm.addEventListener("submit", submitLogin);
elements.passwordToggle.addEventListener("click", () => {
  const visible = elements.keyInput.type === "text";
  elements.keyInput.type = visible ? "password" : "text";
  elements.passwordToggle.textContent = visible ? "显示" : "隐藏";
  elements.passwordToggle.setAttribute("aria-label", visible ? "显示管理密钥" : "隐藏管理密钥");
});
elements.logout.addEventListener("click", () => {
  if (uploadIsBusy()) {
    notifier.error("图片仍在后台上传，请等待任务完成后再退出。");
    return;
  }
  dismissUploadSession();
  keyStore.clear();
  showAuth();
});
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
  if (action === "open-detail") openDetail(image, event.target, {
    sequenceIds: state.visibleImages().map((item) => Number(item.id)),
  });
});
elements.imageList.addEventListener("error", (event) => {
  if (!event.target.matches("[data-preview-image]")) return;
  if (event.target.dataset.previewRetry !== "1") {
    event.target.dataset.previewRetry = "1";
    const retryUrl = new URL(event.target.src, window.location.href);
    retryUrl.searchParams.set("gallery-preview-retry", Date.now().toString(36));
    event.target.src = retryUrl.href;
    return;
  }
  event.target.hidden = true;
  event.target.nextElementSibling.hidden = false;
}, true);
elements.imageList.addEventListener("load", (event) => {
  if (!event.target.matches("[data-preview-image]")) return;
  event.target.hidden = false;
  event.target.nextElementSibling.hidden = true;
}, true);
elements.bulkClear.addEventListener("click", () => setBulkMode(false));
elements.bulkTags.addEventListener("click", bulkAssignTags);
elements.bulkCategory.addEventListener("click", bulkAssignCategory);
elements.bulkDelete.addEventListener("click", bulkDelete);
elements.uploadOpen.addEventListener("click", openUploadDialog);
elements.detailOverlay.addEventListener("click", (event) => {
  if (event.target === elements.detailOverlay) void requestCloseDetail();
});
document.addEventListener("keydown", (event) => {
  if (elements.dialogHost.childElementCount) return;
  if (event.key === "Tab") {
    if (uploadSession?.modalOpen) trapFocus(event, uploadSession.panel);
    else if (detailImageId !== null) trapFocus(event, elements.detailOverlay);
    return;
  }
  const editing = event.target instanceof HTMLElement
    && (event.target.matches("input,select,textarea") || event.target.isContentEditable);
  if (detailImageId !== null && !editing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    void navigateDetail(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (event.key === "Escape") {
    if (uploadSession?.modalOpen) closeUpload();
    else if (detailImageId !== null) void requestCloseDetail();
  }
});
window.addEventListener("beforeunload", (event) => {
  captureActiveDetailDraft();
  if (!uploadIsBusy() && !detailDraftsHaveChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

if (keyStore.get()) {
  authenticate(keyStore.get()).catch((error) => {
    if (!(error instanceof AdminUnauthorizedError)) showAuth(errorMessage(error));
  });
} else {
  showAuth();
}
