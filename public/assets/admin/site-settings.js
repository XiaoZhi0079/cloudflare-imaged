function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function labelText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function featuredDisplay(image) {
  const eligibility = image.featuredEligibility && typeof image.featuredEligibility === "object"
    ? image.featuredEligibility
    : {};
  const eligible = eligibility.eligible === true;
  const dimensions = labelText(eligibility.dimensions, "尺寸未知");
  const status = eligible
    ? labelText(eligibility.statusLabel, "状态未知")
    : labelText(eligibility.reason || eligibility.statusLabel, "状态未知");
  const quality = String(eligibility.qualityLabel ?? "").trim();

  return {
    dimensions,
    eligible,
    is4K: eligibility.is4K === true,
    quality,
    status,
  };
}

function renderFeaturedMetadata(display, className, { prefixInvalid = false } = {}) {
  const status = prefixInvalid && !display.eligible
    ? `不可加入：${display.status}`
    : display.status;
  const qualityBadge = display.quality
    ? `<span class="site-eligibility-quality">${escapeHtml(display.quality)}</span>`
    : "";

  return `<div class="${className}">
              <span class="site-eligibility-dimensions">${escapeHtml(display.dimensions)}</span>
              <span class="site-eligibility-status">${escapeHtml(status)}</span>
              ${qualityBadge}
            </div>`;
}

export function renderFeaturedItem(image, index, total) {
  const display = featuredDisplay(image);
  const stateClass = display.eligible ? "is-eligible" : "is-ineligible";
  const qualityClass = display.is4K ? " is-4k" : "";
  const fileName = escapeHtml(image.fileName || "未命名图片");
  const fileUrl = escapeHtml(image.fileUrl || "");
  const warning = display.eligible
    ? ""
    : `<p class="site-featured-warning">当前图片不符合轮播规格，请移除后再保存。</p>`;

  return `<article class="site-featured-item ${stateClass}${qualityClass}" data-featured-id="${escapeHtml(image.id)}">
          <img src="${fileUrl}" alt="${fileName}" loading="lazy" />
          <div class="site-featured-copy">
            <strong title="${fileName}">${fileName}</strong>
            <span>第 ${index + 1} 张</span>
            ${renderFeaturedMetadata(display, "site-featured-meta")}
            ${warning}
          </div>
          <div class="site-featured-item-actions">
            <button type="button" data-action="move-up" ${index === 0 ? "disabled" : ""} aria-label="上移">↑</button>
            <button type="button" data-action="move-down" ${index === total - 1 ? "disabled" : ""} aria-label="下移">↓</button>
            <button type="button" data-action="remove" class="admin-button-danger">移除</button>
          </div>
        </article>`;
}

export function renderFeaturedPickerCard(image, selected = false) {
  const display = featuredDisplay(image);
  const stateClass = display.eligible ? "is-eligible" : "is-ineligible is-disabled";
  const qualityClass = display.is4K ? " is-4k" : "";
  const checked = selected ? " checked" : "";
  const disabled = display.eligible ? "" : " disabled";
  const fileName = escapeHtml(image.fileName || "未命名");

  return `<label class="site-picker-card ${stateClass}${qualityClass}">
              <input type="checkbox" value="${escapeHtml(image.id)}"${checked}${disabled} />
              <img src="${escapeHtml(image.fileUrl || "")}" alt="${fileName}" loading="lazy" />
              <span class="site-picker-name" title="${fileName}">${fileName}</span>
              ${renderFeaturedMetadata(display, "site-picker-meta", { prefixInvalid: true })}
            </label>`;
}

export function mergeFeaturedSelection(current, library, selectedIds) {
  const selected = new Set(selectedIds.map(Number));
  const kept = current.filter((image) => selected.has(Number(image.id)));
  const keptIds = new Set(kept.map((image) => Number(image.id)));
  const added = library.filter((image) => (
    selected.has(Number(image.id))
    && image.featuredEligibility?.eligible === true
    && !keptIds.has(Number(image.id))
  ));

  return [...kept, ...added];
}

