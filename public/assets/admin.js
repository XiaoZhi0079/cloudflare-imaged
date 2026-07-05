import { renderAdminImageGrid, renderAdminImageList, renderAdminTagList } from "./templates.js";

const page = document.body.dataset.adminPage ?? "home";
const $ = (selector) => document.querySelector(selector);

const authPanel = $("#admin-auth");
const keyInput = $("#admin-key");
const connectButton = $("#admin-connect");
const createTagButton = $("#create-tag");
const newTagInput = $("#new-tag-name");
const uploadFilesInput = $("#upload-files");
const uploadSubmitButton = $("#upload-submit");
const uploadTagOptions = $("#upload-tag-options");
const uploadSummary = $("#upload-summary");
const statusBanner = $("#admin-status");
const tagList = $("#tag-list");
const imageList = $("#image-list");
const dialog = $("#admin-dialog");
const dialogTitle = $("#admin-dialog-title");
const dialogBody = $("#admin-dialog-body");
const dialogCloseButton = $("#admin-dialog-close");
const dialogCancelButton = $("#admin-dialog-cancel");
const dialogConfirmButton = $("#admin-dialog-confirm");
const uploadOpenButton = $("#admin-upload-open");
const uploadOpenToolbarButton = $("#admin-upload-open-toolbar");
const uploadDrawer = $("#admin-upload-drawer");
const uploadDrawerCloseButton = $("#admin-upload-close");
const detailDrawer = $("#admin-detail-drawer");
const detailPreview = $("#detail-preview");
const detailFileNameInput = $("#detail-file-name");
const detailDirectoryInput = $("#detail-directory");
const detailTagOptions = $("#detail-tag-options");
const detailSaveButton = $("#detail-save");
const detailCloseButton = $("#detail-close");
const detailDeleteButton = $("#detail-delete");
const searchInput = $("#admin-search");
const tagFilterList = $("#admin-tag-filter-list");
const bulkToolbar = $("#admin-bulk-toolbar");
const bulkSelectedCount = $("#bulk-selected-count");
const bulkAssignTagsButton = $("#bulk-assign-tags");
const bulkDeleteButton = $("#bulk-delete");
const bulkClearSelectionButton = $("#bulk-clear-selection");
const visibleCount = $("#admin-visible-count");
const tagManagerPanel = $("#tag-manager-panel");
const tagManagerToggleButton = $("#tag-manager-toggle");
const tagManagerList = $("#tag-manager-list");

const message = {
  enterKey: "\u8bf7\u8f93\u5165\u7ba1\u7406\u5bc6\u94a5\u540e\u7ee7\u7eed\u3002",
  savedKey: "\u68c0\u6d4b\u5230\u5df2\u4fdd\u5b58\u7684\u7ba1\u7406\u5bc6\u94a5\uff0c\u6b63\u5728\u9a8c\u8bc1\u3002",
  verifying: "\u6b63\u5728\u9a8c\u8bc1\u8eab\u4efd...",
  connected: "\u5df2\u8fdb\u5165\u540e\u53f0\u3002",
  uploadReady: "\u5df2\u8fdb\u5165\u4e0a\u4f20\u9875\uff0c\u53ef\u4ee5\u9009\u62e9\u56fe\u7247\u3002",
  tagsReady: "\u5df2\u8fdb\u5165\u6807\u7b7e\u7ba1\u7406\u9875\u3002",
  imagesReady: "\u5df2\u8fdb\u5165\u56fe\u7247\u7ba1\u7406\u9875\u3002",
  libraryReady: "\u5df2\u8fdb\u5165\u56fe\u7247\u5de5\u4f5c\u53f0\u3002",
  authFailed: "\u9a8c\u8bc1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7ba1\u7406\u5bc6\u94a5\u540e\u91cd\u8bd5\u3002",
  disconnected: "\u8bf7\u5148\u8f93\u5165\u7ba1\u7406\u5bc6\u94a5\u3002",
};

let adminKey = sessionStorage.getItem("gallery-admin-key") ?? "";
let isConnected = false;
let tags = [];
let images = [];
let selectedUploadTagIds = new Set();
let selectedFilesMeta = [];
let selectedImageIds = new Set();
let activeImageId = null;
let searchQuery = "";
let selectedTagFilters = new Set();
let activeDialog = null;
const tagManagerPreferenceKey = "gallery-tag-manager-expanded";
let wantsTagManagerExpanded = sessionStorage.getItem(tagManagerPreferenceKey) === "true";
const DIRECT_UPLOAD_BATCH_SIZE = 12;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(text, state = "info") {
  if (!statusBanner) {
    return;
  }

  statusBanner.textContent = text;
  statusBanner.dataset.state = state;
}

function setDisabled(element, disabled) {
  if (element) {
    element.disabled = disabled;
  }
}

function setConnected(connected) {
  isConnected = connected;
  if (authPanel) {
    authPanel.hidden = connected;
  }

  setDisabled(createTagButton, !connected);
  setDisabled(newTagInput, !connected);
  setDisabled(uploadFilesInput, !connected);
  setDisabled(uploadSubmitButton, !connected);
  setDisabled(uploadOpenButton, !connected);
  setDisabled(uploadOpenToolbarButton, !connected);
  setDisabled(searchInput, !connected);
  setDisabled(tagManagerToggleButton, !connected);

  const detailDisabled = !connected || activeImageId === null;
  setDisabled(detailFileNameInput, detailDisabled);
  setDisabled(detailDirectoryInput, detailDisabled);
  setDisabled(detailSaveButton, detailDisabled);
  setDisabled(detailDeleteButton, detailDisabled);
  detailTagOptions?.querySelectorAll("input").forEach((input) => {
    input.disabled = detailDisabled;
  });

  updateBulkToolbar();
  renderTagFilterOptions();
  setTagManagerExpanded(connected && wantsTagManagerExpanded, false);

  if (connectButton) {
    connectButton.textContent = connected ? "\u91cd\u65b0\u9a8c\u8bc1" : "\u8fdb\u5165\u540e\u53f0";
  }
}

