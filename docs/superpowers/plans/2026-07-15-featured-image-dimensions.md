# Featured Image Dimensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只允许精确 16:9 且至少 1920×1080 的图片加入精选，在管理图库中标记/筛选轮播资格和 4K，并让 Hero 固定为完整展示的响应式 16:9。

**Architecture:** 资格算法只存在于 `src/shared/featured-image-rules.js`，服务端将分类结果随管理 API 返回，浏览器只消费结果。Repository 在事务批次前根据 D1 宽高执行权威校验；管理端提供资格标记、筛选和禁选提示；公开 Hero 只调整布局，不改变公开 API 或生产数据。

**Tech Stack:** 原生 JavaScript ES modules、Cloudflare Pages Functions、D1、Node.js `node:test`、CSS

**Privacy Constraint:** 不查看截图或图片内容；验证只读取源代码、宽高元数据、DOM 与计算样式。

---

## File map

- Create: `src/shared/featured-image-rules.js` — 唯一的尺寸资格分类规则。
- Create: `tests/featured-image-rules.test.js` — 分类边界测试。
- Modify: `functions/api/admin/_shared.js` — 管理 API 增加 `featuredEligibility`。
- Modify: `src/server/gallery-repository.js` — 保存精选前执行 D1 宽高校验。
- Modify: `tests/site-settings-repository.test.js` — Repository 合规/回滚测试。
- Modify: `tests/site-api.test.js` — 管理/公开 API 契约与 400 测试。
- Modify: `public/admin/index.html` — 增加轮播规格快捷筛选。
- Modify: `public/assets/admin/library-state.js` — 组合资格筛选状态。
- Modify: `public/assets/admin/library-page.js` — 绑定筛选并在详情显示规格。
- Modify: `public/assets/admin/renderers/image-card.js` — 卡片尺寸与资格标记。
- Modify: `public/assets/admin/workbench.css` — 图库资格标记与筛选样式。
- Modify: `tests/admin-library.test.js` — 筛选与渲染测试。
- Modify: `public/assets/admin/site-settings.js` — 精选列表警告与选择器禁选。
- Modify: `public/assets/admin/settings.css` — 精选资格状态样式。
- Modify: `tests/site-settings-controller.test.js` — 只追加合规新图片。
- Modify: `public/assets/main.css` — 固定 16:9、`contain`、移除视口固定高度。
- Modify: `tests/templates.test.js` — Hero 布局与管理筛选静态契约。
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md` — 记录尺寸规则和最终测试数。
- Modify: `docs/superpowers/specs/2026-07-15-featured-image-dimensions-design.md` — 更新实施状态。

### Task 1: Add the shared eligibility classifier

**Files:**
- Create: `src/shared/featured-image-rules.js`
- Create: `tests/featured-image-rules.test.js`
- Modify: `functions/api/admin/_shared.js`
- Test: `tests/featured-image-rules.test.js`

- [ ] **Step 1: Write failing classifier tests**

Create `tests/featured-image-rules.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { classifyFeaturedImage } from "../src/shared/featured-image-rules.js";

test("featured eligibility accepts full HD and larger exact 16:9 images", () => {
  assert.deepEqual(classifyFeaturedImage({ width: 1920, height: 1080 }), {
    dimensions: "1920×1080",
    isExactSixteenNine: true,
    meetsMinimum: true,
    eligible: true,
    is4K: false,
    qualityLabel: "Full HD",
    statusLabel: "轮播可用",
    reason: null,
  });
  assert.equal(classifyFeaturedImage({ width: 2560, height: 1440 }).eligible, true);
  assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).is4K, true);
  assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).is4K, false);
});

