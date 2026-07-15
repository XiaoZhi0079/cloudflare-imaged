# Gallery Release Safety Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local Hero/featured-site work safe to commit and deploy by restoring CI, making site updates atomic, adding resilient and accessible carousel behavior, and removing repository/deployment hazards.

**Architecture:** Keep the existing Cloudflare Pages Functions, D1 repository, and dependency-free browser modules. Add one repository use-case method for atomic site updates, one public-data loader for graceful degradation, and one pure carousel state module for deterministic tests. Preserve the current uncommitted working tree and do not commit, push, or deploy.

**Tech Stack:** JavaScript ES modules, Node.js 22 built-in test runner and `node:sqlite`, Cloudflare Pages Functions, Cloudflare D1/R2, HTML/CSS.

**Workspace note:** This plan intentionally runs in the existing dirty worktree because the feature being repaired exists only as uncommitted user work. Commit steps are omitted because the approved scope explicitly forbids commits.

---

## File map

**Create**

- `public/assets/public-data.js` — fetch public JSON and degrade only the optional site payload
- `public/assets/hero-carousel.js` — dependency-free carousel state and timer controller
- `tests/public-data.test.js` — optional-site fallback and core-tag failure tests
- `tests/hero-carousel.test.js` — carousel index, timer, pause, reduced-motion, and destroy tests

**Modify**

- `src/server/gallery-repository.js` — strict validation and atomic site configuration update
- `functions/api/admin/site.js` — call the atomic repository use case
- `functions/api/admin/_shared.js` — separate public image serialization from admin serialization
- `functions/api/public/images.js` — use the public serializer
- `functions/api/public/site.js` — use the public serializer
- `tests/site-api.test.js` — atomicity, strict ID validation, and public payload tests
- `tests/site-settings-repository.test.js` — repository atomic update tests
- `tests/api-handlers.test.js` — public image payload contract without `fileName`
- `tests/templates.test.js` — correct the filename false positive and add pause-control contract
- `public/index.html` — add pause/continue control
- `public/assets/gallery.js` — use resilient loading and carousel controller
- `public/assets/main.css` — style the pause control and compact mobile controls
- `public/assets/admin/site-settings.js` — preserve existing featured order when adding/removing
- `tests/site-settings-controller.test.js` — test featured selection merging without a DOM dependency
- `.gitignore` — keep local demo assets out of Git
- `scripts/seed-local-demo.mjs` — select the largest SQLite file by byte size
- `sync-github.cmd` — replace force push with protected normal push
- `docs/repo-sync-notes.zh-CN.md` — document the actual aligned branch state
- `docs/2026-07-14-hero-featured-and-public-polish.md` — record the completed safety work and remaining manual checks

### Task 1: Correct the public filename contract

**Files:**

- Modify: `tests/templates.test.js`
- Modify: `tests/api-handlers.test.js`
- Modify: `tests/site-api.test.js`
- Modify: `functions/api/admin/_shared.js`
- Modify: `functions/api/public/images.js`
- Modify: `functions/api/public/site.js`

- [ ] **Step 1: Write the failing public serialization assertions**

Change the template fixture so `fileName` and `fileUrl` are distinguishable:

```js
const cards = renderGalleryCards([{
  id: 1,
  fileName: "private-name.webp",
  fileUrl: "/file/object-42",
  tags: ["人像"],
  category: { name: "Portrait" },
}]);
assert.doesNotMatch(cards, /private-name\.webp/);
assert.match(cards, /\/file\/object-42/);
```

Update the public images expected object to omit `fileName`, and add these assertions to the public site test after creating one featured image:

```js
assert.equal("fileName" in publicPayload.featuredImages[0], false);
assert.equal("category" in publicPayload.featuredImages[0], false);
```

- [ ] **Step 2: Run the focused tests and verify they fail for the intended reasons**

Run:

```powershell
node --test tests/templates.test.js tests/api-handlers.test.js tests/site-api.test.js
```

Expected: the old template false positive is gone; public payload assertions fail because the API still returns `fileName`.

- [ ] **Step 3: Add and use an explicit public serializer**

Add to `functions/api/admin/_shared.js` without changing `toApiImage()` or `toAdminImage()` used by admin routes:

```js
export function toPublicImage(image) {
  return {
    id: image.id,
    fileUrl: image.fileUrl,
    width: image.width,
    height: image.height,
    tags: image.tags ?? [],
  };
}
```

