# Cloudflare Image Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve responsive Cloudflare image variants for every public gallery surface while preserving original R2 files and automatically falling back when transformations are unavailable.

**Architecture:** A pure shared variant module owns the finite presets and URL construction. Public templates and runtime viewers consume those presets, while a dedicated `/img/*` Pages Function performs `cf.image` fetches against the separate `/file/*` source route and redirects to the original on failure.

**Tech Stack:** Cloudflare Pages Functions, R2, `cf.image`, vanilla JavaScript, HTML `srcset`/`sizes`, Node.js built-in test runner.

---

### Task 1: Add shared responsive image rules

**Files:**
- Create: `tests/image-variants.test.js`
- Create: `src/shared/image-variants.js`
- Create: `public/assets/image-variants.js`

- [x] **Step 1: Write failing tests**

Test the exact width whitelist, `/file/*` to `/img/*` conversion for relative and absolute same-site URLs, rejection of non-gallery URLs, preset candidate limits based on intrinsic width, `srcset` formatting, and original `src` fallback.

- [x] **Step 2: Verify RED**

Run: `node --test tests/image-variants.test.js`

Expected: FAIL because the shared module does not exist.

- [x] **Step 3: Implement the shared module and browser copy**

Export `IMAGE_VARIANT_WIDTHS`, `IMAGE_VARIANT_PRESETS`, `buildImageVariantUrl`, `getResponsiveImageAttributes`, and `applyResponsiveImageAttributes`. Keep the two module files byte-for-byte identical.

- [x] **Step 4: Verify GREEN**

Run: `node --test tests/image-variants.test.js`

Expected: all variant tests pass.

### Task 2: Add the Cloudflare transformation proxy and original caching

**Files:**
- Create: `tests/image-transform-handler.test.js`
- Create: `functions/img/[[path]].js`
- Modify: `tests/file-handler.test.js`
- Modify: `functions/file/[[path]].js`

- [x] **Step 1: Write failing handler tests**

Prove invalid widths and traversal are rejected without fetch; valid requests call the same-origin `/file/*` URL with `fit: "scale-down"`, quality 82 and negotiated AVIF/WebP; success gets `Vary` and cache headers; non-success and exceptions return a non-cached 307 original redirect. Add original-file ETag, cache and 304 tests.

- [x] **Step 2: Verify RED**

Run: `node --test tests/image-transform-handler.test.js tests/file-handler.test.js`

Expected: FAIL because the transform handler and cache behavior are absent.

- [x] **Step 3: Implement handlers**

Create `createImageTransformHandler({ fetchImpl })` for testability and export Pages `onRequest`. Update the R2 file handler to emit cache/ETag headers and return 304 on a matching `If-None-Match`.

- [x] **Step 4: Verify GREEN**

Run the focused command from Step 2.

Expected: all transform and file-handler tests pass.

### Task 3: Integrate responsive markup and runtime images

**Files:**
- Modify: `tests/templates.test.js`
- Modify: `tests/image-viewer.test.js`
- Modify: `src/shared/templates.js`
- Modify: `public/assets/templates.js`
- Modify: `public/assets/gallery.js`
- Modify: `public/assets/image-viewer.js`
- Modify: `public/index.html`
- Modify: `public/album.html`

- [x] **Step 1: Write failing integration tests**

Assert album covers and gallery cards include `srcset`, `sizes`, and intrinsic dimensions; Hero imports and applies the hero preset; viewer render and adjacent preload apply the viewer preset; shared/browser variant modules and templates stay aligned; public asset versions use `20260717-cloudflare-image-performance`.

- [x] **Step 2: Verify RED**

Run: `node --test tests/templates.test.js tests/image-viewer.test.js tests/image-variants.test.js`

Expected: FAIL because public images still use original-only attributes.

- [x] **Step 3: Implement responsive integration**

Use shared helpers in templates, Hero, modal rendering, and preloading. Preserve original `src`, transparent modal metadata, complete `object-fit: contain`, and all phase-1 navigation/history behavior.

- [x] **Step 4: Verify GREEN**

Run the focused command from Step 2.

Expected: all responsive and viewer tests pass.

### Task 4: Verify, merge, and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-cloudflare-image-performance.md`

- [x] **Step 1: Run complete verification**

Run: `npm test`

Run: `git diff --check`

Expected: zero failures and no whitespace errors.

- [x] **Step 2: Review privacy and fallback scope**

Inspect text diffs only. Confirm there are no external source URLs, arbitrary transformation parameters, image downloads, screenshots, or changes to R2 object creation/deletion semantics.

- [x] **Step 3: Commit, fast-forward main and push normally**

Verify `origin/main` has not advanced, merge with `--ff-only`, rerun the full suite on the merged main workspace, and push without force.

- [x] **Step 4: Verify CI and production without real images**

Check the pushed SHA in GitHub Actions; fetch public HTML/JS text to confirm `srcset` and release versions; request an invalid-width `/img/*` for 400 and a nonexistent valid-width `/img/*` without following redirects for 307. Do not request or follow any real `/file/*` URL.