function emptyState(text) {
  return `<div class="list-item admin-empty">${escapeHtml(text)}</div>`;
}

function renderDisconnectedState(text = message.disconnected) {
  if (tagList) {
    tagList.innerHTML = emptyState(text);
  }

  if (tagManagerList) {
    tagManagerList.innerHTML = emptyState(text);
  }

  if (tagFilterList) {
    tagFilterList.innerHTML = emptyState(text);
  }

  if (imageList) {
    imageList.innerHTML = emptyState(text);
  }

  if (uploadTagOptions) {
    uploadTagOptions.innerHTML = emptyState(text);
  }

  if (uploadSummary) {
    uploadSummary.innerHTML = escapeHtml(text);
  }
}

function clearState() {
  tags = [];
  images = [];
  selectedUploadTagIds = new Set();
  selectedFilesMeta = [];
  selectedImageIds = new Set();
  activeImageId = null;
  searchQuery = "";
  selectedTagFilters = new Set();
  closeImageDetailDrawer();
  updateBulkToolbar();
  updateVisibleCount();
}

function getDefaultErrorMessage(status) {
  if (status === 401) {
    return "\u7ba1\u7406\u5bc6\u94a5\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165\u3002";
  }

  if (status === 409) {
    return "\u6807\u7b7e\u5df2\u5b58\u5728\u3002";
  }

  if (status >= 500) {
    return "\u670d\u52a1\u7aef\u5904\u7406\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002";
  }

  return `\u8bf7\u6c42\u5931\u8d25\uff1a${status}`;
}

async function fetchJson(url, init = {}) {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers = {
    "x-gallery-admin-key": adminKey,
    ...(init.headers ?? {}),
  };

  if (!isFormData && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error ?? getDefaultErrorMessage(response.status));
  }

  return payload;
}

async function measureRequest(action) {
  const startedAt = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
  const value = await action();
  const finishedAt = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

  return {
    value,
    durationMs: Math.max(1, Math.round(finishedAt - startedAt)),
  };
}

async function waitForUi() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createUploadFileDrafts(files, filesMeta) {
  return files.map((file, index) => {
    const meta = filesMeta[index] ?? {};
    return {
      name: file.name,
      type: file.type,
      size: file.size,
      width: meta.width ?? null,
      height: meta.height ?? null,
    };
  });
}

async function uploadFileToSignedUrl(file, upload) {
  const response = await fetch(upload.uploadUrl, {
    method: upload.method ?? "PUT",
    headers: upload.headers ?? {},
    body: file,
  });

  if (response.ok) {
    return;
  }

  const text = await response.text();
  throw new Error(text || `图片直传失败：${file.name}`);
}

async function uploadFilesInBatches(files, uploads) {
  const total = uploads.length;

  for (let start = 0; start < total; start += DIRECT_UPLOAD_BATCH_SIZE) {
    const batch = uploads.slice(start, start + DIRECT_UPLOAD_BATCH_SIZE);
    await Promise.all(batch.map((upload, index) => uploadFileToSignedUrl(files[start + index], upload)));

    const completed = Math.min(start + batch.length, total);
    setStatus(`已直传 ${completed} / ${total} 张图片，正在继续处理...`, "info");
    await waitForUi();
  }
}

async function submitDirectUpload(files, filesMeta, tagIds) {
  const fileDrafts = createUploadFileDrafts(files, filesMeta);
  setStatus(`正在为 ${files.length} 张图片申请直传地址...`, "info");

  const initPayload = await fetchJson("/api/admin/images/upload/init", {
    method: "POST",
    body: JSON.stringify({
      tagIds,
      files: fileDrafts,
    }),
  });

  const uploads = Array.isArray(initPayload.uploads) ? initPayload.uploads : [];
  if (uploads.length !== files.length) {
    throw new Error("服务端返回的上传任务数量不正确。");
  }

  setStatus(`正在直传 ${files.length} 张图片到 R2...`, "info");
  await uploadFilesInBatches(files, uploads);

  setStatus("正在写入图片记录与标签绑定...", "info");
  return await fetchJson("/api/admin/images/upload/complete", {
    method: "POST",
    body: JSON.stringify({
      tagIds,
      files: uploads.map((upload) => ({
        storageKey: upload.storageKey,
        fileName: upload.fileName,
        width: upload.width ?? null,
        height: upload.height ?? null,
      })),
    }),
  });
}

function showError(error) {
  setStatus(error.message ?? String(error), "error");
}

function requireConnection() {
  if (!adminKey) {
    throw new Error("\u8bf7\u5148\u8f93\u5165\u7ba1\u7406\u5bc6\u94a5\u3002");
  }

  if (!isConnected) {
    throw new Error("\u8bf7\u5148\u8fdb\u5165\u540e\u53f0\u3002");
  }
}

async function runButtonAction(button, action) {
  const hasButton = Boolean(button);
  const wasDisabled = hasButton ? button.disabled : false;

  if (hasButton) {
    button.disabled = true;
  }

  try {
    await action();
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    if (!hasButton) {
      return;
    }

    if (button === connectButton) {
      button.disabled = false;
      return;
    }

    button.disabled = wasDisabled ? true : !isConnected;
  }
}

function hasDialog() {
  return Boolean(dialog && dialogTitle && dialogBody && dialogConfirmButton && dialogCancelButton && dialogCloseButton);
}

function setDialogError(text) {
  const error = dialogBody?.querySelector("[data-dialog-error]");
  if (error) {
    error.textContent = text;
  }
}

function closeDialog(value = null) {
  if (!activeDialog || !hasDialog()) {
    return;
  }

  const { resolve } = activeDialog;
  activeDialog = null;
  dialog.classList.add("hidden");
  dialogBody.innerHTML = "";
  resolve(value);
}

