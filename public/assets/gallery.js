import { renderGalleryCards, renderTagChips } from "./templates.js";

const tagStrip = document.querySelector("#tag-strip");
const galleryGrid = document.querySelector("#gallery-grid");
const modal = document.querySelector("#image-modal");
const modalImage = document.querySelector("#modal-image");
const modalMeta = document.querySelector("#modal-meta");
const modalClose = document.querySelector("#modal-close");

let tags = [];
let activeSlug = null;
let images = [];

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }

  return payload;
}

function bindTagClicks() {
  tagStrip.querySelectorAll("[data-tag-slug]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeSlug = button.dataset.tagSlug;
      renderTags();
      await loadImages(activeSlug);
    });
  });
}

function bindImageClicks() {
  galleryGrid.querySelectorAll("[data-image-id]").forEach((card) => {
    card.querySelector("[data-action='open-image']").addEventListener("click", () => {
      const image = images.find((item) => String(item.id) === card.dataset.imageId);
      if (!image) {
        return;
      }

      modalImage.src = image.fileUrl;
      modalImage.alt = image.fileName;
      modalMeta.textContent = `${image.fileName} · ${(image.tags ?? []).join(" / ")}`;
      modal.classList.remove("hidden");
    });
  });
}

function renderTags() {
  tagStrip.innerHTML = renderTagChips(tags, activeSlug);
  bindTagClicks();
}

function renderImages() {
  galleryGrid.innerHTML = images.length
    ? renderGalleryCards(images)
    : `<div class="panel">当前标签下还没有图片。</div>`;
  bindImageClicks();
}

async function loadImages(tagSlug) {
  const payload = await fetchJson(`/api/public/images?tag=${encodeURIComponent(tagSlug)}`);
  images = payload.images;
  renderImages();
}

async function bootstrap() {
  const payload = await fetchJson("/api/public/tags");
  tags = payload.tags;
  activeSlug = tags[0]?.slug ?? null;
  renderTags();

  if (activeSlug) {
    await loadImages(activeSlug);
  } else {
    renderImages();
  }
}

modalClose.addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    modal.classList.add("hidden");
  }
});

bootstrap().catch((error) => {
  galleryGrid.innerHTML = `<div class="panel">${error.message}</div>`;
});
