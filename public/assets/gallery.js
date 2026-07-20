import { renderAlbumCards, renderGalleryCards, renderTagGroups } from "./templates.js?v=20260720-multilevel-tags";
import { DEFAULT_PUBLIC_SITE, fetchPublicJson } from "./public-data.js?v=20260720-multilevel-tags";
import { createImageViewer } from "./image-viewer.js?v=20260720-multilevel-tags";
import { applyResponsiveImageAttributes } from "./image-variants.js?v=20260720-multilevel-tags";
import { createHeroCarousel } from "./hero-carousel.js";

const siteHero = document.querySelector("#site-hero");
const tagStrip = document.querySelector("#tag-strip");
const galleryGrid = document.querySelector("#gallery-grid");
const albumList = document.querySelector("#album-list");
const heroStage = document.querySelector("#hero-stage");
const heroImage = document.querySelector("#hero-image");
const heroControls = document.querySelector("#hero-controls");
const heroDots = document.querySelector("#hero-dots");
const heroIssue = document.querySelector("#hero-issue");
const heroCopy = document.querySelector("#hero-copy");
const heroPrev = document.querySelector("#hero-prev");
const heroNext = document.querySelector("#hero-next");
const heroPause = document.querySelector("#hero-pause");
const reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

let tags = [];
let activeSlugs = new Set();
let tagGroups = [];
let images = [];
let featuredImages = [];
let heroCarousel = null;

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

function replaceTagUrl(slugs, { clearImage = false } = {}) {
  const url = new URL(location.href);
  url.searchParams.delete("tag");
  for (const slug of slugs) url.searchParams.append("tag", slug);
  if (clearImage) url.searchParams.delete("image");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function bindTagClicks() {
  tagStrip.querySelectorAll("[data-tag-slug]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slug = button.dataset.tagSlug;
      const next = new Set(activeSlugs);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      activeSlugs = next;
      replaceTagUrl(activeSlugs, { clearImage: true });
      renderTags();
      await loadImages(activeSlugs);
    });
  });
}

function renderTags() {
  tagStrip.innerHTML = renderTagGroups(tagGroups, activeSlugs);
  bindTagClicks();
}

function renderImages() {
  const hasImages = images.length > 0;
  galleryGrid.classList.toggle("is-empty", !hasImages);
  galleryGrid.innerHTML = hasImages
    ? renderGalleryCards(images)
    : `<div class="panel empty-state">这个标签下暂时还没有内容，换一个看看。</div>`;
  viewer.bindCards(galleryGrid);
}

function showFeatured(index) {
  if (!featuredImages.length) {
    return;
  }

  const normalizedIndex = ((Number(index) % featuredImages.length) + featuredImages.length)
    % featuredImages.length;
  const image = featuredImages[normalizedIndex];
  const label = String(image.fileName ?? "").trim() || "精彩图片";
  applyResponsiveImageAttributes(heroImage, image, "hero");
  heroImage.alt = label;

  heroDots.querySelectorAll("[data-hero-dot]").forEach((dot) => {
    const active = Number(dot.dataset.heroDot) === normalizedIndex;
    dot.classList.toggle("is-active", active);
    dot.setAttribute("aria-current", active ? "true" : "false");
  });
}

function renderHeroCarouselState(state) {
  if (!heroPause) return;
  heroPause.textContent = state.manualPaused ? "继续轮播" : "暂停轮播";
  heroPause.setAttribute("aria-pressed", String(state.manualPaused));
}

function renderHero(site) {
  const issueName = String(site?.issueName ?? "图集").trim() || "图集";
  const heroText = String(site?.heroCopy ?? "").trim();
  featuredImages = Array.isArray(site?.featuredImages) ? site.featuredImages : [];
  const count = featuredImages.length;
  siteHero.classList.toggle("has-featured", count > 0);

  heroIssue.textContent = count > 0 ? `${issueName} · 本期 ${count} 张` : issueName;
  heroCopy.textContent = heroText;
  heroCopy.hidden = !heroText;

  heroCarousel?.destroy();
  heroCarousel = null;

  if (!count) {
    heroStage.hidden = true;
    heroControls.hidden = true;
    heroDots.innerHTML = "";
    heroImage.removeAttribute("src");
    heroImage.removeAttribute("srcset");
    heroImage.removeAttribute("sizes");
    heroImage.removeAttribute("width");
    heroImage.removeAttribute("height");
    renderHeroCarouselState({ manualPaused: false });
    return;
  }

  heroStage.hidden = false;
  heroControls.hidden = count <= 1;
  heroDots.innerHTML = featuredImages
    .map((_, index) => `<button type="button" data-hero-dot="${index}" aria-label="切换到第 ${index + 1} 张"></button>`)
    .join("");

  heroDots.querySelectorAll("[data-hero-dot]").forEach((dot) => {
    dot.addEventListener("click", () => {
      heroCarousel?.select(Number(dot.dataset.heroDot));
    });
  });

  heroCarousel = createHeroCarousel({
    length: count,
    reducedMotion: Boolean(reducedMotionQuery?.matches),
    onIndexChange: showFeatured,
    onStateChange: renderHeroCarouselState,
  });
  heroCarousel.setPauseReason("hidden", document.hidden);
}