function openBaseDialog({ title, bodyHtml, confirmLabel = "\u786e\u8ba4", danger = false, onConfirm = () => true }) {
  if (!hasDialog()) {
    throw new Error("\u5bf9\u8bdd\u6846\u672a\u6b63\u786e\u52a0\u8f7d\u3002");
  }

  return new Promise((resolve) => {
    activeDialog = { resolve, onConfirm };
    dialogTitle.textContent = title;
    dialogBody.innerHTML = bodyHtml;
    dialogConfirmButton.textContent = confirmLabel;
    dialogConfirmButton.className = danger ? "button-danger" : "button-primary";
    dialog.classList.remove("hidden");

    const focusTarget = dialogBody.querySelector("input, textarea, select, button");
    setTimeout(() => focusTarget?.focus(), 0);
  });
}

function openTextDialog({ title, label, value = "", inputType = "text", confirmLabel = "\u4fdd\u5b58", helper = "", required = true }) {
  return openBaseDialog({
    title,
    confirmLabel,
    bodyHtml: `
      <label class="field dialog-field">
        <span>${escapeHtml(label)}</span>
        <input data-dialog-input type="${escapeHtml(inputType)}" value="${escapeHtml(value)}" />
      </label>
      ${helper ? `<div class="dialog-helper">${escapeHtml(helper)}</div>` : ""}
      <div class="dialog-error" data-dialog-error></div>
    `,
    onConfirm: () => {
      const input = dialogBody.querySelector("[data-dialog-input]");
      const nextValue = input.value.trim();
      if (required && !nextValue) {
        setDialogError("\u8bf7\u8f93\u5165\u6709\u6548\u5185\u5bb9\u3002");
        return false;
      }
      return nextValue;
    },
  });
}

function openConfirmDialog({ title, message: dialogMessage, confirmLabel = "\u786e\u8ba4", danger = false }) {
  return openBaseDialog({
    title,
    confirmLabel,
    danger,
    bodyHtml: `<p class="dialog-message">${escapeHtml(dialogMessage)}</p>`,
    onConfirm: () => true,
  });
}

function openTagAssignmentDialog(image) {
  const currentTagIds = new Set(
    (image.tags ?? [])
      .map((tagName) => tags.find((tag) => tag.name === tagName)?.id)
      .filter(Boolean),
  );
  const optionsHtml = tags.length
    ? tags
        .map(
          (tag) => `
            <label class="dialog-check-option">
              <input type="checkbox" value="${escapeHtml(tag.id)}" ${currentTagIds.has(tag.id) ? "checked" : ""} />
              <span>${escapeHtml(tag.name)}</span>
            </label>
          `,
        )
        .join("")
    : `<div class="admin-empty">\u5c1a\u672a\u521b\u5efa\u6807\u7b7e\u3002</div>`;

  return openBaseDialog({
    title: "\u8bbe\u7f6e\u56fe\u7247\u6807\u7b7e",
    confirmLabel: "\u4fdd\u5b58\u6807\u7b7e",
    bodyHtml: `
      <p class="dialog-message">${escapeHtml(image.fileName)}</p>
      <div class="dialog-check-grid">${optionsHtml}</div>
      <div class="dialog-helper">\u4e0d\u52fe\u9009\u4efb\u4f55\u6807\u7b7e\u5c06\u6e05\u7a7a\u8be5\u56fe\u7247\u7684\u6807\u7b7e\u3002</div>
    `,
    onConfirm: () =>
      [...dialogBody.querySelectorAll("input[type='checkbox']:checked")]
        .map((input) => Number(input.value))
        .filter((value) => Number.isFinite(value) && value > 0),
  });
}

function initDialog() {
  if (!hasDialog()) {
    return;
  }

  dialogConfirmButton.addEventListener("click", () => {
    if (!activeDialog) {
      return;
    }

    const value = activeDialog.onConfirm();
    if (value === false) {
      return;
    }

    closeDialog(value);
  });

  dialogCancelButton.addEventListener("click", () => closeDialog(null));
  dialogCloseButton.addEventListener("click", () => closeDialog(null));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog(null);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeDialog) {
      closeDialog(null);
    }
  });
}

async function updateTag(tagId, changes) {
  const payload = await fetchJson("/api/admin/tags", {
    method: "PATCH",
    body: JSON.stringify({ id: tagId, ...changes }),
  });

  return payload.tag;
}

function getTagById(tagId) {
  return tags.find((tag) => tag.id === tagId);
}

function sortTagsByOrder(list) {
  return [...list].sort((left, right) => {
    const orderDiff = Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }

    const nameDiff = String(left.name ?? "").localeCompare(String(right.name ?? ""), "zh-CN");
    if (nameDiff !== 0) {
      return nameDiff;
    }

    return Number(left.id ?? 0) - Number(right.id ?? 0);
  });
}

function setTagsState(nextTags, { rerenderImages = false } = {}) {
  tags = sortTagsByOrder(nextTags);
  renderTags();

  if (rerenderImages && imageList) {
    renderImages();
  }
}

function renameTagInImages(previousName, nextName) {
  if (!previousName || previousName === nextName) {
    return;
  }

  images = images.map((image) => ({
    ...image,
    tags: (image.tags ?? []).map((tag) => (tag === previousName ? nextName : tag)),
  }));
}

function removeTagFromImages(tagName) {
  images = images.map((image) => ({
    ...image,
    tags: (image.tags ?? []).filter((tag) => tag !== tagName),
  }));
}

function syncSelectedUploadTagIds() {
  selectedUploadTagIds = new Set(
    [...selectedUploadTagIds].filter((tagId) => tags.some((tag) => tag.id === tagId)),
  );
}

function renderUploadTagOptions() {
  if (!uploadTagOptions) {
    return;
  }

  syncSelectedUploadTagIds();

  if (!tags.length) {
    uploadTagOptions.innerHTML = emptyState("\u8bf7\u5148\u65b0\u589e\u6807\u7b7e\uff0c\u518d\u4e0a\u4f20\u56fe\u7247\u3002");
    return;
  }

  uploadTagOptions.innerHTML = tags
    .map(
      (tag) => `
        <label class="check-option tag-select-option">
          <input type="checkbox" value="${escapeHtml(tag.id)}" ${selectedUploadTagIds.has(tag.id) ? "checked" : ""} ${!isConnected ? "disabled" : ""} />
          <span>${escapeHtml(tag.name)}</span>
        </label>
      `,
    )
    .join("");

  uploadTagOptions.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      const tagId = Number(input.value);
      if (input.checked) {
        selectedUploadTagIds.add(tagId);
      } else {
        selectedUploadTagIds.delete(tagId);
      }
    });
  });
}

