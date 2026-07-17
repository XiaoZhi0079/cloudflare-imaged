import { fetchPublicJson } from "./public-data.js?v=20260717-centered-viewer-admin-modal";
import { renderGalleryCards } from "./templates.js?v=20260717-centered-viewer-admin-modal";

const title = document.querySelector("#album-title");
const description = document.querySelector("#album-description");
const count = document.querySelector("#album-count");
const gallery = document.querySelector("#album-gallery");
const modal = document.querySelector("#image-modal");
const modalImage = document.querySelector("#modal-image");
const modalTitle = document.querySelector("#modal-title");
const modalTags = document.querySelector("#modal-tags");
let images = [];

function closeModal() { modal.classList.add("hidden"); modalImage.removeAttribute("src"); }
function bindImages() {
  gallery.querySelectorAll("[data-image-id]").forEach((card) => card.querySelector("[data-action='open-image']").addEventListener("click", () => {
    const image = images.find((item) => String(item.id) === card.dataset.imageId); if (!image) return;
    const name = String(image.fileName ?? "").trim() || "未命名图片";
    modalImage.src = image.fileUrl; modalImage.alt = name; modalTitle.textContent = name;
    modalTags.textContent = (image.tags ?? []).join(" · "); modalTags.hidden = !modalTags.textContent;
    modal.classList.remove("hidden");
  }));
}

async function bootstrap() {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) throw new Error("missing slug");
  const payload = await fetchPublicJson(`/api/public/albums?slug=${encodeURIComponent(slug)}`);
  const album = payload.album; images = album.images ?? [];
  title.textContent = album.name; description.textContent = album.description || ""; count.textContent = `${album.imageCount} 张`;
  gallery.innerHTML = images.length ? renderGalleryCards(images) : `<div class="panel empty-state">这个图集还没有图片。</div>`;
  bindImages();
}

document.querySelector("#modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
bootstrap().catch(() => { title.textContent = "图集暂时打不开"; description.textContent = "请稍后再试。"; gallery.innerHTML = ""; });