async function loadImages(tagSlugs) {
  if (!tagSlugs.size) {
    images = [];
    renderImages();
    viewer.syncFromUrl();
    return;
  }
  const params = new URLSearchParams();
  for (const slug of tagSlugs) params.append("tag", slug);
  const payload = await fetchPublicJson(`/api/public/images?${params.toString()}`);
  images = payload.images;
  renderImages();
  viewer.syncFromUrl();
}

async function bootstrap() {
  const sitePromise = fetchPublicJson("/api/public/site")
    .catch(() => ({ ...DEFAULT_PUBLIC_SITE, featuredImages: [] }));
  const albumsPromise = fetchPublicJson("/api/public/albums")
    .catch(() => ({ albums: [] }));
  const tagsPayload = await fetchPublicJson("/api/public/tags");
  tags = Array.isArray(tagsPayload?.tags) ? tagsPayload.tags : [];
  tagGroups = Array.isArray(tagsPayload?.tagGroups) ? tagsPayload.tagGroups : [];
  const requestedSlugs = new URL(location.href).searchParams.getAll("tag");
  const validSlugs = new Set(tags.map((tag) => tag.slug));
  activeSlugs = new Set(requestedSlugs.filter((slug) => validSlugs.has(slug)));
  if (!activeSlugs.size && tags[0]?.slug) activeSlugs = new Set([tags[0].slug]);
  if (requestedSlugs.length !== activeSlugs.size || requestedSlugs.some((slug) => !activeSlugs.has(slug))) {
    replaceTagUrl(activeSlugs);
  }
  renderTags();

  const contentPromise = Promise.all([sitePromise, albumsPromise]).then(([site, albumsPayload]) => {
    renderHero(site);
    const albums = Array.isArray(albumsPayload?.albums) ? albumsPayload.albums : [];
    albumList.innerHTML = albums.length
      ? renderAlbumCards(albums)
      : `<div class="panel empty-state">还没有公开图集。</div>`;
  });
  let imagesPromise;
  if (activeSlugs.size) {
    imagesPromise = loadImages(activeSlugs);
  } else {
    renderImages();
    viewer.syncFromUrl();
    imagesPromise = Promise.resolve();
  }
  await Promise.all([contentPromise, imagesPromise]);
}

heroPrev?.addEventListener("click", () => {
  heroCarousel?.previous();
});

heroNext?.addEventListener("click", () => {
  heroCarousel?.next();
});

heroPause?.addEventListener("click", () => {
  heroCarousel?.toggleManualPause();
});
heroStage?.addEventListener("mouseenter", () => {
  heroCarousel?.setPauseReason("hover", true);
});
heroStage?.addEventListener("mouseleave", () => {
  heroCarousel?.setPauseReason("hover", false);
});
siteHero?.addEventListener("focusin", () => {
  heroCarousel?.setPauseReason("focus", true);
});
siteHero?.addEventListener("focusout", (event) => {
  if (!siteHero.contains(event.relatedTarget)) {
    heroCarousel?.setPauseReason("focus", false);
  }
});
document.addEventListener("visibilitychange", () => {
  heroCarousel?.setPauseReason("hidden", document.hidden);
});
reducedMotionQuery?.addEventListener?.("change", (event) => {
  heroCarousel?.setReducedMotion(event.matches);
});

bootstrap().catch(() => {
  galleryGrid.classList.add("is-empty");
  galleryGrid.innerHTML = `<div class="panel empty-state">图集暂时打不开，请稍后再试。</div>`;
});
