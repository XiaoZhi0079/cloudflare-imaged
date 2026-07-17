import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { renderAlbumCards, renderGalleryCards, renderTagChips } from "../src/shared/templates.js";

test("public renderers keep gallery behavior", () => {
  const chips = renderTagChips([{ name: "人像", slug: "portrait" }], "portrait");
  const cards = renderGalleryCards([{ id: 1, fileName: "private-name.webp", fileUrl: "/file/object-42", width: 1920, height: 1080, tags: ["人像"], category: { name: "Portrait" } }]);
  assert.match(chips, /tag-chip active/);
  assert.match(cards, /loading="lazy"/);
  assert.match(cards, /gallery-hover-meta/);
  assert.match(cards, /人像/);
  assert.match(cards, /private-name\.webp/);
  assert.match(cards, /card-title/);
  assert.doesNotMatch(cards, /Portrait/);
  assert.match(cards, /\/file\/object-42/);
  assert.match(cards, /srcset="\/img\/object-42\?w=320 320w,[^"]*\/img\/object-42\?w=960 960w"/);
  assert.match(cards, /sizes="[^"]+306px"/);
  assert.doesNotMatch(cards, /width="1920" height="1080"/);
  assert.match(cards, /decoding="async"/);
  assert.doesNotMatch(cards, /未分配标签/);
});

test("public album cards expose name description count and detail link", () => {
  const html = renderAlbumCards([{ name: "城市", slug: "city", description: "夜色与街道", imageCount: 3, coverImage: { fileUrl: "/file/cover", fileName: "cover.webp", width: 3840, height: 2160 } }]);
  assert.match(html, /城市/);
  assert.match(html, /夜色与街道/);
  assert.match(html, /3 张/);
  assert.match(html, /album\.html\?slug=city/);
  assert.match(html, /srcset="\/img\/cover\?w=480 480w,[^"]*\/img\/cover\?w=1280 1280w"/);
  assert.match(html, /width="3840" height="2160"/);
});

test("public gallery copy stays light-branded", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");
  const publicData = readFileSync(new URL("../public/assets/public-data.js", import.meta.url), "utf8");
  assert.match(html, /id="site-hero"/);
  assert.match(html, /class="public-nav"/);
  assert.match(html, /id="album-list"/);
  assert.match(html, /收藏你的视觉灵感/);
  assert.match(html, /id="hero-stage"/);
  assert.match(html, /id="hero-copy"/);
  assert.match(html, /id="hero-issue"/);
  assert.match(html, /id="hero-pause"[^>]*aria-pressed="false"/);
  assert.match(html, /id="modal-title"/);
  assert.match(html, /id="modal-tags"/);
  assert.match(html, /收藏偶然落下的光，也收藏那些无法复刻的瞬间。愿每一次凝望，都能重新听见当时的心跳。/);
  assert.doesNotMatch(html, /让光影在图集中成章，让细节在标签间相遇/);
  assert.match(html, /<nav><a href="#albums">图集<\/a><a href="#browse">标签<\/a><\/nav>/);
  assert.doesNotMatch(html, /href="\/admin\/"|标签浏览|浏览图集|按标签浏览/);
  assert.match(html, /<p class="eyebrow">Albums<\/p>/i);
  assert.match(html, /<p class="eyebrow">Browse<\/p>/i);
  assert.doesNotMatch(html, /快速查看整理好的图片内容/);
  assert.match(gallery, /const sitePromise = fetchPublicJson\("\/api\/public\/site"/);
  assert.match(gallery, /const tagsPayload = await fetchPublicJson\("\/api\/public\/tags"/);
  assert.match(gallery, /imagesPromise = loadImages\(activeSlug\)/);
  assert.doesNotMatch(gallery, /loadPublicBootstrapData/);
  assert.match(gallery, /createHeroCarousel/);
  assert.match(gallery, /setPauseReason\("hover"/);
  assert.match(gallery, /prefers-reduced-motion/);
  assert.match(gallery, /visibilitychange/);
  assert.doesNotMatch(gallery, /const \[sitePayload, tagsPayload\] = await Promise\.all/);
  assert.match(publicData, /\/api\/public\/site/);
  assert.match(gallery, /这个标签下暂时还没有内容/);
  assert.match(gallery, /图集暂时打不开/);
  assert.match(gallery, /image\.fileName/);
  assert.doesNotMatch(gallery, /error\.message/);
});

test("public image viewer centers the image with transparent in-image metadata", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const album = readFileSync(new URL("../public/album.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");

  for (const html of [index, album]) {
    assert.match(
      html,
      /<div class="modal-stage">[\s\S]*?<img id="modal-image"[^>]*\/>[\s\S]*?<div class="modal-meta">/,
    );
  }
  const modalBlock = css.match(/\.modal\s*\{([^}]*)\}/s)?.[1];
  assert.ok(modalBlock, "the modal style block must exist");
  assert.match(modalBlock, /display:\s*grid/);
  assert.match(modalBlock, /place-items:\s*center/);
  assert.match(modalBlock, /z-index:\s*100/);
  assert.match(css, /\.modal-stage\s*\{[^}]*position:\s*relative;[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
  assert.match(css, /\.modal-stage img\s*\{[^}]*max-width:[^}]*max-height:[^}]*object-fit:\s*contain;/s);
  assert.match(
    css,
    /\.modal-meta\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*auto 0 0;[^}]*background:\s*transparent;[^}]*text-shadow:/s,
  );
  assert.doesNotMatch(
    css,
    /\.public-nav nav a:last-child\s*\{[^}]*display:\s*none/,
    "the mobile layout must keep the Tags navigation link visible",
  );
});

