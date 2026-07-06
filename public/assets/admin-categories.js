const page = document.body.dataset.adminPage ?? "home";
const $ = (selector) => document.querySelector(selector);

const authPanel = $("#admin-auth");
const connectButton = $("#admin-connect");
const statusBanner = $("#admin-status");
const uploadCategorySelect = $("#upload-category");
const uploadSubmitButton = $("#upload-submit");
const newCategoryNameInput = $("#new-category-name");
const newCategoryDirectoryInput = $("#new-category-directory");
const createCategoryButton = $("#create-category");
const categoryList = $("#category-list");

let categories = [];
let fetchWrapped = false;

function setStatus(text, state = "info") {
  if (!statusBanner) {
    return;
  }

  statusBanner.textContent = text;
  statusBanner.dataset.state = state;
}

function getAdminKey() {
  return sessionStorage.getItem("gallery-admin-key") ?? "";
}

function isAuthenticated() {
  return authPanel ? authPanel.hidden : Boolean(getAdminKey());
}

function isUploadPage() {
  return page === "upload";
}

function isTagsPage() {
  return page === "tags";
}

async function adminFetchJson(url, init = {}) {
  const adminKey = getAdminKey();
  const response = await fetch(url, {
    ...init,
    headers: {
      "x-gallery-admin-key": adminKey,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error ?? `请求失败：${response.status}`);
  }

  return payload;
}

function renderUploadCategoryOptions() {
  if (!uploadCategorySelect) {
    return;
  }

  const options = ['<option value="">请选择主分类</option>']
    .concat(
      categories.map(
        (category) =>
          `<option value="${category.id}">${category.name} · ${category.directorySlug}</option>`,
      ),
    )
    .join("");

  uploadCategorySelect.innerHTML = options;
  uploadCategorySelect.disabled = !isAuthenticated() || categories.length === 0;
}

function bindCategoryActions() {
  if (!categoryList) {
    return;
  }

  categoryList.querySelectorAll("[data-action='rename-category']").forEach((button) => {
    button.addEventListener("click", async () => {
      const categoryId = Number(button.dataset.categoryId);
      const current = categories.find((item) => item.id === categoryId);
      if (!current) {
        return;
      }

      const nextName = window.prompt("输入新的分类名称", current.name);
      if (nextName === null) {
        return;
      }

      const trimmed = nextName.trim();
      if (!trimmed) {
        setStatus("分类名称不能为空。", "error");
        return;
      }

      try {
        const payload = await adminFetchJson("/api/admin/categories", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: categoryId,
            name: trimmed,
          }),
        });

        categories = categories.map((category) => (category.id === categoryId ? payload.category : category));
        renderCategoryList();
        renderUploadCategoryOptions();
        setStatus(`已更新分类：${trimmed}`, "success");
      } catch (error) {
        setStatus(error.message ?? String(error), "error");
      }
    });
  });
}

function renderCategoryList() {
  if (!categoryList) {
    return;
  }

  if (!categories.length) {
    categoryList.innerHTML = '<div class="list-item admin-empty">还没有任何分类。</div>';
    return;
  }

  categoryList.innerHTML = categories
    .map(
      (category) => `
        <div class="admin-tag-row list-item">
          <div class="admin-row-main">
            <div class="admin-row-titleline">
              <strong class="admin-row-title">${category.name}</strong>
            </div>
            <div class="admin-row-meta">
              <span>目录: ${category.directorySlug}</span>
              <span>排序: ${category.sortOrder}</span>
            </div>
          </div>
          <div class="admin-row-actions inline-actions">
            <button class="button-secondary" type="button" data-action="rename-category" data-category-id="${category.id}">重命名</button>
          </div>
        </div>
      `,
    )
    .join("");

  bindCategoryActions();
}

function validateUploadCategory(event) {
  if (!isUploadPage() || !uploadCategorySelect || !isAuthenticated()) {
    return;
  }

  const categoryId = Number(uploadCategorySelect.value);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  setStatus("请选择一个主分类。", "error");
}

function installUploadFetchWrapper() {
  if (!isUploadPage() || fetchWrapped || typeof fetch !== "function") {
    return;
  }

  const originalFetch = fetch.bind(globalThis);
  globalThis.fetch = async (input, init = undefined) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const shouldInject = typeof url === "string"
      && method === "POST"
      && (url.includes("/api/admin/images/upload/init") || url.includes("/api/admin/images/upload/complete"));

    if (!shouldInject || typeof init?.body !== "string" || !uploadCategorySelect) {
      return await originalFetch(input, init);
    }

    const categoryId = Number(uploadCategorySelect.value);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return await originalFetch(input, init);
    }

    const payload = JSON.parse(init.body);
    payload.categoryId = categoryId;

    return await originalFetch(input, {
      ...init,
      body: JSON.stringify(payload),
    });
  };

  fetchWrapped = true;
}

async function loadCategories() {
  const payload = await adminFetchJson("/api/admin/categories");
  categories = Array.isArray(payload.categories) ? payload.categories : [];
  renderUploadCategoryOptions();
  renderCategoryList();
}

async function refreshCategoriesWhenReady() {
  if (!getAdminKey() || !isAuthenticated()) {
    return;
  }

  try {
    await loadCategories();
  } catch {
    // Ignore until auth succeeds and bindings are ready.
  }
}

async function createCategory() {
  const name = String(newCategoryNameInput?.value ?? "").trim();
  const directorySlug = String(newCategoryDirectoryInput?.value ?? "").trim();

  if (!name) {
    setStatus("分类名称不能为空。", "error");
    return;
  }

  if (!directorySlug) {
    setStatus("英文目录不能为空。", "error");
    return;
  }

  try {
    const payload = await adminFetchJson("/api/admin/categories", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        directorySlug,
        sortOrder: categories.length + 1,
      }),
    });

    categories = [...categories, payload.category].sort((left, right) => left.sortOrder - right.sortOrder);
    if (newCategoryNameInput) {
      newCategoryNameInput.value = "";
    }
    if (newCategoryDirectoryInput) {
      newCategoryDirectoryInput.value = "";
    }
    renderCategoryList();
    renderUploadCategoryOptions();
    setStatus(`已新增分类：${payload.category.name}`, "success");
  } catch (error) {
    setStatus(error.message ?? String(error), "error");
  }
}

function setTagsPageControlsEnabled(enabled) {
  if (newCategoryNameInput) {
    newCategoryNameInput.disabled = !enabled;
  }
  if (newCategoryDirectoryInput) {
    newCategoryDirectoryInput.disabled = !enabled;
  }
  if (createCategoryButton) {
    createCategoryButton.disabled = !enabled;
  }
}

function initTagsPage() {
  if (!isTagsPage()) {
    return;
  }

  createCategoryButton?.addEventListener("click", createCategory);
  newCategoryDirectoryInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createCategory();
    }
  });
}

function initUploadPage() {
  if (!isUploadPage()) {
    return;
  }

  installUploadFetchWrapper();
  uploadSubmitButton?.addEventListener("click", validateUploadCategory, true);
}

function boot() {
  initUploadPage();
  initTagsPage();
  setTagsPageControlsEnabled(false);
  setInterval(() => {
    const ready = isAuthenticated();
    if (isTagsPage()) {
      setTagsPageControlsEnabled(ready);
    }
    refreshCategoriesWhenReady();
  }, 800);
  connectButton?.addEventListener("click", () => {
    setTimeout(() => {
      refreshCategoriesWhenReady();
      setTagsPageControlsEnabled(isAuthenticated());
    }, 600);
  });
  refreshCategoriesWhenReady();
}

boot();
