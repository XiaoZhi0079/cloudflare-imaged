# Albums and Gallery Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-album system, modernize the public gallery from `参考.html`, fix public image titles, and replace the narrow admin image drawer with a responsive wide workspace.

**Architecture:** D1 gains `albums` and `album_images` as the new content source while preserving legacy featured tables for rollback. Repository methods own album invariants and APIs expose separate admin/public contracts. The public homepage, album detail page, admin album manager, and admin image workspace consume those contracts through focused ES modules.

**Tech Stack:** Cloudflare Pages Functions, D1/SQLite, JavaScript ES modules, static HTML/CSS, Node.js built-in test runner.

---

## Task 1: Add the album schema and migrate legacy featured data

**Files:**
- Create: `migrations/0002_albums.sql`
- Modify: `schema.sql`
- Modify: `tests/helpers/test-database.js`
- Modify: `tests/d1-migrations.test.js`

- [ ] Write failing migration tests that expect `albums`, `album_images`, their four indexes, and conversion of one legacy featured list into an `is_home = 1` album named from `site_settings`.
- [ ] Run `node --test tests/d1-migrations.test.js` and confirm failure because `0002_albums.sql` and album tables do not exist.
- [ ] Create `0002_albums.sql` with `CREATE TABLE IF NOT EXISTS albums`, `album_images`, indexes `idx_albums_order`, `idx_albums_home`, `idx_album_images_order`, `idx_album_images_image_id`, and idempotent migration SQL:

```sql
INSERT INTO albums (name, slug, description, is_home, sort_order)
SELECT
  COALESCE((SELECT value FROM site_settings WHERE key = 'issue_name'), '图集'),
  'home',
  COALESCE((SELECT value FROM site_settings WHERE key = 'hero_copy'), ''),
  1,
  1
WHERE NOT EXISTS (SELECT 1 FROM albums);

INSERT OR IGNORE INTO album_images (album_id, image_id, sort_order)
SELECT (SELECT id FROM albums WHERE is_home = 1 ORDER BY id LIMIT 1), image_id, sort_order
FROM featured_images;

UPDATE albums
SET cover_image_id = (
  SELECT image_id FROM album_images
  WHERE album_id = albums.id
  ORDER BY sort_order, image_id LIMIT 1
)
WHERE is_home = 1 AND cover_image_id IS NULL;
```

- [ ] Mirror the final objects in `schema.sql`; update the test helper to execute 0001 followed by 0002.
- [ ] Run the migration test and full schema/repository safety tests.
- [ ] Commit: `feat: add multi-album schema`.

## Task 2: Implement album repository invariants

**Files:**
- Modify: `src/server/gallery-repository.js`
- Create: `tests/albums-repository.test.js`

- [ ] Write failing tests for create/list/update/delete, ordered membership, one image in two albums, unique home album, cover fallback, unknown/duplicate image rejection, and image deletion cleanup.
- [ ] Run `node --test tests/albums-repository.test.js` and verify missing-method failures.
- [ ] Add helpers that normalize album names/descriptions, create stable unique slugs with `slugifyTagName`, validate positive unique image IDs, load album images with tags, and map snake_case rows to:

```js
{
  id, name, slug, description, sortOrder,
  isHome, coverImageId, imageCount, images
}
```

- [ ] Add `listAlbums`, `getAlbumById`, `getAlbumBySlug`, `createAlbum`, `updateAlbum`, and `deleteAlbum`. `updateAlbum` must batch metadata, home reset/set, membership replacement, and cover fallback atomically.
- [ ] Extend `deleteImage()` to remove album membership before deleting the image; foreign keys remain the second line of defense.
- [ ] Run focused and existing repository tests.
- [ ] Commit: `feat: add album repository operations`.

## Task 3: Add admin and public album APIs