test("public pages share one immersive viewer with navigation and URL state", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const album = readFileSync(new URL("../public/album.html", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");
  const albumPage = readFileSync(new URL("../public/assets/album-page.js", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../public/assets/image-viewer.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");

  for (const html of [index, album]) {
    assert.match(html, /id="image-modal"[^>]*aria-labelledby="modal-title"[^>]*aria-describedby="modal-tags"/);
    assert.match(html, /id="modal-prev"[^>]*aria-label="上一张"/);
    assert.match(html, /id="modal-next"[^>]*aria-label="下一张"/);
    assert.match(html, /id="modal-counter"/);
  }
  for (const source of [gallery, albumPage]) {
    assert.match(source, /createImageViewer/);
    assert.match(source, /viewer\.bindCards/);
    assert.match(source, /viewer\.syncFromUrl/);
    assert.doesNotMatch(source, /modalImage\.src|modal\.classList\.(?:add|remove)/);
  }
  assert.match(gallery, /searchParams\.get\("tag"\)/);
  assert.match(gallery, /searchParams\.set\("tag"/);
  assert.match(gallery, /searchParams\.delete\("image"\)/);
  assert.match(gallery, /history\.replaceState/);
  assert.match(viewer, /addEventListener\("popstate"/);
  assert.match(viewer, /addEventListener\("keydown"/);
  assert.match(viewer, /addEventListener\("touchstart"/);
  assert.match(css, /html\.viewer-open\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.modal-nav\s*\{/);
  assert.match(css, /\.modal-counter\s*\{/);
});

test("gallery cards explicitly preserve their natural image height", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  assert.match(css, /\.gallery-card img\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/s);
});

test("featured management page becomes multi-album management", () => {
  const pageUrl = new URL("../public/admin/featured.html", import.meta.url);
  assert.equal(existsSync(pageUrl), true, "featured management page must exist");
  const html = readFileSync(pageUrl, "utf8");
  for (const id of [
    "album-panel", "album-list", "album-name", "album-description",
    "album-cover", "album-is-home", "album-members", "album-create",
    "album-add-images", "album-save", "album-delete", "featured-retry",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, />图集管理</);
  assert.match(html, />保存图集</);
  assert.match(html, /id="featured-retry"[^>]*hidden/);
  assert.doesNotMatch(html, /data-settings-tab|taxonomy-list|taxonomy-create/);
});

test("all admin pages use the shared authentication gate", () => {
  for (const path of [
    "../public/admin/index.html",
    "../public/admin/featured.html",
    "../public/admin/settings.html",
  ]) {
    const html = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(html, /id="admin-auth-view"[^>]*hidden/);
    assert.match(html, /id="admin-app"[^>]*hidden/);
    assert.match(html, /id="admin-key"/);
    assert.match(html, /id="admin-login"/);
    assert.match(html, /data-admin-logout/);
    assert.match(html, /href="\/admin\/"/);
    assert.match(html, /href="\/admin\/featured\.html"/);
    assert.match(html, /href="\/admin\/settings\.html"/);
    assert.match(html, /\/assets\/admin\/admin\.css/);
  }
});

test("admin pages load page-specific modules and styles", () => {
  const library = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const featured = readFileSync(new URL("../public/admin/featured.html", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(library, /\/assets\/admin\/workbench\.css/);
  assert.match(library, /\/assets\/admin\/library-page\.js/);
  assert.match(featured, /\/assets\/admin\/settings\.css/);
  assert.match(featured, /\/assets\/admin\/featured-page\.js/);
  assert.match(settings, /\/assets\/admin\/settings\.css/);
  assert.match(settings, /\/assets\/admin\/settings-page\.js/);
});

test("labels and categories page excludes featured management", () => {
  const html = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(html, /<h1>标签与分类<\/h1>/);
  assert.match(html, /data-settings-tab="tags"/);
  assert.match(html, /data-settings-tab="categories"/);
  assert.doesNotMatch(html, /data-settings-tab="site"|id="site-panel"/);
  assert.doesNotMatch(html, /site-issue-name|site-hero-copy|site-featured-list/);
});

test("taxonomy entry has no featured or site mode", () => {
  const source = readFileSync(new URL("../public/assets/admin/settings-page.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /site-settings\.js|createSiteSettingsController/);
  assert.doesNotMatch(source, /isSiteTab|ensureSiteController|sitePanel|siteController/);
  assert.doesNotMatch(source, /\/api\/admin\/site|\/api\/admin\/images/);
  assert.match(source, /activeType === "tags" \? "新增标签" : "新增主分类"/);
});

test("image workbench exposes filtering details upload and bulk controls", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  for (const id of [
    "admin-search", "admin-sort", "admin-density", "tag-filter-list",
    "image-list", "admin-load-more", "admin-upload-open", "admin-upload-dialog",
    "admin-detail-overlay", "admin-bulk-toolbar", "bulk-assign-tags",
    "bulk-assign-category", "bulk-delete", "admin-dialog-host", "admin-toast-host",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /admin-tag-manager/);
  assert.doesNotMatch(html, /id="category-filter-list"/);
  assert.doesNotMatch(html, /<h3>主分类<\/h3>/);
});

test("image workbench keeps carousel eligibility filters out of the library", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /name="featured-filter"/);
  assert.doesNotMatch(html, /id="featured-filter-heading"/);
  assert.doesNotMatch(html, />轮播规格</);
});

test("image workbench renders only real filters with visible multi-select state", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  assert.match(html, /id="tag-filter-selected-count"/);
  assert.doesNotMatch(controller, /name: "全部图片"/);
  assert.match(controller, /filter-tag-option/);
  assert.match(controller, /is-selected/);
  assert.doesNotMatch(controller, /categoryFilters/);
});

test("runtime public templates stay aligned with shared templates", () => {
  const runtime = readFileSync(new URL("../public/assets/templates.js", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/templates.js", import.meta.url), "utf8");
  assert.equal(runtime, shared);
  const runtimeVariants = readFileSync(new URL("../public/assets/image-variants.js", import.meta.url), "utf8");
  const sharedVariants = readFileSync(new URL("../src/shared/image-variants.js", import.meta.url), "utf8");
  assert.equal(runtimeVariants, sharedVariants);
  assert.match(runtime, /image-variants\.js\?v=20260717-gallery-list-fix/);
});

test("legacy admin pages and scripts are removed", () => {
  for (const path of [
    "../public/admin/upload.html", "../public/admin/images.html", "../public/admin/tags.html",
    "../public/assets/admin.js", "../public/assets/admin-categories.js",
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});

test("public assets contain only public gallery concerns", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../public/assets/templates.js", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/templates.js", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.admin-/);
  for (const source of [runtime, shared]) {
    assert.deepEqual([...source.matchAll(/export function (\w+)/g)].map((match) => match[1]), ["renderTagChips", "renderAlbumCards", "renderGalleryCards"]);
  }
});

test("album detail page has safe public browsing contracts", () => {
  const html = readFileSync(new URL("../public/album.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../public/assets/album-page.js", import.meta.url), "utf8");
  assert.match(html, /id="album-title"/);
  assert.match(html, /id="album-gallery"/);
  assert.match(source, /\/api\/public\/albums\?slug=/);
  assert.match(source, /图集暂时打不开/);
  assert.match(source, /renderGalleryCards/);
});

test("single-image hero controls have an explicit hidden override", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  assert.match(css, /\.hero-controls\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test("featured hero copy overlays the image without an opaque panel", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");

  assert.match(gallery, /siteHero\.classList\.toggle\("has-featured", count > 0\)/);
  assert.match(
    css,
    /\.hero-featured\.has-featured\s*\{[^}]*position:\s*relative/,
  );
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-meta\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*72px[^}]*background:\s*transparent[^}]*pointer-events:\s*none/,
  );
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-copy\s*\{[^}]*color:\s*#fff[^}]*text-shadow:/,
  );
});

test("mobile featured hero copy stays in document flow", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const mobileMedia = css.match(
    /@media \(max-width:\s*720px\)\s*\{([\s\S]*?)\r?\n\}\s*@media \(max-width:\s*480px\)/,
  )?.[1];
  assert.ok(mobileMedia, "the 720px responsive media block must exist");

  const mobileHeroMeta = mobileMedia.match(
    /\.hero-featured\.has-featured \.hero-meta\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(mobileHeroMeta, "the mobile featured hero meta override must exist");
  assert.match(mobileHeroMeta, /position:\s*static/);
  assert.match(mobileHeroMeta, /padding:\s*16px 18px 18px/);
  assert.match(mobileHeroMeta, /background:\s*transparent/);
  assert.match(mobileHeroMeta, /pointer-events:\s*none/);
  assert.doesNotMatch(mobileHeroMeta, /bottom\s*:/);
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-meta\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*72px/,
  );
});

test("featured hero uses a fixed responsive 16:9 stage", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(
    css,
    /\.hero-stage\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;[^}]*min-height:\s*0;/,
  );
  assert.match(
    css,
    /\.hero-image\s*\{[^}]*height:\s*100%;[^}]*object-fit:\s*contain;[^}]*object-position:\s*center;/,
  );
  for (const viewportHeightRule of [
    /(?:^|\r?\n)\s*height:\s*min\(52vh,\s*520px\);?/m,
    /(?:^|\r?\n)\s*min-height:\s*min\(52vh,\s*520px\);?/m,
    /(?:^|\r?\n)\s*height:\s*min\(42vh,\s*360px\);?/m,
    /(?:^|\r?\n)\s*min-height:\s*min\(42vh,\s*360px\);?/m,
  ]) {
    assert.doesNotMatch(css, viewportHeightRule);
  }
  assert.match(index, /main\.css\?v=20260717-gallery-list-fix/);
  assert.match(index, /gallery\.js\?v=20260717-gallery-list-fix/);
});

test("public entry assets share one cache-busting release version", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");
  const albumPage = readFileSync(new URL("../public/assets/album-page.js", import.meta.url), "utf8");
  const cssVersion = index.match(/href="\/assets\/main\.css\?v=([^"]+)"/);
  const scriptVersion = index.match(/src="\/assets\/gallery\.js\?v=([^"]+)"/);

  assert.ok(cssVersion, "main.css must include a non-empty release version");
  assert.ok(scriptVersion, "gallery.js must include a non-empty release version");
  assert.equal(cssVersion[1], scriptVersion[1]);
  for (const source of [gallery, albumPage]) {
    assert.match(source, /templates\.js\?v=20260717-gallery-list-fix/);
    assert.match(source, /public-data\.js\?v=20260717-gallery-list-fix/);
    assert.match(source, /image-viewer\.js\?v=20260717-gallery-list-fix/);
  }
  assert.match(gallery, /image-variants\.js\?v=20260717-gallery-list-fix/);
  const viewer = readFileSync(new URL("../public/assets/image-viewer.js", import.meta.url), "utf8");
  assert.match(viewer, /image-variants\.js\?v=20260717-gallery-list-fix/);
});

test("hero and immersive viewer apply responsive Cloudflare variants", () => {
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../public/assets/image-viewer.js", import.meta.url), "utf8");
  assert.match(gallery, /applyResponsiveImageAttributes\(heroImage, image, "hero"\)/);
  assert.doesNotMatch(gallery, /heroImage\.src\s*=\s*image\.fileUrl/);
  assert.match(viewer, /applyResponsiveImageAttributes\(image, current, "viewer"\)/);
  assert.match(viewer, /applyResponsiveImageAttributes\(preloadImage, adjacent, "viewer"\)/);
  assert.match(viewer, /removeAttribute\("srcset"\)/);
  assert.match(viewer, /removeAttribute\("sizes"\)/);
});

test("changed admin assets use targeted cache-busting versions", () => {
  const libraryHtml = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const libraryEntry = readFileSync(
    new URL("../public/assets/admin/library-page.js", import.meta.url),
    "utf8",
  );
  const settingsHtml = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  const featuredHtml = readFileSync(new URL("../public/admin/featured.html", import.meta.url), "utf8");
  const featuredEntry = readFileSync(
    new URL("../public/assets/admin/featured-page.js", import.meta.url),
    "utf8",
  );
  const filterSeparationVersion = "20260715-featured-filter-separation";
  const unchangedReferences = [
    [libraryEntry, /from "\.\/library-state\.js\?v=([^"]+)"/, "library-state.js"],
    [libraryEntry, /from "\.\/renderers\/image-card\.js\?v=([^"]+)"/, "image-card.js"],
  ];
  const unchangedVersions = unchangedReferences.map(([source, pattern, asset]) => {
    const match = source.match(pattern);
    assert.ok(match, `${asset} must include a cache-busting release version`);
    return match[1];
  });
  assert.deepEqual(
    unchangedVersions,
    Array(unchangedReferences.length).fill(filterSeparationVersion),
  );

  const centeredModalVersion = "20260717-centered-viewer-admin-modal";
  const centeredModalReferences = [
    [libraryHtml, /href="\/assets\/admin\/admin\.css\?v=([^"]+)"/, "admin.css"],
    [settingsHtml, /href="\/assets\/admin\/admin\.css\?v=([^"]+)"/, "settings admin.css"],
    [featuredHtml, /href="\/assets\/admin\/admin\.css\?v=([^"]+)"/, "featured admin.css"],
    [libraryHtml, /href="\/assets\/admin\/workbench\.css\?v=([^"]+)"/, "workbench.css"],
    [libraryHtml, /src="\/assets\/admin\/library-page\.js\?v=([^"]+)"/, "library-page.js"],
  ];
  const centeredModalVersions = centeredModalReferences.map(([source, pattern, asset]) => {
    const match = source.match(pattern);
    assert.ok(match, `${asset} must include a cache-busting release version`);
    return match[1];
  });
  assert.deepEqual(
    centeredModalVersions,
    Array(centeredModalReferences.length).fill(centeredModalVersion),
  );

  const albumsRedesignVersion = "20260717-albums-gallery-redesign";
  const albumsRedesignReferences = [
    [settingsHtml, /href="\/assets\/admin\/settings\.css\?v=([^"]+)"/, "settings.css"],
    [featuredHtml, /href="\/assets\/admin\/settings\.css\?v=([^"]+)"/, "featured settings.css"],
  ];
  const albumsRedesignVersions = albumsRedesignReferences.map(([source, pattern, asset]) => {
    const match = source.match(pattern);
    assert.ok(match, `${asset} must include a cache-busting release version`);
    return match[1];
  });
  assert.deepEqual(
    albumsRedesignVersions,
    Array(albumsRedesignReferences.length).fill(albumsRedesignVersion),
  );

  const albumDraftVersion = "20260717-album-draft-persistence";
  const albumDraftReferences = [
    [featuredHtml, /src="\/assets\/admin\/featured-page\.js\?v=([^"]+)"/, "featured-page.js"],
    [featuredEntry, /from "\.\/album-management\.js\?v=([^"]+)"/, "album-management.js"],
  ];
  const albumDraftVersions = albumDraftReferences.map(([source, pattern, asset]) => {
    const match = source.match(pattern);
    assert.ok(match, `${asset} must include a cache-busting release version`);
    return match[1];
  });
  assert.deepEqual(
    albumDraftVersions,
    Array(albumDraftReferences.length).fill(albumDraftVersion),
  );

  const featuredNavigationVersion = "20260716-admin-featured-navigation";
  const navigationReferences = [
    [settingsHtml, /src="\/assets\/admin\/settings-page\.js\?v=([^"]+)"/, "settings-page.js"],
  ];
  const navigationVersions = navigationReferences.map(([source, pattern, asset]) => {
    const match = source.match(pattern);
    assert.ok(match, `${asset} must include a cache-busting release version`);
    return match[1];
  });
  assert.deepEqual(
    navigationVersions,
    Array(navigationReferences.length).fill(featuredNavigationVersion),
  );

});

