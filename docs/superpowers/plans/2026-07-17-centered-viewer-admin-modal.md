# Centered Viewer And Admin Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center the public image viewer with transparent in-image metadata, replace the admin image drawer with a responsive modal, and simplify the public navigation and section copy.

**Architecture:** Keep the existing vanilla HTML/CSS/JS structure. Introduce a shrink-wrapped `modal-stage` so absolutely positioned metadata does not affect centering, and reuse the admin overlay foundation around a new dialog panel while retaining the existing detail workspace and focus behavior.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js built-in test runner, Cloudflare Pages.

---

### Task 1: Add public viewer and copy regression tests

**Files:**
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Write the failing tests**

Add assertions that both public pages wrap `#modal-image` and `.modal-meta` in `.modal-stage`, that the stage is centered, that metadata is absolutely positioned with a transparent background and text shadow, and that the new navigation/copy contracts are present while removed text is absent.

- [ ] **Step 2: Run the public template tests and verify RED**

Run: `node --test --test-name-pattern="public image viewer|public gallery copy" tests/templates.test.js`

Expected: FAIL because `.modal-stage`, the new copy, and the simplified navigation do not exist yet.

- [ ] **Step 3: Implement the public markup and CSS**

In `public/index.html` and `public/album.html`, use:

```html
<div class="modal-stage">
  <img id="modal-image" alt="" />
  <div class="modal-meta"><strong id="modal-title"></strong><span id="modal-tags"></span></div>
</div>
```

In `public/assets/main.css`, make `.modal-stage` relative and shrink-wrapped, keep the image within the viewport, and use:

```css
.modal-meta {
  position: absolute;
  inset: auto 0 0;
  background: transparent;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 3px 18px rgba(0, 0, 0, 0.72);
}
```

Update the homepage navigation, remove both Chinese section headings, and replace the intro paragraph with the approved poetic copy.

- [ ] **Step 4: Update public cache versions and verify GREEN**

Use `20260717-centered-viewer-admin-modal` in `public/index.html`, `public/album.html`, `public/assets/gallery.js`, and `public/assets/album-page.js`, then rerun the focused test command and expect PASS.

### Task 2: Add admin modal regression tests

**Files:**
- Modify: `tests/admin-library.test.js`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Write the failing tests**

Assert that the library HTML exposes `#admin-detail-overlay` with overlay classes, the controller builds `.admin-detail-dialog` with dialog semantics and closes on backdrop clicks, the CSS defines a centered 1180px panel, retains the desktop two-column workspace, switches to one column below 900px, and becomes full-screen below 720px. Assert that drawer selectors and names are absent.

- [ ] **Step 2: Run focused admin tests and verify RED**

Run: `node --test --test-name-pattern="image detail uses|admin controls expose" tests/admin-library.test.js tests/templates.test.js`

Expected: FAIL because the current implementation still uses `admin-detail-drawer` and `.admin-drawer`.

- [ ] **Step 3: Implement the centered responsive dialog**

Rename the static host to `#admin-detail-overlay` with `admin-overlay admin-detail-overlay`. In `openDetail`, create:

```js
const dialog = createElement("section", {
  className: "admin-detail-dialog",
  role: "dialog",
  "aria-modal": "true",
  "aria-labelledby": "detail-title",
});
dialog.append(header, workspace);
elements.detailOverlay.replaceChildren(dialog);
```

Retarget close, focus trap, Escape, and focus restoration logic to `detailOverlay`, and add backdrop-click closure.

- [ ] **Step 4: Implement responsive modal CSS and verify GREEN**

Define the dialog at `width:min(1180px,calc(100vw - 40px))` and `max-height:calc(100dvh - 40px)`, preserve contained previews, use one column below 900px, and a borderless full-screen panel below 720px. Update the image-library asset versions to `20260717-centered-viewer-admin-modal`, then rerun the focused test command and expect PASS.

### Task 3: Verify, review, and publish

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-centered-viewer-admin-modal.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Review the complete diff**

Run: `git diff --check` and `git diff --stat && git diff`.

Expected: no whitespace errors and no unrelated files or image content.

- [ ] **Step 3: Commit and push**

Commit the implementation, then fast-forward `origin/main` from the isolated branch.

- [ ] **Step 4: Verify deployment without images**

Check GitHub Actions and request only public HTML/CSS/JS text from `https://gallery.140079.xyz`. Confirm the new release version, copy, modal-stage rules, admin dialog rules, and absence of the removed navigation labels. Do not request image URLs or screenshots.

