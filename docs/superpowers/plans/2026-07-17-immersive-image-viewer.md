# Immersive Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the homepage and album detail page one shared, URL-addressable image viewer with navigation, keyboard, swipe, history synchronization, scroll preservation, and adjacent-image preloading.

**Architecture:** Put environment-independent navigation and URL helpers plus the DOM controller in `public/assets/image-viewer.js`. Keep `gallery.js` and `album-page.js` responsible for data loading and rendering only, and make both pages consume the same modal markup and controller API.

**Tech Stack:** Vanilla browser JavaScript, static HTML/CSS, Node.js built-in test runner, Cloudflare Pages.

---

### Task 1: Define the shared viewer core with failing tests

**Files:**
- Create: `tests/image-viewer.test.js`
- Create: `public/assets/image-viewer.js`

- [ ] **Step 1: Write failing core tests**

Test exported helpers for wrapped navigation, contextual URL creation/removal, 48px horizontal swipe detection, keyboard action mapping, and adjacent URL selection without duplicates.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/image-viewer.test.js`

Expected: FAIL because `public/assets/image-viewer.js` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Export `wrapViewerIndex`, `buildViewerUrl`, `clearViewerImageUrl`, `getViewerKeyAction`, `getSwipeAction`, and `getAdjacentImageUrls`. URL helpers must preserve unrelated query parameters and only change `image`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/image-viewer.test.js`

Expected: all viewer core tests pass.

### Task 2: Implement and test the browser controller

**Files:**
- Modify: `tests/image-viewer.test.js`
- Modify: `public/assets/image-viewer.js`

- [ ] **Step 1: Write failing controller tests**

Use lightweight fake elements, history, location, and image preloader objects. Prove open/render, wrapped next/previous, keyboard routing, swipe routing, adjacent preloading, page-open history push, direct-link close replacement, `popstate` synchronization, single-image navigation hiding, and focus restoration.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/image-viewer.test.js`

Expected: FAIL because `createImageViewer` is not implemented.

- [ ] **Step 3: Implement `createImageViewer`**

Accept `{ elements, getImages, windowObject, documentObject, locationObject, historyObject, createPreloadImage }`. Return `{ bindCards, syncFromUrl, openById, close, destroy }`. Use one render path for clicks, history, keys and touch gestures; preload only adjacent URLs and restore the opener on close.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/image-viewer.test.js`

Expected: all controller and core tests pass.

### Task 3: Integrate both public pages

**Files:**
- Modify: `tests/templates.test.js`
- Modify: `public/index.html`
- Modify: `public/album.html`
- Modify: `public/assets/gallery.js`
- Modify: `public/assets/album-page.js`
- Modify: `public/assets/main.css`

- [ ] **Step 1: Write failing integration contract tests**

Assert both pages expose previous/next/counter elements and ARIA relationships, both entry scripts import and initialize `createImageViewer`, duplicated modal mutation code is absent, homepage reads and preserves `tag`, and all public assets use release version `20260717-immersive-image-viewer`.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="immersive viewer|public entry assets|album detail page" tests/templates.test.js`

Expected: FAIL because the shared viewer markup and imports are absent.

- [ ] **Step 3: Update markup, entries and styles**

Add `#modal-prev`, `#modal-next`, `#modal-counter`, dialog labels, and shared script imports. Replace per-page modal logic with `viewer.bindCards()` after render and `viewer.syncFromUrl()` after the relevant data load. Add responsive transparent viewer controls and `.viewer-open { overflow: hidden; }` without changing the existing contained image sizing.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2 and `node --test tests/image-viewer.test.js`.

Expected: all focused tests pass.

### Task 4: Verify and publish phase 1

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-immersive-image-viewer.md`

- [ ] **Step 1: Run complete verification**

Run: `npm test`

Run: `git diff --check`

Expected: zero test failures and no whitespace errors.

- [ ] **Step 2: Review scope and privacy**

Run `git status --short`, `git diff --stat`, and inspect only text diffs. Confirm there are no image requests, screenshots, binary files, unrelated admin changes, or public image-by-id enumeration endpoints.

- [ ] **Step 3: Commit and integrate**

Commit the phase-1 docs and implementation on `feat/immersive-image-viewer`, push the branch, fast-forward `main`, and push `origin/main` without overwriting remote history.

- [ ] **Step 4: Verify GitHub and Cloudflare using text only**

Verify the pushed SHA, deployment checks, public HTML/CSS/JS release version, shared viewer imports, controls, and history code. Do not request `/file/` URLs and do not capture screenshots.