In both public handlers, import `toPublicImage` and map records through it:

```js
images: images.map(toPublicImage)
```

```js
featuredImages: featuredImages.map(toPublicImage)
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
node --test tests/templates.test.js tests/api-handlers.test.js tests/site-api.test.js
```

Expected: all selected tests pass.

### Task 2: Make site configuration updates strict and atomic

**Files:**

- Modify: `tests/site-api.test.js`
- Modify: `tests/site-settings-repository.test.js`
- Modify: `src/server/gallery-repository.js`
- Modify: `functions/api/admin/site.js`

- [ ] **Step 1: Add failing API rollback and strict-validation tests**

Create an initial configuration and featured list, submit an invalid combined update, then assert no field changed:

```js
await repository.updateSiteSettings({ issueName: "原期名", heroCopy: "原文案" });
await repository.setFeaturedImages([first.id]);

const response = await adminSiteHandler({
  env,
  request: new Request("https://gallery.example.com/api/admin/site", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-gallery-admin-key": "gallery-secret",
    },
    body: JSON.stringify({
      issueName: "不应保存",
      heroCopy: "也不应保存",
      featuredImageIds: [first.id, 9999],
    }),
  }),
});

assert.equal(response.status, 400);
assert.deepEqual(await repository.getSiteSettings(), {
  issueName: "原期名",
  heroCopy: "原文案",
});
assert.deepEqual((await repository.listFeaturedImages()).map(({ id }) => id), [first.id]);
```

Add table-driven requests for `[first.id, "bad"]`, `[first.id, first.id]`, and a non-array value. Each must return 400 and retain the original featured list.

- [ ] **Step 2: Run the site tests and verify the rollback test fails**

Run:

```powershell
node --test tests/site-api.test.js tests/site-settings-repository.test.js
```

Expected: the combined invalid request returns 400 but the current implementation has already persisted text, proving the regression test.

- [ ] **Step 3: Add strict repository normalization**

Add a helper near the site-setting helpers:

```js
function validateFeaturedImageIds(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("featuredImageIds must be an array");
  }

  if (value.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new RangeError("featuredImageIds must contain positive integers");
  }

  if (new Set(value).size !== value.length) {
    throw new RangeError("featuredImageIds must not contain duplicates");
  }

  return [...value];
}
```

- [ ] **Step 4: Implement one atomic repository use case**

Add `updateSiteConfiguration()` to the repository object. It must normalize strings, validate all IDs and their existence before building entries, then call the existing transactional `runBatch()` once:

```js
async updateSiteConfiguration(changes = {}) {
  await ensureSchema();

  const hasIssueName = changes.issueName !== undefined;
  const hasHeroCopy = changes.heroCopy !== undefined;
  const hasFeatured = changes.featuredImageIds !== undefined;
  const issueName = hasIssueName ? String(changes.issueName ?? "").trim() : undefined;
  const heroCopy = hasHeroCopy ? String(changes.heroCopy ?? "").trim() : undefined;

  if (hasIssueName && !issueName) throw new RangeError("issueName is required");
  if (hasHeroCopy && !heroCopy) throw new RangeError("heroCopy is required");

  const featuredImageIds = hasFeatured
    ? validateFeaturedImageIds(changes.featuredImageIds)
    : undefined;

  if (featuredImageIds?.length) {
    const placeholders = featuredImageIds.map(() => "?").join(", ");
    const rows = await all(database, `SELECT id FROM images WHERE id IN (${placeholders})`, featuredImageIds);
    const existing = new Set(rows.map(({ id }) => Number(id)));
    const missing = featuredImageIds.filter((id) => !existing.has(id));
    if (missing.length) throw new RangeError(`unknown image ids: ${missing.join(", ")}`);
  }

  const entries = [];
  if (hasIssueName) entries.push(siteSettingUpsertEntry("issue_name", issueName));
  if (hasHeroCopy) entries.push(siteSettingUpsertEntry("hero_copy", heroCopy));
  if (hasFeatured) {
    entries.push({ sql: `DELETE FROM featured_images`, params: [] });
    featuredImageIds.forEach((imageId, index) => entries.push({
      sql: `INSERT INTO featured_images (image_id, sort_order) VALUES (?, ?)`,
      params: [imageId, index + 1],
    }));
  }

  if (entries.length) await runBatch(database, entries);
  return {
    ...(await this.getSiteSettings()),
    featuredImages: await this.listFeaturedImages(),
  };
}
```

