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

const RESOLUTION_TIERS = new Set(["4k", "2k", "1k"]);
const TIER_LABELS = {
  "4k": "4K",
  "2k": "2K",
  "1k": "HD+ / 900p+",
};
const PICKER_FILTERS = [
  { value: "all", label: "全部可用" },
  { value: "4k", label: "4K" },
  { value: "2k", label: "2K" },
  { value: "1k", label: "HD+ / 900p+" },
];

function featuredDisplay(image) {
  const eligibility = image.featuredEligibility && typeof image.featuredEligibility === "object"
    ? image.featuredEligibility
    : {};
  const eligible = eligibility.eligible === true;
  const dimensions = labelText(eligibility.dimensions, "尺寸未知");
  const status = eligible
    ? labelText(eligibility.statusLabel, "状态未知")
    : labelText(eligibility.reason || eligibility.statusLabel, "状态未知");
  const resolutionTier = RESOLUTION_TIERS.has(eligibility.resolutionTier)
    ? eligibility.resolutionTier
    : null;
  const quality = labelText(eligibility.qualityLabel, TIER_LABELS[resolutionTier] ?? "");

  return {
    dimensions,
    eligible,
    is4K: eligibility.is4K === true,
    quality,
    resolutionTier,
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
  if (!display.eligible || !display.resolutionTier) {
    return "";
  }

  const checked = selected ? " checked" : "";
  const fileName = escapeHtml(image.fileName || "未命名");

  return `<label class="site-picker-card is-${display.resolutionTier}">
              <input type="checkbox" value="${escapeHtml(image.id)}"${checked} />
              <img src="${escapeHtml(image.fileUrl || "")}" alt="${fileName}" loading="lazy" />
              <span class="site-picker-name" title="${fileName}">${fileName}</span>
              <span class="site-picker-meta">
                <span class="site-eligibility-dimensions">${escapeHtml(display.dimensions)}</span>
                <span class="site-eligibility-quality">${escapeHtml(display.quality)}</span>
              </span>
            </label>`;
}

export function filterFeaturedCandidates(images, tier = "all") {
  const normalizedTier = RESOLUTION_TIERS.has(tier) ? tier : "all";
  return (Array.isArray(images) ? images : []).filter((image) => {
    const eligibility = image?.featuredEligibility;
    if (
      eligibility?.eligible !== true
      || !RESOLUTION_TIERS.has(eligibility.resolutionTier)
    ) {
      return false;
    }
    return normalizedTier === "all" || eligibility.resolutionTier === normalizedTier;
  });
}

export function mergeFeaturedSelection(current, library, selectedIds) {
  const selected = new Set(selectedIds.map(Number));
  const candidates = filterFeaturedCandidates(library);
  const candidateIds = new Set(candidates.map((image) => Number(image.id)));
  const kept = current.filter((image) => (
    !candidateIds.has(Number(image.id)) || selected.has(Number(image.id))
  ));
  const keptIds = new Set(kept.map((image) => Number(image.id)));
  const added = candidates.filter((image) => (
    selected.has(Number(image.id))
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
  let ready = false;
  let bound = false;

  function updateAvailability() {
    const locked = busy || !ready;
    elements.issueName.disabled = locked;
    elements.heroCopy.disabled = locked;
    elements.add.disabled = locked;
    elements.save.disabled = locked || !isDirty();
  }

  function setBusy(next) {
    busy = next;
    updateAvailability();
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
      ? "精选设置已修改，保存后生效。"
      : `当前精选 ${draft.featuredImages.length} 张。`;
    elements.save.disabled = busy || !ready || !isDirty();
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
    ready = false;
    setBusy(true);
    try {
      const payload = await client.request("/api/admin/site");
      applyPayload(payload);
      ready = true;
    } finally {
      setBusy(false);
    }
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
    if (!ready) return;
    setBusy(true);
    try {
      const { images = [] } = await client.request("/api/admin/images");
      const candidateImages = filterFeaturedCandidates(images);
      const candidateIds = new Set(candidateImages.map((image) => Number(image.id)));
      const selectedCandidateIds = new Set(
        draft.featuredImages
          .map((image) => Number(image.id))
          .filter((imageId) => candidateIds.has(imageId)),
      );
      const body = document.createElement("div");
      body.className = "site-picker";
      body.innerHTML = `
        <p class="site-picker-rule">接近 16:9（误差不超过 0.5%）且至少 1600×900 可加入轮播。当前已选但不合规的旧图片需在当前精选列表中移除。</p>
        <div class="site-picker-filters" role="group" aria-label="轮播候选分辨率">
          ${PICKER_FILTERS.map(({ value, label }) => `
            <button class="site-picker-filter${value === "all" ? " is-active" : ""}" type="button" data-picker-tier="${value}" aria-pressed="${value === "all"}">
              <span>${label}</span>
              <span class="site-picker-filter-count">${filterFeaturedCandidates(candidateImages, value).length}</span>
            </button>
          `).join("")}
        </div>
        <div class="site-picker-grid" aria-live="polite"></div>
      `;

      const grid = body.querySelector(".site-picker-grid");
      let activeTier = "all";

      function renderCandidates() {
        for (const button of body.querySelectorAll("[data-picker-tier]")) {
          const active = button.dataset.pickerTier === activeTier;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        }

        const visibleCandidates = filterFeaturedCandidates(candidateImages, activeTier);
        grid.innerHTML = visibleCandidates.length
          ? visibleCandidates.map((image) => renderFeaturedPickerCard(
              image,
              selectedCandidateIds.has(Number(image.id)),
            )).join("")
          : `<div class="site-picker-empty">当前档位没有可用图片。</div>`;
      }

      body.addEventListener("change", (event) => {
        const input = event.target.closest('.site-picker-card input[type="checkbox"]');
        if (!input) return;
        const imageId = Number(input.value);
        if (input.checked) selectedCandidateIds.add(imageId);
        else selectedCandidateIds.delete(imageId);
      });
      body.addEventListener("click", (event) => {
        const filter = event.target.closest("[data-picker-tier]");
        if (!filter) return;
        activeTier = filter.dataset.pickerTier;
        renderCandidates();
      });
      renderCandidates();

      const confirmed = await dialogs.open({
        title: "选择精选图片",
        body,
        confirmLabel: "加入精选",
        valueReader: () => true,
      });

      if (!confirmed) {
        return;
      }

      draft.featuredImages = mergeFeaturedSelection(
        draft.featuredImages,
        candidateImages,
        [...selectedCandidateIds],
      );
      renderFeatured();
    } catch (error) {
      notifier.error(error?.message || "加载图片失败");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!ready) {
      notifier.error("精选设置尚未加载，请重新加载后再试。");
      return;
    }
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
      notifier.success("精选设置已保存");
    } catch (error) {
      notifier.error(error?.message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    updateAvailability();

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