**Files:**
- Create: `functions/api/admin/albums.js`
- Create: `functions/api/public/albums.js`
- Modify: `functions/api/admin/_shared.js`
- Modify: `functions/api/public/site.js`
- Create: `tests/albums-api.test.js`
- Modify: `tests/site-api.test.js`

- [ ] Write failing handler tests for admin authentication, POST/PATCH/DELETE validation, public summaries, public detail by slug, and home album Hero filtering.
- [ ] Run the tests and verify module-not-found/old-site-contract failures.
- [ ] Add `toApiAlbum()` and `toPublicAlbum()` serializers. Public albums include only name, slug, description, imageCount, cover image and safe ordered images; public images include `fileName` but not storage keys, notes, sync state or category.
- [ ] Implement `/api/admin/albums` with GET/POST/PATCH/DELETE and consistent 400/404/409 JSON errors.
- [ ] Implement `/api/public/albums`; without `slug`, return summaries, and with `slug`, return one album or 404.
- [ ] Change `/api/public/site` to read the home album and return only members where `classifyFeaturedImage(image).eligible === true` as `featuredImages`.
- [ ] Run focused API tests.
- [ ] Commit: `feat: expose album APIs`.

## Task 4: Restore image filenames in the public gallery

**Files:**
- Modify: `functions/api/admin/_shared.js`
- Modify: `public/assets/templates.js`
- Modify: `src/shared/templates.js`
- Modify: `public/assets/gallery.js`
- Modify: `public/index.html`
- Modify: `tests/templates.test.js`
- Modify: `tests/api-handlers.test.js`
- Modify: `tests/site-api.test.js`

- [ ] Write failing tests that require public payloads to contain `fileName`, gallery hover markup to render filename before tags, modal title and tag elements, and accessible labels to prefer filename.
- [ ] Run the focused tests and confirm the old tag-only contract fails.
- [ ] Add `fileName` to `toPublicImage()`.
- [ ] Render card markup as:

```html
<span class="gallery-hover-meta">
  <strong class="card-title">filename.webp</strong>
  <span class="card-tags">标签一 · 标签二</span>
</span>
```

- [ ] Split modal metadata into `#modal-title` and `#modal-tags`; set title from `image.fileName || "未命名图片"`, tags as secondary text, and image alt from filename.
- [ ] Keep runtime and shared templates byte-for-byte aligned.
- [ ] Run focused tests.
- [ ] Commit: `fix: show image names in public viewer`.

## Task 5: Replace the narrow admin image drawer

**Files:**
- Modify: `public/assets/admin/library-page.js`
- Modify: `public/assets/admin/admin.css`
- Modify: `public/assets/admin/workbench.css`
- Modify: `public/admin/index.html`
- Modify: `tests/admin-library.test.js`
- Modify: `tests/templates.test.js`

- [ ] Write failing source/CSS contract tests requiring `.admin-detail-workspace`, `.detail-preview-stage`, desktop two-column layout, width `min(1040px, calc(100vw - 48px))`, `object-fit: contain`, and mobile one-column/fullscreen rules.
- [ ] Run focused tests and verify the 440px drawer fails them.
- [ ] In `openDetail()`, wrap preview/dimensions in a left `.detail-preview-pane`, form in a right `.detail-edit-pane`, and append both inside `.admin-detail-workspace`.
- [ ] Scope wide width to `#admin-detail-drawer` so generic dialogs remain 440px.
- [ ] Use a viewport-bounded preview stage with `min-height: 360px; height: calc(100dvh - 120px); max-height: 760px` and center the image without a forced 4:3 aspect ratio.
- [ ] Run focused tests.
- [ ] Commit: `feat: widen admin image workspace`.

## Task 6: Upgrade Featured Management into Album Management

**Files:**
- Create: `public/assets/admin/album-management.js`
- Modify: `public/assets/admin/featured-page.js`
- Modify: `public/admin/featured.html`
- Modify: `public/assets/admin/settings.css`
- Create: `tests/album-management.test.js`
- Modify: `tests/featured-page.test.js`
- Modify: `tests/templates.test.js`