function renderTags() {
  renderTagFilterOptions();

  if (tagList) {
    tagList.innerHTML = tags.length
      ? renderAdminTagList(tags)
      : emptyState("还没有任何标签。");
    bindTagActions(tagList);
  }

  if (tagManagerList) {
    tagManagerList.innerHTML = tags.length
      ? renderAdminTagList(tags)
      : emptyState("还没有任何标签。");
    bindTagActions(tagManagerList);
  }

  renderUploadTagOptions();
  if (activeImageId !== null) {
    renderDetailTagOptions(getImageById(activeImageId));
  }
}

function renderUploadSummary(files = Array.from(uploadFilesInput?.files ?? []), filesMeta = selectedFilesMeta) {
  if (!uploadSummary) {
    return;
  }

  if (!files.length) {
    uploadSummary.innerHTML = "\u5c1a\u672a\u9009\u62e9\u56fe\u7247\u3002";
    return;
  }

  uploadSummary.innerHTML = `<div class="upload-file-list">${files
    .map((file, index) => {
      const meta = filesMeta[index] ?? {};
      const dimensionText = meta.width && meta.height ? `${meta.width} x ${meta.height}` : "\u5c3a\u5bf8\u5f85\u8bfb\u53d6";
      return `
        <div class="upload-file-row">
          <strong>${escapeHtml(file.name)}</strong>
          <span>${(file.size / 1024).toFixed(1)} KB</span>
          <span>${escapeHtml(dimensionText)}</span>
        </div>
      `;
    })
    .join("")}</div>`;
}

function getSelectedUploadTagIds() {
  return [...selectedUploadTagIds];
}

async function readImageMeta(file) {
  if (!String(file.type ?? "").startsWith("image/")) {
    return { width: null, height: null };
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const dimensions = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`\u65e0\u6cd5\u8bfb\u53d6\u56fe\u7247\u5c3a\u5bf8\uff1a${file.name}`));
      image.src = objectUrl;
    });

    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function collectSelectedFilesMeta(files) {
  return await Promise.all(files.map((file) => readImageMeta(file)));
}

async function handleFileSelection() {
  if (!uploadFilesInput) {
    return;
  }

  const files = Array.from(uploadFilesInput.files ?? []);
  if (!files.length) {
    selectedFilesMeta = [];
    renderUploadSummary();
    return;
  }

  setStatus(`\u6b63\u5728\u8bfb\u53d6 ${files.length} \u5f20\u56fe\u7247\u7684\u4fe1\u606f...`, "info");
  selectedFilesMeta = await collectSelectedFilesMeta(files);
  renderUploadSummary(files, selectedFilesMeta);
  setStatus(`\u5df2\u9009\u62e9 ${files.length} \u5f20\u56fe\u7247\u3002`, "info");
}