test("admin controls expose static accessibility contracts", () => {
  const library = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  const dialogs = readFileSync(new URL("../public/assets/admin/dialogs.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../public/assets/admin/library-page.js", import.meta.url), "utf8");
  for (const html of [library, settings]) {
    assert.match(html, /data-toggle-password[^>]*aria-label="[^"]+"[^>]*title="[^"]+"/);
    assert.match(html, /admin-toast-host[^>]*aria-live="polite"/);
  }
  assert.match(library, /id="admin-detail-overlay"[^>]*class="admin-overlay admin-detail-overlay"[^>]*hidden/);
  assert.doesNotMatch(library, /admin-detail-drawer|admin-drawer/);
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(controller, /className: "admin-detail-dialog"/);
  assert.match(controller, /role: "dialog"/);
  assert.match(controller, /"aria-modal": "true"/);
  assert.match(controller, /"aria-labelledby": "detail-title"/);
  assert.match(controller, /createElement\("label"[^\n]*admin-field/);
  assert.match(controller, /type: "file"/);
});

test("filter rail preserves the search focus outline", () => {
  const css = readFileSync(new URL("../public/assets/admin/workbench.css", import.meta.url), "utf8");
  assert.match(css, /\.filter-rail \{[^}]*padding:4px 14px 4px 4px/);
  assert.match(css, /@media \(max-width:1099px\)[\s\S]*?\.filter-rail \{[^}]*overflow:visible/);
});