- [ ] Write failing tests for “图集管理” navigation/title, create/edit/delete controls, list/detail layout, safe load lock, member ordering, membership selection across filters, and “图集 N 张 / 轮播可用 M 张”.
- [ ] Run focused tests and confirm the old single-site controller fails.
- [ ] Implement a controller that loads `/api/admin/albums`, keeps server and draft snapshots per selected album, and exposes create, save, delete, set-home, add-member, remove, move-up and move-down operations.
- [ ] Candidate picker loads `/api/admin/images`; it allows every image into a normal album. Provide tabs `全部 / 4K / 2K / 1K / 其他 / 非轮播比例`, preserve cross-tab selections, and show actual dimensions.
- [ ] Prevent deleting the current home album until another album is marked home; display API errors without clearing drafts.
- [ ] Replace old issue-name/hero-copy single form with album list plus editor while keeping `/admin/featured.html` URL.
- [ ] Run controller/template tests.
- [ ] Commit: `feat: add album management workspace`.

## Task 7: Redesign the homepage and add album detail browsing

**Files:**
- Modify: `public/index.html`
- Modify: `public/assets/main.css`
- Modify: `public/assets/public-data.js`
- Modify: `public/assets/gallery.js`
- Modify: `public/assets/templates.js`
- Modify: `src/shared/templates.js`
- Create: `public/album.html`
- Create: `public/assets/album-page.js`
- Modify: `tests/public-data.test.js`
- Modify: `tests/templates.test.js`

- [ ] Write failing tests for sticky public navigation, large editorial heading, album cards, neutral palette variables, filename hover hierarchy, album detail template, safe empty state, and albums bootstrap fallback.
- [ ] Run focused tests and verify missing album UI failures.
- [ ] Load site, albums and tags in parallel; site and album-summary failure fall back independently while tag failure remains blocking.
- [ ] Add a public album section between Hero and tag browsing, rendered with cover, name, description and count linking to `/album.html?slug=...`.
- [ ] Build `album-page.js` to request `/api/public/albums?slug=...`, render ordered masonry cards, and reuse filename-first modal behavior.
- [ ] Restyle `main.css` from the reference: `#f7f7f5` background, `#222` ink, white surfaces, subtle 8% borders, dark active chips, restrained `#9a4b2f` accent, sticky translucent nav, 1280px content width, large sans-serif heading, masonry cards with 16–20px radii and reduced shadows.
- [ ] Mirror the same tokens in `public/assets/admin/admin.css` so every admin page uses the unified palette.
- [ ] Run public/template/accessibility tests.
- [ ] Commit: `feat: redesign gallery and add album pages`.

## Task 8: Cache versions, full verification, D1 migration and release

**Files:**
- Modify: all changed HTML/module import query versions
- Modify: `tests/templates.test.js`
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`

- [ ] Write a failing cache contract for `20260717-albums-gallery-redesign` across public and affected admin assets.
- [ ] Update HTML and module import query strings to that version, then run `node --check` on every changed module.
- [ ] Run `npm test`; expected zero failures.
- [ ] Run `git diff --check`, inspect the complete feature diff, and preserve all unrelated user files.
- [ ] Apply production migration with:

```powershell
npx wrangler d1 migrations apply GALLERY_DB --remote
```

- [ ] Verify migration list has no pending migrations and query only anonymous counts/schema metadata, not image URLs or image blobs.
- [ ] Merge to `main`, rerun `npm test`, push `origin main`, wait for GitHub CI and Cloudflare deployment.
- [ ] Verify only deployed HTML/JS/CSS text and public JSON field names/counts. Do not request `/file/` URLs, screenshots, thumbnails, image bytes, or visual analysis.
- [ ] Record the deployment SHA and migration result in the project rollout document.