async function runTagAction(tagId, action) {
  requireConnection();

  const current = getTagById(tagId);
  if (!current) {
    return;
  }

  if (action === "rename-tag") {
    const name = await openTextDialog({
      title: "重命名标签",
      label: "标签名称",
      value: current.name,
    });
    if (name === null) {
      return;
    }

    const { value: updatedTag, durationMs } = await measureRequest(() => updateTag(tagId, { name }));
    if (selectedTagFilters.has(current.name)) {
      selectedTagFilters.delete(current.name);
      selectedTagFilters.add(updatedTag.name);
    }
    renameTagInImages(current.name, updatedTag.name);
    setTagsState(
      tags.map((tag) => (tag.id === tagId ? updatedTag : tag)),
      { rerenderImages: true }
    );
    setStatus(`已更新标签：${name}（${durationMs} ms）`, "success");
    return;
  }

  if (action === "assign-order") {
    const input = await openTextDialog({
      title: "调整标签排序",
      label: "排序数字",
      value: String(current.sortOrder),
      inputType: "number",
      helper: "数字越小越靠前。",
    });
    if (input === null) {
      return;
    }

    const sortOrder = Number(input);
    if (!Number.isFinite(sortOrder)) {
      throw new Error("排序必须是数字。");
    }

    const { value: updatedTag, durationMs } = await measureRequest(() => updateTag(tagId, { sortOrder }));
    setTagsState(tags.map((tag) => (tag.id === tagId ? updatedTag : tag)));
    setStatus(`已更新排序：${current.name}（${durationMs} ms）`, "success");
    return;
  }

  if (action === "toggle-tag") {
    const { value: updatedTag, durationMs } = await measureRequest(() => updateTag(tagId, { isVisible: !current.isVisible }));
    setTagsState(tags.map((tag) => (tag.id === tagId ? updatedTag : tag)));
    setStatus(`已${current.isVisible ? "隐藏" : "显示"}标签：${current.name}（${durationMs} ms）`, "success");
    return;
  }

  if (action === "delete-tag") {
    const confirmed = await openConfirmDialog({
      title: "删除标签",
      message: `删除标签“${current.name}”？图片文件不会删除，但该标签会从图片上移除。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    const { durationMs } = await measureRequest(() =>
      fetchJson("/api/admin/tags", {
        method: "DELETE",
        body: JSON.stringify({ id: tagId }),
      })
    );
    selectedTagFilters.delete(current.name);
    removeTagFromImages(current.name);
    setTagsState(tags.filter((tag) => tag.id !== tagId), { rerenderImages: true });
    setStatus(`已删除标签：${current.name}（${durationMs} ms）`, "success");
  }
}

function setTagManagerExpanded(expanded, persist = true) {
  wantsTagManagerExpanded = expanded;
  if (persist) {
    sessionStorage.setItem("gallery-tag-manager-expanded", String(expanded));
  }

  if (!tagManagerPanel) {
    return;
  }

  tagManagerPanel.classList.toggle("is-collapsed", !expanded);
  tagManagerPanel.dataset.state = expanded ? "expanded" : "collapsed";

  if (tagManagerToggleButton) {
    tagManagerToggleButton.textContent = expanded ? "\u6536\u8d77" : "\u5c55\u5f00";
    tagManagerToggleButton.setAttribute("aria-expanded", String(expanded));
  }
}

function bindTagFilterActions() {
  if (!tagFilterList) {
    return;
  }

  tagFilterList.querySelectorAll("[data-tag-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const tagName = button.dataset.tagFilter ?? "";
      if (!tagName) {
        return;
      }

      if (selectedTagFilters.has(tagName)) {
        selectedTagFilters.delete(tagName);
      } else {
        selectedTagFilters.add(tagName);
      }

      renderTagFilterOptions();
      renderImages();
    });
  });

  tagFilterList.querySelector("[data-clear-tag-filters]")?.addEventListener("click", () => {
    selectedTagFilters = new Set();
    renderTagFilterOptions();
    renderImages();
  });
}

function bindTagActions(container = tagList) {
  if (!container) {
    return;
  }

  container.querySelectorAll("[data-tag-id]").forEach((card) => {
    const tagId = Number(card.dataset.tagId);

    card.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        runButtonAction(button, async () => {
          await runTagAction(tagId, button.dataset.action);
        }).catch(() => {});
      });
    });
  });
}

async function renameImage(imageId) {
  requireConnection();

  const current = images.find((image) => image.id === imageId);
  if (!current) {
    return;
  }

  const nextFileName = await openTextDialog({
    title: "\u91cd\u547d\u540d\u56fe\u7247",
    label: "\u6587\u4ef6\u540d",
    value: current.fileName,
  });
  if (nextFileName === null) {
    return;
  }

  await fetchJson("/api/admin/images", {
    method: "PATCH",
    body: JSON.stringify({ imageId, fileName: nextFileName }),
  });

  await loadImages();
  setStatus(`\u5df2\u91cd\u547d\u540d\u56fe\u7247\uff1a${current.fileName} -> ${nextFileName}`, "success");
}

async function moveImage(imageId) {
  requireConnection();

  const current = images.find((image) => image.id === imageId);
  if (!current) {
    return;
  }

  const currentDirectory = String(current.fileUrl ?? "").split("/file/")[1]?.split("/").slice(0, -1).join("/") ?? "";
  const nextDirectory = await openTextDialog({
    title: "\u79fb\u52a8\u56fe\u7247\u76ee\u5f55",
    label: "\u76ee\u6807\u76ee\u5f55",
    value: currentDirectory,
    required: false,
    helper: "\u7559\u7a7a\u5c06\u79fb\u52a8\u5230\u6839\u76ee\u5f55\u3002",
  });
  if (nextDirectory === null) {
    return;
  }

  await fetchJson("/api/admin/images", {
    method: "PATCH",
    body: JSON.stringify({ imageId, directory: nextDirectory }),
  });

  await loadImages();
  setStatus(`\u5df2\u79fb\u52a8\u56fe\u7247\uff1a${current.fileName}`, "success");
}

async function deleteImage(imageId) {
  requireConnection();

  const current = images.find((image) => image.id === imageId);
  if (!current) {
    return;
  }

  const confirmed = await openConfirmDialog({
    title: "\u5220\u9664\u56fe\u7247",
    message: `\u5220\u9664\u56fe\u7247\u201c${current.fileName}\u201d\uff1f\u6b64\u64cd\u4f5c\u4f1a\u540c\u65f6\u5220\u9664\u5e95\u5c42\u6587\u4ef6\u3002`,
    confirmLabel: "\u5220\u9664",
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  await fetchJson("/api/admin/images", {
    method: "DELETE",
    body: JSON.stringify({ imageId }),
  });

  await loadImages();
  setStatus(`\u5df2\u5220\u9664\u56fe\u7247\uff1a${current.fileName}`, "success");
}

async function assignImageTags(imageId) {
  requireConnection();

  const current = images.find((image) => image.id === imageId);
  if (!current) {
    return;
  }

  const tagIds = await openTagAssignmentDialog(current);
  if (tagIds === null) {
    return;
  }

  await fetchJson("/api/admin/images/tag-assignments", {
    method: "POST",
    body: JSON.stringify({ imageId, tagIds }),
  });

  await loadImages();
  setStatus(`\u5df2\u66f4\u65b0\u56fe\u7247\u6807\u7b7e\uff1a${current.fileName}`, "success");
}

function isLibraryPage() {
  return page === "library";
}

function normalizeImageId(imageId) {
  return String(imageId ?? "");
}

function getImageById(imageId) {
  const normalized = normalizeImageId(imageId);
  return images.find((image) => normalizeImageId(image.id) === normalized);
}

function getImageDirectory(image) {
  const path = String(image?.fileUrl ?? "").split("/file/")[1] ?? "";
  return path.split("/").slice(0, -1).join("/");
}

function renderTagFilterOptions() {
  if (!tagFilterList) {
    return;
  }

  selectedTagFilters = new Set([...selectedTagFilters].filter((tagName) => tags.some((tag) => tag.name === tagName)));

  if (!tags.length) {
    tagFilterList.innerHTML = '<div class="admin-filter-empty">还没有任何标签。</div>';
    return;
  }

  const clearButton = selectedTagFilters.size
    ? '<button class="admin-tag-filter-chip is-clear" type="button" data-clear-tag-filters>清空筛选</button>'
    : '';

  tagFilterList.innerHTML = `${tags
    .map((tag) => {
      const isActive = selectedTagFilters.has(tag.name);
      return `
        <button
          class="admin-tag-filter-chip ${isActive ? "is-active" : ""}"
          type="button"
          data-tag-filter="${escapeHtml(tag.name)}"
          ${!isConnected ? "disabled" : ""}
        >
          <span>${escapeHtml(tag.name)}</span>
          <span class="admin-tag-filter-chip-meta">${escapeHtml(tag.sortOrder)}</span>
        </button>
      `;
    })
    .join("")}${clearButton}`;

  bindTagFilterActions();
}

function setDrawerOpen(drawer, open) {
  if (!drawer) {
    return;
  }

  drawer.hidden = !open;
  drawer.classList.toggle("is-open", open);
}

function openUploadDrawer() {
  requireConnection();
  setDrawerOpen(uploadDrawer, true);
}

function closeUploadDrawer() {
  setDrawerOpen(uploadDrawer, false);
}

function renderDetailTagOptions(image = getImageById(activeImageId)) {
  if (!detailTagOptions) {
    return;
  }

  if (!tags.length) {
    detailTagOptions.innerHTML = emptyState("\u8fd8\u6ca1\u6709\u4efb\u4f55\u6807\u7b7e\u3002");
    return;
  }

  const currentTagNames = new Set(image?.tags ?? []);
  const disabled = !isConnected || activeImageId === null ? "disabled" : "";
  detailTagOptions.innerHTML = tags
    .map(
      (tag) => `
        <label class="check-option tag-select-option">
          <input type="checkbox" value="${escapeHtml(tag.id)}" ${currentTagNames.has(tag.name) ? "checked" : ""} ${disabled} />
          <span>${escapeHtml(tag.name)}</span>
        </label>
      `,
    )
    .join("");
}

function getSelectedDetailTagIds() {
  return [...(detailTagOptions?.querySelectorAll("input[type='checkbox']:checked") ?? [])]
    .map((input) => Number(input.value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function openImageDetailDrawer(imageId) {
  requireConnection();

  const current = getImageById(imageId);
  if (!current) {
    return;
  }

  activeImageId = current.id;
  if (detailPreview) {
    detailPreview.innerHTML = current.fileUrl
      ? `<img src="${escapeHtml(current.fileUrl)}" alt="${escapeHtml(current.fileName)}" />`
      : `<div class="admin-empty">IMG</div>`;
  }
  if (detailFileNameInput) {
    detailFileNameInput.value = current.fileName ?? "";
  }
  if (detailDirectoryInput) {
    detailDirectoryInput.value = getImageDirectory(current);
  }

  renderDetailTagOptions(current);
  setDrawerOpen(detailDrawer, true);
  setConnected(isConnected);
}

function closeImageDetailDrawer() {
  activeImageId = null;
  setDrawerOpen(detailDrawer, false);
  if (detailPreview) {
    detailPreview.innerHTML = "";
  }
  if (detailFileNameInput) {
    detailFileNameInput.value = "";
  }
  if (detailDirectoryInput) {
    detailDirectoryInput.value = "";
  }
  if (detailTagOptions) {
    detailTagOptions.innerHTML = "";
  }
  setConnected(isConnected);
}

async function saveImageDetail() {
  requireConnection();

  const imageId = activeImageId;
  const current = getImageById(imageId);
  if (!current) {
    return;
  }

  const nextFileName = detailFileNameInput?.value.trim() ?? current.fileName;
  const nextDirectory = detailDirectoryInput?.value.trim() ?? getImageDirectory(current);
  const currentDirectory = getImageDirectory(current);

  if (!nextFileName) {
    throw new Error("\u8bf7\u8f93\u5165\u6587\u4ef6\u540d\u3002");
  }

  if (nextFileName !== current.fileName) {
    await fetchJson("/api/admin/images", {
      method: "PATCH",
      body: JSON.stringify({ imageId, fileName: nextFileName }),
    });
  }

  if (nextDirectory !== currentDirectory) {
    await fetchJson("/api/admin/images", {
      method: "PATCH",
      body: JSON.stringify({ imageId, directory: nextDirectory }),
    });
  }

  await fetchJson("/api/admin/images/tag-assignments", {
    method: "POST",
    body: JSON.stringify({ imageId, tagIds: getSelectedDetailTagIds() }),
  });

  await loadImages();
  openImageDetailDrawer(imageId);
  setStatus(`\u5df2\u4fdd\u5b58\u56fe\u7247\u4fe1\u606f\uff1a${current.fileName}`, "success");
}

function getFilteredImages() {
  const query = searchQuery.trim().toLowerCase();
  return images.filter((image) => {
    const fileName = String(image.fileName ?? "").toLowerCase();
    const imageTags = image.tags ?? [];
    const matchesSearch = !query || fileName.includes(query) || imageTags.some((tag) => String(tag).toLowerCase().includes(query));
    const matchesTags = !selectedTagFilters.size || [...selectedTagFilters].every((tag) => imageTags.includes(tag));
    return matchesSearch && matchesTags;
  });
}

function syncSelectedImageIds() {
  const existingIds = new Set(images.map((image) => normalizeImageId(image.id)));
  selectedImageIds = new Set([...selectedImageIds].filter((imageId) => existingIds.has(normalizeImageId(imageId))));
}

function updateVisibleCount(count = isLibraryPage() ? getFilteredImages().length : images.length) {
  if (visibleCount) {
    visibleCount.textContent = String(count);
  }
}

function updateBulkToolbar() {
  if (!bulkToolbar) {
    return;
  }

  const selectedCount = selectedImageIds.size;
  bulkToolbar.hidden = selectedCount === 0;
  if (bulkSelectedCount) {
    bulkSelectedCount.textContent = `\u5df2\u9009\u62e9 ${selectedCount} \u5f20`;
  }

  const disabled = !isConnected || selectedCount === 0;
  setDisabled(bulkAssignTagsButton, disabled);
  setDisabled(bulkDeleteButton, disabled);
  setDisabled(bulkClearSelectionButton, disabled);
}

function clearImageSelection() {
  selectedImageIds = new Set();
  renderImages();
}

function openBulkTagAssignmentDialog() {
  const optionsHtml = tags.length
    ? tags
        .map(
          (tag) => `
            <label class="dialog-check-option">
              <input type="checkbox" value="${escapeHtml(tag.id)}" />
              <span>${escapeHtml(tag.name)}</span>
            </label>
          `,
        )
        .join("")
    : `<div class="admin-empty">\u5c1a\u672a\u521b\u5efa\u6807\u7b7e\u3002</div>`;

  return openBaseDialog({
    title: "\u6279\u91cf\u8bbe\u7f6e\u6807\u7b7e",
    confirmLabel: "\u5e94\u7528\u5230\u6240\u9009\u56fe\u7247",
    bodyHtml: `
      <p class="dialog-message">\u5c06\u9009\u4e2d\u6807\u7b7e\u5e94\u7528\u5230 ${selectedImageIds.size} \u5f20\u56fe\u7247\u3002\u4e0d\u52fe\u9009\u6807\u7b7e\u5c06\u6e05\u7a7a\u5b83\u4eec\u7684\u6807\u7b7e\u3002</p>
      <div class="dialog-check-grid">${optionsHtml}</div>
    `,
    onConfirm: () =>
      [...dialogBody.querySelectorAll("input[type='checkbox']:checked")]
        .map((input) => Number(input.value))
        .filter((value) => Number.isFinite(value) && value > 0),
  });
}

async function assignTagsToSelectedImages() {
  requireConnection();

  const imageIds = [...selectedImageIds];
  if (!imageIds.length) {
    return;
  }

  const tagIds = await openBulkTagAssignmentDialog();
  if (tagIds === null) {
    return;
  }

  for (const imageId of imageIds) {
    await fetchJson("/api/admin/images/tag-assignments", {
      method: "POST",
      body: JSON.stringify({ imageId: Number(imageId), tagIds }),
    });
  }

  selectedImageIds = new Set();
  await loadImages();
  setStatus(`\u5df2\u66f4\u65b0 ${imageIds.length} \u5f20\u56fe\u7247\u7684\u6807\u7b7e\u3002`, "success");
}

async function deleteSelectedImages() {
  requireConnection();

  const imageIds = [...selectedImageIds];
  if (!imageIds.length) {
    return;
  }

  const confirmed = await openConfirmDialog({
    title: "\u5220\u9664\u6240\u9009\u56fe\u7247",
    message: `\u5220\u9664 ${imageIds.length} \u5f20\u56fe\u7247\uff1f\u6b64\u64cd\u4f5c\u4f1a\u540c\u65f6\u5220\u9664\u5e95\u5c42\u6587\u4ef6\u3002`,
    confirmLabel: "\u5220\u9664",
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  for (const imageId of imageIds) {
    await fetchJson("/api/admin/images", {
      method: "DELETE",
      body: JSON.stringify({ imageId: Number(imageId) }),
    });
  }

  selectedImageIds = new Set();
  closeImageDetailDrawer();
  await loadImages();
  setStatus(`\u5df2\u5220\u9664 ${imageIds.length} \u5f20\u56fe\u7247\u3002`, "success");
}
function bindImageActions() {
  if (!imageList) {
    return;
  }

  imageList.querySelectorAll("[data-image-id]").forEach((card) => {
    const imageId = Number(card.dataset.imageId);
    const normalizedImageId = normalizeImageId(card.dataset.imageId);
    const checkbox = card.querySelector("[data-image-select]");
    if (checkbox) {
      checkbox.checked = selectedImageIds.has(normalizedImageId);
      checkbox.disabled = !isConnected;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedImageIds.add(normalizedImageId);
        } else {
          selectedImageIds.delete(normalizedImageId);
        }
        updateBulkToolbar();
      });
    }

    const actionHandlers = {
      "assign-tags": assignImageTags,
      "rename-image": renameImage,
      "move-image": moveImage,
      "delete-image": deleteImage,
      "open-detail": openImageDetailDrawer,
    };

    card.querySelectorAll("[data-action]").forEach((button) => {
      const handler = actionHandlers[button.dataset.action];
      if (!handler) {
        return;
      }

      button.addEventListener("click", () => {
        runButtonAction(button, async () => {
          await handler(imageId);
        }).catch(() => {});
      });
    });
  });
}

function renderImages() {
  if (!imageList) {
    return;
  }

  syncSelectedImageIds();
  const shouldRenderGrid = isLibraryPage() || imageList.classList.contains("admin-image-grid");
  const currentImages = shouldRenderGrid ? getFilteredImages() : images;
  imageList.innerHTML = currentImages.length
    ? shouldRenderGrid
      ? renderAdminImageGrid(currentImages)
      : renderAdminImageList(currentImages)
    : emptyState("\u8fd8\u6ca1\u6709\u5f55\u5165\u56fe\u7247\u3002");
  updateVisibleCount(currentImages.length);
  updateBulkToolbar();
  bindImageActions();
}

async function loadTags() {
  const payload = await fetchJson("/api/admin/tags", {
    method: "GET",
  });

  tags = Array.isArray(payload.tags) ? payload.tags : [];
  renderTags();
}

async function loadImages() {
  const payload = await fetchJson("/api/admin/images", {
    method: "GET",
    headers: {},
  });

  images = Array.isArray(payload.images) ? payload.images : [];
  syncSelectedImageIds();
  renderImages();
}

async function refreshPageData() {
  if (page === "library" || page === "images") {
    await loadTags();
    await loadImages();
    return;
  }

  if (page === "home" || page === "upload" || page === "tags") {
    await loadTags();
  }
}

function connectedStatusForPage() {
  if (page === "library") {
    return message.libraryReady;
  }

  if (page === "upload") {
    return message.uploadReady;
  }

  if (page === "tags") {
    return message.tagsReady;
  }

  if (page === "images") {
    return message.imagesReady;
  }

  return message.connected;
}

async function authenticate() {
  adminKey = (keyInput?.value ?? adminKey).trim();
  if (!adminKey) {
    throw new Error("\u8bf7\u8f93\u5165\u7ba1\u7406\u5bc6\u94a5\u3002");
  }

  setStatus(message.verifying, "info");
  sessionStorage.setItem("gallery-admin-key", adminKey);
  await refreshPageData();
  setConnected(true);
  setStatus(connectedStatusForPage(), "success");
}

function handleAuthFailure() {
  setConnected(false);
  clearState();
  sessionStorage.removeItem("gallery-admin-key");
  renderDisconnectedState(message.authFailed);
}

function initCommonAuth() {
  if (keyInput) {
    keyInput.value = adminKey;
  }

  keyInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      connectButton?.click();
    }
  });

  if (!connectButton) {
    return;
  }

  connectButton.addEventListener("click", () => {
    runButtonAction(connectButton, authenticate).catch(() => {
      handleAuthFailure();
    });
  });
}

function initHomePage() {}

function initLibraryPage() {
  initUploadPage();
  initTagsPage();
  setTagManagerExpanded(isConnected && wantsTagManagerExpanded, false);

  [uploadOpenButton, uploadOpenToolbarButton].filter(Boolean).forEach((button) => {
    button.addEventListener("click", () => {
      runButtonAction(button, async () => {
        openUploadDrawer();
      }).catch(() => {});
    });
  });

  tagManagerToggleButton?.addEventListener("click", () => {
    if (!isConnected) {
      return;
    }

    setTagManagerExpanded(tagManagerPanel?.classList.contains("is-collapsed"));
  });

  uploadDrawerCloseButton?.addEventListener("click", closeUploadDrawer);
  uploadDrawer?.addEventListener("click", (event) => {
    if (event.target === uploadDrawer) {
      closeUploadDrawer();
    }
  });

  detailCloseButton?.addEventListener("click", closeImageDetailDrawer);
  detailDrawer?.addEventListener("click", (event) => {
    if (event.target === detailDrawer) {
      closeImageDetailDrawer();
    }
  });

  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderImages();
  });
  bulkAssignTagsButton?.addEventListener("click", () => {
    runButtonAction(bulkAssignTagsButton, assignTagsToSelectedImages).catch(() => {});
  });

  bulkDeleteButton?.addEventListener("click", () => {
    runButtonAction(bulkDeleteButton, deleteSelectedImages).catch(() => {});
  });

  bulkClearSelectionButton?.addEventListener("click", clearImageSelection);

  detailSaveButton?.addEventListener("click", () => {
    runButtonAction(detailSaveButton, saveImageDetail).catch(() => {});
  });

  detailDeleteButton?.addEventListener("click", () => {
    runButtonAction(detailDeleteButton, async () => {
      if (activeImageId !== null) {
        await deleteImage(activeImageId);
        closeImageDetailDrawer();
      }
    }).catch(() => {});
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (tagManagerPanel && !tagManagerPanel.classList.contains("is-collapsed")) {
      setTagManagerExpanded(false);
      return;
    }

    if (uploadDrawer && !uploadDrawer.hidden) {
      closeUploadDrawer();
      return;
    }

    if (detailDrawer && !detailDrawer.hidden) {
      closeImageDetailDrawer();
    }
  });
}

function initUploadPage() {
  renderUploadSummary();

  uploadFilesInput?.addEventListener("change", () => {
    handleFileSelection().catch(showError);
  });

  uploadSubmitButton?.addEventListener("click", () => {
    runButtonAction(uploadSubmitButton, async () => {
      requireConnection();

      const files = Array.from(uploadFilesInput?.files ?? []);
      if (!files.length) {
        throw new Error("\u8bf7\u5148\u9009\u62e9\u81f3\u5c11\u4e00\u5f20\u56fe\u7247\u3002");
      }

      const tagIds = getSelectedUploadTagIds();
      if (!tagIds.length) {
        throw new Error("\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u6807\u7b7e\u3002");
      }

      const filesMeta = selectedFilesMeta.length === files.length
        ? selectedFilesMeta
        : await collectSelectedFilesMeta(files);

      const payload = await submitDirectUpload(files, filesMeta, tagIds);

      uploadFilesInput.value = "";
      selectedFilesMeta = [];
      renderUploadSummary();
      if (isLibraryPage()) {
        await loadImages();
        closeUploadDrawer();
      }
      setStatus(`\u5df2\u4e0a\u4f20 ${payload.uploadedCount} \u5f20\u56fe\u7247\uff0c\u5e76\u5b8c\u6210\u6807\u7b7e\u7ed1\u5b9a\u3002`, "success");
    }).catch(() => {});
  });
}

function initTagsPage() {
  createTagButton?.addEventListener("click", () => {
    runButtonAction(createTagButton, async () => {
      requireConnection();

      const name = newTagInput?.value.trim() ?? "";
      if (!name) {
        throw new Error("请输入新标签名称。");
      }

      const { value: payload, durationMs } = await measureRequest(() =>
        fetchJson("/api/admin/tags", {
          method: "POST",
          body: JSON.stringify({
            name,
            sortOrder: tags.length + 1,
            isVisible: true,
          }),
        })
      );

      newTagInput.value = "";
      setTagsState([...tags, payload.tag]);
      setStatus(`已新增标签：${name}（${durationMs} ms）`, "success");
    }).catch(() => {});
  });

  newTagInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createTagButton?.click();
    }
  });
}

function initImagesPage() {}

function initCurrentPage() {
  if (page === "library") {
    initLibraryPage();
    return;
  }

  if (page === "upload") {
    initUploadPage();
    return;
  }

  if (page === "tags") {
    initTagsPage();
    return;
  }

  if (page === "images") {
    initImagesPage();
    return;
  }

  initHomePage();
}

function boot() {
  initDialog();
  initCommonAuth();
  initCurrentPage();
  setConnected(false);
  renderDisconnectedState(adminKey ? message.savedKey : message.disconnected);

  if (adminKey) {
    setStatus(message.savedKey, "info");
    authenticate().catch((error) => {
      showError(error);
      handleAuthFailure();
    });
  } else {
    setStatus(message.enterKey, "info");
  }
}

boot();