test("featured eligibility rejects low resolution wrong ratio and unknown dimensions", () => {
  assert.equal(classifyFeaturedImage({ width: 1280, height: 720 }).reason, "分辨率不足");
  assert.equal(classifyFeaturedImage({ width: 1920, height: 1200 }).reason, "比例不符");
  assert.equal(classifyFeaturedImage({ width: null, height: null }).reason, "尺寸未知");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/featured-image-rules.test.js
```

Expected: FAIL because `src/shared/featured-image-rules.js` does not exist.

- [ ] **Step 3: Implement the classifier**

Create `src/shared/featured-image-rules.js`:

```js
function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function classifyFeaturedImage(image = {}) {
  const width = positiveInteger(image.width);
  const height = positiveInteger(image.height);
  const hasDimensions = width !== null && height !== null;
  const isExactSixteenNine = hasDimensions && width * 9 === height * 16;
  const meetsMinimum = hasDimensions && width >= 1920 && height >= 1080;
  const eligible = isExactSixteenNine && meetsMinimum;
  const is4K = width === 3840 && height === 2160;
  const qualityLabel = is4K
    ? "4K"
    : width === 1920 && height === 1080
      ? "Full HD"
      : null;
  const reason = !hasDimensions
    ? "尺寸未知"
    : !isExactSixteenNine
      ? "比例不符"
      : !meetsMinimum
        ? "分辨率不足"
        : null;

  return {
    dimensions: hasDimensions ? `${width}×${height}` : "尺寸未知",
    isExactSixteenNine,
    meetsMinimum,
    eligible,
    is4K,
    qualityLabel,
    statusLabel: eligible ? "轮播可用" : reason,
    reason,
  };
}
```

- [ ] **Step 4: Add classification to admin API records**

In `functions/api/admin/_shared.js`, import the classifier and extend `toApiImage`:

```js
import { classifyFeaturedImage } from "../../../src/shared/featured-image-rules.js";

export function toApiImage(image) {
  return {
    id: image.id,
    fileName: image.fileName,
    fileUrl: image.fileUrl,
    width: image.width,
    height: image.height,
    tags: image.tags ?? [],
    featuredEligibility: classifyFeaturedImage(image),
    ...(image.category ? { category: image.category } : {}),
  };
}
```

Do not add this field to `toPublicImage`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
node --test tests/featured-image-rules.test.js tests/site-api.test.js tests/api-handlers.test.js
```

Expected: all tests pass.

Commit:

```powershell
git add -- src/shared/featured-image-rules.js functions/api/admin/_shared.js tests/featured-image-rules.test.js
git commit -m "feat: classify featured image dimensions"
```

### Task 2: Enforce eligibility in repository transactions

**Files:**
- Modify: `src/server/gallery-repository.js`
- Modify: `tests/site-settings-repository.test.js`
- Modify: `tests/site-api.test.js`
- Test: `tests/site-settings-repository.test.js`
- Test: `tests/site-api.test.js`

- [ ] **Step 1: Make existing featured fixtures eligible**

Change the default dimensions in the `createImage` helpers in both test files to `1920` and `1080`. Allow overrides:

```js
async function createImage(repository, key, categoryId = null, dimensions = {}) {
  return await repository.upsertImage({
    storageKey: key,
    fileName: `${key}.webp`,
    fileUrl: `https://gallery.example.com/file/${key}.webp`,
    width: dimensions.width ?? 1920,
    height: dimensions.height ?? 1080,
    syncStatus: "ok",
    categoryId,
  });
}
```

Use the equivalent existing test domain in each file.

- [ ] **Step 2: Add failing repository tests**

Add tests that:

```js
test("setFeaturedImages rejects images outside the featured dimension rules", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const wrongRatio = await createImage(repository, "wrong-ratio", null, { width: 1920, height: 1200 });
  await assert.rejects(
    () => repository.setFeaturedImages([wrongRatio.id]),
    /exact 16:9 and at least 1920x1080/,
  );
});

test("updateSiteConfiguration rolls back text when a featured image is ineligible", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const invalid = await createImage(repository, "small", null, { width: 1280, height: 720 });
  await repository.updateSiteSettings({ issueName: "原期名", heroCopy: "原文案" });
  await assert.rejects(
    () => repository.updateSiteConfiguration({
      issueName: "不应保存",
      heroCopy: "也不应保存",
      featuredImageIds: [invalid.id],
    }),
    /exact 16:9 and at least 1920x1080/,
  );
  assert.deepEqual(await repository.getSiteSettings(), { issueName: "原期名", heroCopy: "原文案" });
});
```

Add an API test that PATCHing the invalid ID returns 400 and leaves the previous settings unchanged.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="dimension rules|ineligible" tests/site-settings-repository.test.js tests/site-api.test.js
```

Expected: FAIL because the repository currently validates existence only.

- [ ] **Step 4: Add one repository validation helper**

Import `classifyFeaturedImage` in `src/server/gallery-repository.js`. Inside `createGalleryRepository`, add:

```js
async function assertEligibleFeaturedImages(imageIds) {
  if (!imageIds.length) return;
  const placeholders = imageIds.map(() => "?").join(", ");
  const rows = await all(
    database,
    `SELECT id, width, height FROM images WHERE id IN (${placeholders})`,
    imageIds,
  );
  const rowsById = new Map(rows.map((row) => [Number(row.id), row]));
  const missingIds = imageIds.filter((imageId) => !rowsById.has(imageId));
  if (missingIds.length) {
    throw new RangeError(`unknown image ids: ${missingIds.join(", ")}`);
  }
  const invalidIds = imageIds.filter((imageId) => !classifyFeaturedImage(rowsById.get(imageId)).eligible);
  if (invalidIds.length) {
    throw new RangeError(`featured images must be exact 16:9 and at least 1920x1080: ${invalidIds.join(", ")}`);
  }
}
```