Extract the repeated site upsert SQL into `siteSettingUpsertEntry(key, value)` and reuse it from `updateSiteSettings()` so the SQL contract remains single-sourced.

- [ ] **Step 5: Route PATCH through the atomic use case**

Remove the lenient ID normalizer from `functions/api/admin/site.js`. Build only the fields present in the request and call once:

```js
await repository.updateSiteConfiguration({
  ...(hasIssueName ? { issueName: body.issueName } : {}),
  ...(hasHeroCopy ? { heroCopy: body.heroCopy } : {}),
  ...(hasFeatured ? { featuredImageIds: body.featuredImageIds } : {}),
});
```

Map `required`, `must be`, `must contain`, `duplicates`, and `unknown image ids` errors to status 400.

- [ ] **Step 6: Run the focused tests and verify all pass**

Run:

```powershell
node --test tests/site-api.test.js tests/site-settings-repository.test.js
```

Expected: all site API and repository tests pass, including rollback and strict validation.

### Task 3: Make optional site loading degrade safely

**Files:**

- Create: `public/assets/public-data.js`
- Create: `tests/public-data.test.js`
- Modify: `public/assets/gallery.js`

- [ ] **Step 1: Write failing public-data tests**

Use an injected fetch implementation and built-in `Response` objects:

```js
test("site failure falls back without blocking tags", async () => {
  const fetchImpl = async (url) => {
    if (url === "/api/public/site") {
      return new Response("<!doctype html><title>fallback</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return Response.json({ tags: [{ id: 1, name: "人像", slug: "portrait" }] });
  };

  const result = await loadPublicBootstrapData(fetchImpl);
  assert.equal(result.site.issueName, "图集");
  assert.deepEqual(result.site.featuredImages, []);
  assert.equal(result.tags[0].slug, "portrait");
});
```

Add a second test where `/api/public/tags` returns 500 and assert the promise rejects.

- [ ] **Step 2: Run the new test and verify it fails because the module is missing**

Run:

```powershell
node --test tests/public-data.test.js
```

Expected: FAIL with module-not-found for `public/assets/public-data.js`.

- [ ] **Step 3: Implement the dependency-free loader**

Create `public/assets/public-data.js`:

```js
export const DEFAULT_PUBLIC_SITE = Object.freeze({
  issueName: "图集",
  heroCopy: "",
  issueCount: 0,
  featuredImages: [],
});

export async function fetchPublicJson(url, init, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }
  return payload;
}

export async function loadPublicBootstrapData(fetchImpl = globalThis.fetch) {
  const sitePromise = fetchPublicJson("/api/public/site", undefined, fetchImpl)
    .catch(() => ({ ...DEFAULT_PUBLIC_SITE, featuredImages: [] }));
  const tagsPromise = fetchPublicJson("/api/public/tags", undefined, fetchImpl);
  const [site, tagsPayload] = await Promise.all([sitePromise, tagsPromise]);
  return {
    site,
    tags: Array.isArray(tagsPayload?.tags) ? tagsPayload.tags : [],
  };
}
```

- [ ] **Step 4: Integrate the loader into the public gallery**

Import `fetchPublicJson` and `loadPublicBootstrapData`, delete the local `fetchJson`, use `fetchPublicJson` in `loadImages`, and replace the bootstrap `Promise.all` with:

```js
const { site, tags: loadedTags } = await loadPublicBootstrapData();
renderHero(site);
tags = loadedTags;
```

- [ ] **Step 5: Run loader and existing template tests**

Run:

```powershell
node --test tests/public-data.test.js tests/templates.test.js
```

Expected: all selected tests pass.

### Task 4: Add an accessible, testable Hero carousel

**Files:**

- Create: `public/assets/hero-carousel.js`
- Create: `tests/hero-carousel.test.js`
- Modify: `public/index.html`
- Modify: `public/assets/gallery.js`
- Modify: `public/assets/main.css`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Write failing carousel state tests**

Use a fake scheduler that records the active callback. Cover initial start for three images, timer advancement, select/next/previous wraparound, hover/focus/hidden pause reasons, manual pause, reduced-motion default pause, explicit resume, and `destroy()` clearing the timer:

