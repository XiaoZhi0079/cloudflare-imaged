import { renderAlbumCards, renderGalleryCards, renderTagChips } from "./templates.js";
import { fetchPublicJson, loadPublicBootstrapData } from "./public-data.js";
import { createHeroCarousel } from "./hero-carousel.js";

const siteHero = document.querySelector("#site-hero");
const tagStrip = document.querySelector("#tag-strip");
const galleryGrid = document.querySelector("#gallery-grid");
const albumList = document.querySelector("#album-list");
const modal = document.querySelector("#image-modal");
const modalImage = document.querySelector("#modal-image");
const modalTitle = document.querySelector("#modal-title");
const modalTags = document.querySelector("#modal-tags");
const modalClose = document.querySelector("#modal-close");
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
let activeSlug = null;
let images = [];
let featuredImages = [];
let heroCarousel = null;

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

      const tagText = (image.tags ?? []).filter(Boolean).join(" · ");
      const imageName = String(image.fileName ?? "").trim() || "未命名图片";
      modalImage.src = image.fileUrl;
      modalImage.alt = imageName;
      modalTitle.textContent = imageName;
      modalTags.textContent = tagText;
      modalTags.hidden = !tagText;
      modal.classList.remove("hidden");
    });
  });
}

function renderTags() {
  tagStrip.innerHTML = renderTagChips(tags, activeSlug);
  bindTagClicks();
}

function renderImages() {
  const hasImages = images.length > 0;
  galleryGrid.classList.toggle("is-empty", !hasImages);
  galleryGrid.innerHTML = hasImages
    ? renderGalleryCards(images)
    : `<div class="panel empty-state">这个标签下暂时还没有内容，换一个看看。</div>`;
  bindImageClicks();
}

function showFeatured(index) {
  if (!featuredImages.length) {
    return;
  }

  const normalizedIndex = ((Number(index) % featuredImages.length) + featuredImages.length)
    % featuredImages.length;
  const image = featuredImages[normalizedIndex];
  const label = String(image.fileName ?? "").trim() || "精彩图片";
  heroImage.src = image.fileUrl;
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

async function loadImages(tagSlug) {
  const payload = await fetchPublicJson(`/api/public/images?tag=${encodeURIComponent(tagSlug)}`);
  images = payload.images;
  renderImages();
}

async function bootstrap() {
  const { site, tags: loadedTags, albums } = await loadPublicBootstrapData();
  renderHero(site);
  albumList.innerHTML = albums.length ? renderAlbumCards(albums) : `<div class="panel empty-state">还没有公开图集。</div>`;
  tags = loadedTags;
  activeSlug = tags[0]?.slug ?? null;
  renderTags();

  if (activeSlug) {
    await loadImages(activeSlug);
  } else {
    renderImages();
  }
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

modalClose.addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    modal.classList.add("hidden");
  }
});

bootstrap().catch(() => {
  galleryGrid.classList.add("is-empty");
  galleryGrid.innerHTML = `<div class="panel empty-state">图集暂时打不开，请稍后再试。</div>`;
});
