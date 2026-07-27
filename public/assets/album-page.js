import { fetchPublicJson } from "./public-data.js?v=20260728-image-delivery";
import { renderGalleryCards } from "./templates.js?v=20260728-image-delivery";
import { createImageViewer } from "./image-viewer.js?v=20260728-image-delivery";
import { createProgressiveGallery } from "./progressive-gallery.js?v=20260728-image-delivery";

const title = document.querySelector("#album-title");
const description = document.querySelector("#album-description");
const count = document.querySelector("#album-count");
const gallery = document.querySelector("#album-gallery");
const galleryLoadMore = document.querySelector("#gallery-load-more");
let images = [];

const viewer = createImageViewer({
  elements: {
    modal: document.querySelector("#image-modal"),
    image: document.querySelector("#modal-image"),
    title: document.querySelector("#modal-title"),
    tags: document.querySelector("#modal-tags"),
    close: document.querySelector("#modal-close"),
    previous: document.querySelector("#modal-prev"),
    next: document.querySelector("#modal-next"),
    counter: document.querySelector("#modal-counter"),
    stage: document.querySelector(".modal-stage"),
  },
  getImages: () => images,
});
const progressiveGallery = createProgressiveGallery({
  root: gallery,
  loadMoreButton: galleryLoadMore,
  renderCards: renderGalleryCards,
  bindCards: (root) => viewer.bindCards(root),
});

async function bootstrap() {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) throw new Error("missing slug");

  const payload = await fetchPublicJson(`/api/public/albums?slug=${encodeURIComponent(slug)}`);
  const album = payload.album;
  images = album.images ?? [];
  title.textContent = album.name;
  description.textContent = album.description || "";
  count.textContent = `${album.imageCount} 张`;
  progressiveGallery.setItems(images, {
    emptyMarkup: `<div class="panel empty-state">这个图集还没有图片。</div>`,
  });
  viewer.syncFromUrl();
}

bootstrap().catch(() => {
  title.textContent = "图集暂时打不开";
  description.textContent = "请稍后再试。";
  gallery.innerHTML = "";
});