```js
const scheduler = createFakeScheduler();
const indices = [];
const carousel = createHeroCarousel({
  length: 3,
  onIndexChange: (index) => indices.push(index),
  setIntervalFn: scheduler.setInterval,
  clearIntervalFn: scheduler.clearInterval,
});

assert.equal(scheduler.activeCount(), 1);
scheduler.tick();
assert.equal(carousel.getState().index, 1);
carousel.setPauseReason("hover", true);
assert.equal(scheduler.activeCount(), 0);
carousel.setPauseReason("hover", false);
assert.equal(scheduler.activeCount(), 1);
```

- [ ] **Step 2: Run the test and verify module-not-found failure**

Run:

```powershell
node --test tests/hero-carousel.test.js
```

Expected: FAIL because `public/assets/hero-carousel.js` does not exist.

- [ ] **Step 3: Implement the carousel controller**

Create `createHeroCarousel()` with fixed `length`, normalized indices, one timer, a `Set` of temporary pause reasons, and a `manualPaused` flag initialized from `reducedMotion`. Expose:

```js
return {
  select,
  next: () => select(index + 1),
  previous: () => select(index - 1),
  toggleManualPause,
  setPauseReason,
  setReducedMotion,
  getState,
  destroy,
};
```

`syncTimer({ restart })` must clear the timer whenever `length <= 1`, `manualPaused`, or any pause reason is active. A user navigation action restarts the five-second interval only when autoplay is allowed. `setReducedMotion(true)` sets `manualPaused = true`; an explicit button toggle may resume afterward.

- [ ] **Step 4: Add the static pause control**

Add inside `.hero-controls`, between dots and next:

```html
<button type="button" id="hero-pause" class="hero-pause" aria-pressed="false">暂停轮播</button>
```

Add a static assertion for `id="hero-pause"` and `aria-pressed` to `tests/templates.test.js`.

- [ ] **Step 5: Wire the controller to gallery DOM events**

Replace `featuredIndex` and `heroTimer` with `heroCarousel`. On render, destroy the old controller, build dots, and create a controller whose callbacks call `showFeatured(index)` and update:

```js
heroPause.textContent = state.manualPaused ? "继续轮播" : "暂停轮播";
heroPause.setAttribute("aria-pressed", String(state.manualPaused));
```

Wire prev/next/dots/pause to controller methods. Wire temporary pause reasons:

```js
heroStage.addEventListener("mouseenter", () => heroCarousel?.setPauseReason("hover", true));
heroStage.addEventListener("mouseleave", () => heroCarousel?.setPauseReason("hover", false));
siteHero.addEventListener("focusin", () => heroCarousel?.setPauseReason("focus", true));
siteHero.addEventListener("focusout", (event) => {
  if (!siteHero.contains(event.relatedTarget)) heroCarousel?.setPauseReason("focus", false);
});
document.addEventListener("visibilitychange", () => {
  heroCarousel?.setPauseReason("hidden", document.hidden);
});
```

Create a `matchMedia("(prefers-reduced-motion: reduce)")` query, pass its initial state, and forward future `change` events to `setReducedMotion()`.

- [ ] **Step 6: Style the text-width button without crowding mobile controls**

Add:

```css
.hero-controls .hero-pause {
  width: auto;
  min-width: 84px;
  padding: 0 14px;
  font-size: 12px;
}

@media (max-width: 480px) {
  .hero-controls {
    left: 10px;
    right: 10px;
    gap: 8px;
  }

  .hero-controls .hero-pause {
    min-width: 72px;
    padding: 0 10px;
  }
}
```

- [ ] **Step 7: Run carousel and template tests**

Run:

```powershell
node --test tests/hero-carousel.test.js tests/templates.test.js
```

Expected: all selected tests pass.

### Task 5: Preserve featured order in the admin picker

**Files:**

- Modify: `public/assets/admin/site-settings.js`
- Create: `tests/site-settings-controller.test.js`

- [ ] **Step 1: Write the failing pure merge test**

Import `mergeFeaturedSelection` and verify kept items retain draft order while new items append in library order:

```js
const current = [{ id: 3 }, { id: 1 }, { id: 2 }];
const library = [{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }, { id: 5 }];
const merged = mergeFeaturedSelection(current, library, [1, 3, 4, 5]);
assert.deepEqual(merged.map(({ id }) => id), [3, 1, 4, 5]);
```