Replace the duplicate existence queries in `updateSiteConfiguration` and `setFeaturedImages` with `await assertEligibleFeaturedImages(...)` before any delete/upsert batch is built.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
node --test tests/site-settings-repository.test.js tests/site-api.test.js
```

Expected: all tests pass, including atomic rollback.

Commit:

```powershell
git add -- src/server/gallery-repository.js tests/site-settings-repository.test.js tests/site-api.test.js
git commit -m "feat: enforce featured image dimensions"
```

### Task 3: Add library badges and quick filters

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/assets/admin/library-state.js`
- Modify: `public/assets/admin/library-page.js`
- Modify: `public/assets/admin/renderers/image-card.js`
- Modify: `public/assets/admin/workbench.css`
- Modify: `tests/admin-library.test.js`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Add failing filter and renderer tests**

In `tests/admin-library.test.js`, add images with `featuredEligibility` and assert:

```js
test("library filters images by featured eligibility and 4K", () => {
  const eligible = { id: 10, featuredEligibility: { eligible: true, is4K: false } };
  const fourK = { id: 11, featuredEligibility: { eligible: true, is4K: true } };
  const invalid = { id: 12, featuredEligibility: { eligible: false, is4K: false } };
  assert.deepEqual(filterImages([eligible, fourK, invalid], { featured: "eligible" }), [eligible, fourK]);
  assert.deepEqual(filterImages([eligible, fourK, invalid], { featured: "4k" }), [fourK]);
});
```

Extend the card test to require dimensions, `轮播可用`, and `4K` from the nested API field. Add a template assertion for radio inputs named `featured-filter` with values `all`, `eligible`, and `4k`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/admin-library.test.js tests/templates.test.js
```

Expected: FAIL because the filter and badges do not exist.

- [ ] **Step 3: Extend library state**

Add `featured = "all"` to `filterImages`. Match `image.featuredEligibility.eligible` for `eligible` and `is4K` for `4k`. Add `featuredFilter` state, `setFeaturedFilter`, include it in `getFilters`, `visibleImages`, and reset it in `resetFilters`.

- [ ] **Step 4: Add filter controls and bindings**

In `public/admin/index.html`, add a “轮播规格” section containing three radio inputs:

```html
<label class="filter-option"><input type="radio" name="featured-filter" value="all" checked /><span>全部</span></label>
<label class="filter-option"><input type="radio" name="featured-filter" value="eligible" /><span>轮播可用</span></label>
<label class="filter-option"><input type="radio" name="featured-filter" value="4k" /><span>4K</span></label>
```

In `library-page.js`, cache these inputs, bind `change` to `state.setFeaturedFilter(input.value)`, and reset their checked state when filters clear.

- [ ] **Step 5: Render cards and detail metadata**

In `renderImageCard`, render the stored `dimensions`, status label, and optional quality label. In `openDetail`, insert a `.detail-dimensions` element before the form with the same text. Escape every server-provided string.

- [ ] **Step 6: Add styles**

Add compact badge styles that remain above the image preview, with distinct states for eligible, 4K, and invalid. Add filter radio selected styles and detail dimension layout without changing public gallery CSS.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```powershell
node --test tests/admin-library.test.js tests/templates.test.js
```

Expected: all tests pass.

Commit:

```powershell
git add -- public/admin/index.html public/assets/admin/library-state.js public/assets/admin/library-page.js public/assets/admin/renderers/image-card.js public/assets/admin/workbench.css tests/admin-library.test.js tests/templates.test.js
git commit -m "feat: show featured image eligibility in library"
```

### Task 4: Restrict the featured picker without deleting old selections

**Files:**
- Modify: `public/assets/admin/site-settings.js`
- Modify: `public/assets/admin/settings.css`
- Modify: `tests/site-settings-controller.test.js`

- [ ] **Step 1: Add failing selection tests**

Update the existing merge fixture to include `featuredEligibility.eligible: true` on newly selectable library images. Add:

```js
test("featured selection keeps old invalid items but never appends new invalid images", () => {
  const current = [{ id: 1, featuredEligibility: { eligible: false } }];
  const library = [
    current[0],
    { id: 2, featuredEligibility: { eligible: false } },
    { id: 3, featuredEligibility: { eligible: true } },
  ];
  const merged = mergeFeaturedSelection(current, library, [1, 2, 3]);
  assert.deepEqual(merged.map((image) => image.id), [1, 3]);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/site-settings-controller.test.js
```

Expected: FAIL because invalid new images are currently appended.

- [ ] **Step 3: Filter only newly added images**

Keep `current` items selected by ID regardless of eligibility, but add `image.featuredEligibility?.eligible === true` to the `library.filter` predicate for new items.

- [ ] **Step 4: Render eligibility in current list and picker**

- Current list: show dimensions/status; add warning class for invalid old selections; keep “移除”.
- Picker: show dimensions/status/4K badge; disable checkboxes for invalid images; explain “仅精确 16:9 且至少 1920×1080 可加入轮播”.
- Do not silently modify `draft.featuredImages` during load.

- [ ] **Step 5: Style and verify GREEN**

Add invalid/disabled styles in `settings.css`. Run:

```powershell
node --test tests/site-settings-controller.test.js tests/templates.test.js
```

Expected: all tests pass.

Commit:

```powershell
git add -- public/assets/admin/site-settings.js public/assets/admin/settings.css tests/site-settings-controller.test.js tests/templates.test.js
git commit -m "feat: restrict featured picker by dimensions"
```

### Task 5: Make the Hero a fixed responsive 16:9 stage

**Files:**
- Modify: `public/assets/main.css`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Add the failing CSS contract**

Add a template test requiring:

```js
assert.match(css, /\.hero-stage\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9[^}]*min-height:\s*0/);
assert.match(css, /\.hero-image\s*\{[^}]*height:\s*100%[^}]*object-fit:\s*contain[^}]*object-position:\s*center/);
assert.doesNotMatch(css, /height:\s*min\(52vh,\s*520px\)/);
assert.doesNotMatch(css, /height:\s*min\(42vh,\s*360px\)/);
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test --test-name-pattern="fixed responsive 16:9" tests/templates.test.js
```

Expected: FAIL because the current Hero uses viewport heights and `cover`.

- [ ] **Step 3: Implement minimal CSS**

Use:

```css
.hero-stage {
  position: relative;
  aspect-ratio: 16 / 9;
  min-height: 0;
  background: #1a1411;
}