export function createSiteSettingsController({
  root,
  client,
  dialogs,
  notifier,
  onBusyChange,
}) {
  const elements = {
    issueName: root.querySelector("#site-issue-name"),
    heroCopy: root.querySelector("#site-hero-copy"),
    status: root.querySelector("#site-status"),
    list: root.querySelector("#site-featured-list"),
    add: root.querySelector("#site-add-featured"),
    save: root.querySelector("#site-save"),
  };

  let server = {
    issueName: "图集",
    heroCopy: "",
    featuredImages: [],
  };
  let draft = {
    issueName: "图集",
    heroCopy: "",
    featuredImages: [],
  };
  let busy = false;
  let bound = false;

  function setBusy(next) {
    busy = next;
    elements.add.disabled = next;
    elements.save.disabled = next || !isDirty();
    onBusyChange?.(next);
  }

  function isDirty() {
    if (draft.issueName !== server.issueName) return true;
    if (draft.heroCopy !== server.heroCopy) return true;
    const draftIds = draft.featuredImages.map((image) => image.id).join(",");
    const serverIds = server.featuredImages.map((image) => image.id).join(",");
    return draftIds !== serverIds;
  }

  function updateStatus() {
    elements.status.textContent = isDirty()
      ? "站点设置已修改，保存后生效。"
      : `当前精选 ${draft.featuredImages.length} 张。`;
    elements.save.disabled = busy || !isDirty();
  }

  function renderFeatured() {
    if (!draft.featuredImages.length) {
      elements.list.innerHTML = `<div class="admin-empty">还没有精选图片。点击“从图片库添加”开始选择。</div>`;
      updateStatus();
      return;
    }

    elements.list.innerHTML = draft.featuredImages
      .map((image, index) => renderFeaturedItem(image, index, draft.featuredImages.length))
      .join("");
    updateStatus();
  }

  function applyPayload(payload) {
    server = {
      issueName: payload.issueName || "图集",
      heroCopy: payload.heroCopy || "",
      featuredImages: Array.isArray(payload.featuredImages) ? payload.featuredImages : [],
    };
    draft = {
      issueName: server.issueName,
      heroCopy: server.heroCopy,
      featuredImages: [...server.featuredImages],
    };
    elements.issueName.value = draft.issueName;
    elements.heroCopy.value = draft.heroCopy;
    renderFeatured();
  }

  async function load() {
    const payload = await client.request("/api/admin/site");
    applyPayload(payload);
  }

  function moveFeatured(imageId, offset) {
    const items = [...draft.featuredImages];
    const index = items.findIndex((image) => Number(image.id) === Number(imageId));
    const target = index + offset;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    draft.featuredImages = items;
    renderFeatured();
  }

  function removeFeatured(imageId) {
    draft.featuredImages = draft.featuredImages.filter((image) => Number(image.id) !== Number(imageId));
    renderFeatured();
  }

  async function openPicker() {
    setBusy(true);
    try {
      const { images = [] } = await client.request("/api/admin/images");
      const selected = new Set(draft.featuredImages.map((image) => Number(image.id)));
      const currentIds = new Set(draft.featuredImages.map((image) => Number(image.id)));
      const eligibleIds = new Set(images
        .filter((image) => image.featuredEligibility?.eligible === true)
        .map((image) => Number(image.id)));
      const body = document.createElement("div");
      body.className = "site-picker";
      body.innerHTML = `
        <p class="site-picker-rule">仅精确 16:9 且至少 1920×1080 可加入轮播。当前已选但不合规的旧图片需在当前精选列表中移除。</p>
        <div class="site-picker-grid">
          ${images.map((image) => renderFeaturedPickerCard(
            image,
            selected.has(Number(image.id)),
          )).join("")}
        </div>
      `;

      const confirmed = await dialogs.open({
        title: "选择精选图片",
        body,
        confirmLabel: "加入精选",
        valueReader: () => true,
      });

      if (!confirmed) {
        return;
      }

      const chosenIds = [...body.querySelectorAll("input[type=checkbox]:checked")]
        .map((input) => Number(input.value))
        .filter((imageId) => currentIds.has(imageId) || eligibleIds.has(imageId));
      draft.featuredImages = mergeFeaturedSelection(draft.featuredImages, images, chosenIds);
      renderFeatured();
    } catch (error) {
      notifier.error(error?.message || "加载图片失败");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const issueName = elements.issueName.value.trim();
    const heroCopy = elements.heroCopy.value.trim();
    if (!issueName || !heroCopy) {
      notifier.error("本期名字和大屏文案都不能为空。");
      return;
    }

    setBusy(true);
    try {
      const payload = await client.request("/api/admin/site", {
        method: "PATCH",
        body: JSON.stringify({
          issueName,
          heroCopy,
          featuredImageIds: draft.featuredImages.map((image) => image.id),
        }),
      });
      applyPayload(payload);
      notifier.success("站点设置已保存");
    } catch (error) {
      notifier.error(error?.message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    elements.issueName.addEventListener("input", () => {
      draft.issueName = elements.issueName.value.trim();
      updateStatus();
    });
    elements.heroCopy.addEventListener("input", () => {
      draft.heroCopy = elements.heroCopy.value.trim();
      updateStatus();
    });
    elements.add.addEventListener("click", () => {
      if (!busy) openPicker();
    });
    elements.save.addEventListener("click", () => {
      if (!busy) save();
    });
    elements.list.addEventListener("click", (event) => {
      if (busy) return;
      const action = event.target.closest("[data-action]")?.dataset.action;
      const row = event.target.closest("[data-featured-id]");
      if (!action || !row) return;
      const imageId = Number(row.dataset.featuredId);
      if (action === "move-up") moveFeatured(imageId, -1);
      if (action === "move-down") moveFeatured(imageId, 1);
      if (action === "remove") removeFeatured(imageId);
    });
  }

  return {
    load,
    bind,
    isDirty,
  };
}