- [ ] **Step 2: Run the test and verify the missing-export failure**

Run:

```powershell
node --test tests/site-settings-controller.test.js
```

Expected: FAIL because `mergeFeaturedSelection` is not exported.

- [ ] **Step 3: Implement and use the pure merge helper**

Add to `public/assets/admin/site-settings.js`:

```js
export function mergeFeaturedSelection(current, library, selectedIds) {
  const selected = new Set(selectedIds.map(Number));
  const kept = current.filter((image) => selected.has(Number(image.id)));
  const keptIds = new Set(kept.map((image) => Number(image.id)));
  const added = library.filter((image) => (
    selected.has(Number(image.id)) && !keptIds.has(Number(image.id))
  ));
  return [...kept, ...added];
}
```

Replace the current `chosenIds.map(...)` assignment with:

```js
draft.featuredImages = mergeFeaturedSelection(draft.featuredImages, images, chosenIds);
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
node --test tests/site-settings-controller.test.js
```

Expected: all tests pass.

### Task 6: Remove local demo and force-push hazards

**Files:**

- Modify: `.gitignore`
- Modify: `scripts/seed-local-demo.mjs`
- Modify: `sync-github.cmd`
- Modify: `docs/repo-sync-notes.zh-CN.md`
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`

- [ ] **Step 1: Ignore generated demo assets**

Append:

```gitignore
public/demo/
```

Verify:

```powershell
git check-ignore -v public/demo/seed-01.svg
```

Expected: output points to the new `.gitignore` rule.

- [ ] **Step 2: Select the demo database by byte size**

Import `statSync` from `node:fs` and replace path-length sorting with:

```js
return files.sort((left, right) => statSync(right).size - statSync(left).size)[0];
```

Run:

```powershell
node --check scripts/seed-local-demo.mjs
```

Expected: exit code 0.

- [ ] **Step 3: Replace force push with normal push**

In `sync-github.cmd`, change the preview and command to:

```bat
echo   git push -u origin main
git -c safe.directory="%SAFE_DIR%" push -u origin main
```

Update surrounding text to say a non-fast-forward remote update will be rejected and must be inspected, never overwritten automatically.

- [ ] **Step 4: Rewrite stale repository synchronization guidance**

Document these verified facts:

- local `main` and `origin/main` currently share base commit `3bf57a1`
- the new Hero/site work is in the uncommitted working tree
- after tests pass, use curated staging, commit, then ordinary push
- do not use `git add -A` until generated demo assets are ignored
- do not use `--force`

Update the feature document's test status to state that automated safety work is complete only after the final verification command succeeds; keep production D1 and browser smoke checks unchecked because this task does not deploy.

### Task 7: Full verification and scope audit

**Files:**

- Verify all modified and created files above

- [ ] **Step 1: Run all tests**

Run:

```powershell
npm test
```

Expected: 0 failures.

- [ ] **Step 2: Syntax-check every new or behaviorally modified browser/server module**

Run `node --check` for:

```text
public/assets/public-data.js
public/assets/hero-carousel.js
public/assets/gallery.js
public/assets/admin/site-settings.js
functions/api/admin/site.js
functions/api/admin/_shared.js
functions/api/public/images.js
functions/api/public/site.js
src/server/gallery-repository.js
scripts/seed-local-demo.mjs
```

Expected: every command exits 0.

- [ ] **Step 3: Check patch hygiene**

Run:

```powershell
git diff --check
git status --short --branch
```

Expected: no whitespace errors; status contains only the pre-existing feature work, the approved design/plan, and the release-safety fixes. `public/demo/` must no longer appear as untracked.

- [ ] **Step 4: Re-run the original regressions explicitly**

Run the full suite plus these focused groups:

```powershell
node --test tests/site-api.test.js tests/site-settings-repository.test.js
node --test tests/public-data.test.js tests/hero-carousel.test.js tests/site-settings-controller.test.js tests/templates.test.js
```

Expected: all focused tests pass, proving atomic rollback, optional-site fallback, carousel pause behavior, order preservation, and corrected filename assertions.

- [ ] **Step 5: Confirm prohibited actions were not taken**

Verify no commit, push, deployment, production D1 command, or R2 mutation was executed. Report the remaining manual production checks separately.