.hero-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
}
```

Remove the mobile `.hero-image, .hero-stage` height/min-height override. Keep transparent copy and control positioning unchanged.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
node --test tests/templates.test.js tests/hero-carousel.test.js
```

Expected: all tests pass.

Commit:

```powershell
git add -- public/assets/main.css tests/templates.test.js
git commit -m "fix: show featured images in a fixed 16 by 9 stage"
```

### Task 6: Full verification, documentation, review, and local integration

**Files:**
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`
- Modify: `docs/superpowers/specs/2026-07-15-featured-image-dimensions-design.md`

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
node --check src/shared/featured-image-rules.js
node --check public/assets/admin/library-state.js
node --check public/assets/admin/library-page.js
node --check public/assets/admin/site-settings.js
node --check functions/api/admin/_shared.js
node --check src/server/gallery-repository.js
git diff --check
git status --short --branch
```

Expected: all tests pass (target 141), all syntax checks succeed, and the feature branch is clean except intended documentation before its commit.

- [ ] **Step 2: Update documentation after evidence exists**

- Record the exact final `npm test` count.
- Document the minimum 1920×1080 exact 16:9 rule, exact 4K badge, admin filters, server enforcement, and fixed 16:9 `contain` Hero.
- Change the design status to `状态：已实施并验证`.
- State that existing invalid production selections are not auto-removed.

- [ ] **Step 3: Commit documentation**

```powershell
git add -- docs/2026-07-14-hero-featured-and-public-polish.md docs/superpowers/specs/2026-07-15-featured-image-dimensions-design.md
git commit -m "docs: record featured dimension verification"
```

- [ ] **Step 4: Review and merge locally**

Review `main...HEAD` for scope, secrets, generated assets, and privacy compliance. Request an independent read-only code review. Fix Critical/Important findings, rerun full verification, fast-forward merge to local `main`, rerun full tests on merged `main`, then clean the temporary branch/worktree.

- [ ] **Step 5: Deployment checkpoint**

Do not push or deploy without a separate user instruction. Report the local HEAD, exact test count, review result, and the manual requirement to remove existing invalid featured images before saving future site settings. If later authorized to deploy, perform only HTTP/DOM/computed-style checks without screenshots or production writes.
