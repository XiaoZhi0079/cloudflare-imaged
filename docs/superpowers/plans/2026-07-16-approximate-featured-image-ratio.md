# Approximate Featured Image Ratio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow near-16:9 images down to 1600×900, including 1672×941, to be selected for the Hero while preserving complete, uncropped display.

**Architecture:** Keep `classifyFeaturedImage()` as the sole eligibility and tiering authority. The Repository reuses that result for atomic writes, the admin picker consumes the API-provided classification, and targeted cache-busting ensures Cloudflare clients load the changed picker module. No D1 schema or image-content access is required.

**Tech Stack:** JavaScript ES modules, Node.js test runner, Cloudflare Pages Functions, D1-compatible test database, static HTML/CSS/JS admin UI.

---

## File Map

- `src/shared/featured-image-rules.js`: validates dimensions, performs exact and tolerant aspect-ratio checks, assigns eligibility and resolution tiers.
- `tests/featured-image-rules.test.js`: owns ratio tolerance, minimum dimension, tier, and invalid-input boundaries.
- `src/server/gallery-repository.js`: rejects invalid featured IDs before atomic site writes.
- `tests/site-settings-repository.test.js`: verifies Repository acceptance, rejection, and rollback behavior.
- `tests/site-api.test.js`: verifies the admin API exposes near-ratio eligibility and returns the new validation error.
- `public/assets/admin/site-settings.js`: supplies picker labels, rule copy, filtering, selection, and rendering.
- `tests/site-settings-controller.test.js`: verifies HD+ picker labeling and near-ratio guidance.
- `public/assets/admin/settings-page.js`: imports the changed picker module with a new release token.
- `public/admin/settings.html`: loads the changed settings entry with the same release token.
- `tests/templates.test.js`: verifies the targeted settings JavaScript cache chain while leaving unchanged admin assets on their prior token.
- `docs/2026-07-14-hero-featured-and-public-polish.md`: records the current rule, tier names, cache version, and verification evidence.

Do not modify or stage the unrelated current changes in `README.md`, `package.json`, `.playwright-mcp/`, `package-lock.json`, `tools/`, `tests/codex-turn-cleaner-*.test.js`, or the codex-turn-cleaner plan/spec files.

### Task 1: Make the shared classifier accept near-16:9 HD+ images

**Files:**
- Modify: `tests/featured-image-rules.test.js`
- Modify: `src/shared/featured-image-rules.js`

- [ ] **Step 1: Write failing classifier tests**

Replace the exact-only happy-path expectations with explicit exact and approximate fields, then add tolerance boundaries and invalid dimensions:

```js
test("featured eligibility accepts HD+ and larger near-16:9 images", () => {
  assert.deepEqual(classifyFeaturedImage({ width: 1600, height: 900 }), {
    dimensions: "1600×900",
    isExactSixteenNine: true,
    isApproximatelySixteenNine: true,
    meetsMinimum: true,
    eligible: true,
    is4K: false,
    resolutionTier: "1k",
    qualityLabel: "HD+ / 900p+",
    statusLabel: "轮播可用",
    reason: null,
  });

  const roundedExport = classifyFeaturedImage({ width: 1672, height: 941 });
  assert.equal(roundedExport.isExactSixteenNine, false);
  assert.equal(roundedExport.isApproximatelySixteenNine, true);
  assert.equal(roundedExport.eligible, true);
  assert.equal(roundedExport.resolutionTier, "1k");
});

test("featured eligibility includes the 0.5 percent ratio boundaries", () => {
  assert.equal(classifyFeaturedImage({ width: 3184, height: 1800 }).eligible, true);
  assert.equal(classifyFeaturedImage({ width: 3216, height: 1800 }).eligible, true);
  assert.equal(classifyFeaturedImage({ width: 3183, height: 1800 }).reason, "比例不符");
  assert.equal(classifyFeaturedImage({ width: 3217, height: 1800 }).reason, "比例不符");
});
```

Keep tier checks for `2560×1440`, `3200×1800`, `3840×2160`, and `7680×4320`. Assert `1280×720` is “分辨率不足”, `1920×1200` is “比例不符”, and null, negative, fractional, non-finite, and unsafe dimensions are “尺寸未知”. Assert approximate status is `false` for valid but wrong-ratio dimensions and for invalid dimensions.

- [ ] **Step 2: Run the classifier test and verify red**

Run:

```bash
node --test tests/featured-image-rules.test.js
```

Expected: FAIL because `isApproximatelySixteenNine` is absent, `1600×900` and `1672×941` are rejected, and the low tier still says `1K / 1080p`.

- [ ] **Step 3: Implement integer tolerance and the new minimum**

Add focused constants and a `BigInt` absolute helper:

```js
const RATIO_TOLERANCE_NUMERATOR = 5n;
const RATIO_TOLERANCE_DENOMINATOR = 1000n;

function absoluteBigInt(value) {
  return value < 0n ? -value : value;
}
```

Inside `classifyFeaturedImage()`, calculate both ratio properties without division:

```js
const widthBigInt = hasDimensions ? BigInt(width) : 0n;
const heightBigInt = hasDimensions ? BigInt(height) : 0n;
const ratioDifference = hasDimensions
  ? absoluteBigInt(widthBigInt * 9n - heightBigInt * 16n)
  : 0n;
const isExactSixteenNine = hasDimensions && ratioDifference === 0n;
const isApproximatelySixteenNine = hasDimensions
  && ratioDifference * RATIO_TOLERANCE_DENOMINATOR
    <= heightBigInt * 16n * RATIO_TOLERANCE_NUMERATOR;
const meetsMinimum = hasDimensions && width >= 1600 && height >= 900;
const eligible = isApproximatelySixteenNine && meetsMinimum;
```

Use `isApproximatelySixteenNine` in the rejection reason, return it next to `isExactSixteenNine`, and change the `1k` visible quality label to `HD+ / 900p+`. Keep the `4k`, `2k`, and `1k` internal keys and both-axis tier thresholds unchanged.

- [ ] **Step 4: Run the classifier test and verify green**

Run:

```bash
node --test tests/featured-image-rules.test.js
```

Expected: all classifier tests PASS.

- [ ] **Step 5: Commit the classifier slice**

```bash
git add src/shared/featured-image-rules.js tests/featured-image-rules.test.js
git commit -m "feat: allow near-16-9 featured images"
```

### Task 2: Align Repository and admin API enforcement

**Files:**
- Modify: `tests/site-settings-repository.test.js`
- Modify: `tests/site-api.test.js`
- Modify: `src/server/gallery-repository.js`

- [ ] **Step 1: Write failing server-boundary tests**

Add Repository coverage proving the actual requested dimensions persist:

```js
test("setFeaturedImages accepts a near-16:9 HD+ image", async () => {
  const repository = createGalleryRepository(createTestDb());
  const image = await createImage(repository, "rounded-export", {
    width: 1672,
    height: 941,
  });

  await repository.setFeaturedImages([image.id]);
  assert.deepEqual(
    (await repository.listFeaturedImages()).map(({ id, width, height }) => ({ id, width, height })),
    [{ id: image.id, width: 1672, height: 941 }],
  );
});
```

Change both Repository rejection expectations and the admin API rejection expectation to:

```js
/within 0\.5% of 16:9 and at least 1600x900/
```

In the existing successful admin PATCH test, create the first returned featured item at `1672×941`, then assert:

```js
assert.equal(payload.featuredImages[0].featuredEligibility?.dimensions, "1672×941");
assert.equal(payload.featuredImages[0].featuredEligibility?.isExactSixteenNine, false);
assert.equal(payload.featuredImages[0].featuredEligibility?.isApproximatelySixteenNine, true);
assert.equal(payload.featuredImages[0].featuredEligibility?.eligible, true);
assert.equal(payload.featuredImages[0].featuredEligibility?.qualityLabel, "HD+ / 900p+");
```

- [ ] **Step 2: Run server tests and verify red**

Run:

```bash
node --test tests/site-settings-repository.test.js tests/site-api.test.js
```

Expected: FAIL on the old Repository error text. The near-ratio acceptance assertions exercise the shared classifier through the real Repository and API paths.

- [ ] **Step 3: Update the authoritative Repository error**

Replace the old validation message with:

```js
throw new RangeError(
  `featured images must be within 0.5% of 16:9 and at least 1600x900: ${invalidIds.join(", ")}`,
);
```

Do not duplicate the ratio formula in the Repository; it must continue calling `classifyFeaturedImage()`.

- [ ] **Step 4: Run server tests and verify green**

Run:

```bash
node --test tests/site-settings-repository.test.js tests/site-api.test.js
```

Expected: all Repository and site API tests PASS, including rollback checks.

- [ ] **Step 5: Commit the server slice**

```bash
git add src/server/gallery-repository.js tests/site-settings-repository.test.js tests/site-api.test.js
git commit -m "fix: align featured image server validation"
```

### Task 3: Update picker labels, guidance, and Cloudflare cache chain

**Files:**
- Modify: `tests/site-settings-controller.test.js`
- Modify: `tests/templates.test.js`
- Modify: `public/assets/admin/site-settings.js`
- Modify: `public/assets/admin/settings-page.js`
- Modify: `public/admin/settings.html`

- [ ] **Step 1: Write failing picker and cache tests**

Change the `1k` candidate fixture to use `qualityLabel: "HD+ / 900p+"` and dimensions `1672×941`. Require the controller source to contain:

```js
assert.match(controllerSource, /接近 16:9（误差不超过 0\.5%）且至少 1600×900/);
assert.match(controllerSource, /label: "HD\+ \/ 900p\+"/);
```

Update the admin cache test so unchanged library modules and settings CSS remain on `20260715-featured-filter-separation`, while these two JavaScript references use `20260716-approximate-featured-ratio`:

```js
const featuredRatioVersion = "20260716-approximate-featured-ratio";
assert.equal(
  settingsHtml.match(/src="\/assets\/admin\/settings-page\.js\?v=([^"]+)"/)[1],
  featuredRatioVersion,
);
assert.equal(
  settingsEntry.match(/from "\.\/site-settings\.js\?v=([^"]+)"/)[1],
  featuredRatioVersion,
);
```

- [ ] **Step 2: Run picker and template tests and verify red**

Run:

```bash
node --test tests/site-settings-controller.test.js tests/templates.test.js
```

Expected: FAIL because the visible low tier, picker guidance, and settings JavaScript cache token are still old.

- [ ] **Step 3: Update the picker and targeted cache versions**

In `public/assets/admin/site-settings.js`, change both low-tier labels to `HD+ / 900p+` and replace the picker rule with:

```html
<p class="site-picker-rule">接近 16:9（误差不超过 0.5%）且至少 1600×900 可加入轮播。当前已选但不合规的旧图片需在当前精选列表中移除。</p>
```

Set the query token on the `site-settings.js` import in `public/assets/admin/settings-page.js` and the `settings-page.js` script in `public/admin/settings.html` to `20260716-approximate-featured-ratio`. Leave unchanged CSS and library assets on their existing token.

- [ ] **Step 4: Run picker and template tests and verify green**

Run:

```bash
node --test tests/site-settings-controller.test.js tests/templates.test.js
```

Expected: all picker and template tests PASS.

- [ ] **Step 5: Commit the admin slice**

```bash
git add public/assets/admin/site-settings.js public/assets/admin/settings-page.js public/admin/settings.html tests/site-settings-controller.test.js tests/templates.test.js
git commit -m "fix: expose near-ratio featured candidates"
```

### Task 4: Update the living feature document

**Files:**
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`

- [ ] **Step 1: Update current behavior and terminology**

Record all of the following in the current implementation section and acceptance checklist:

- eligibility is within `±0.5%` of `16:9` and at least `1600×900`;
- `1672×941` is the representative accepted rounded export;
- the visible tiers are `HD+ / 900p+`, `2K`, and `4K`, while the low internal key remains `1k`;
- the settings JavaScript chain uses `20260716-approximate-featured-ratio` and unchanged admin assets retain the previous token;
- no D1 migration or image-content read is involved;
- Hero remains exact `16:9` with `contain`, so near-ratio images can have a very thin letterbox edge without cropping or distortion.

- [ ] **Step 2: Check current-code wording**

Run:

```bash
rg -n "exact 16:9 and at least 1920x1080|仅精确 16:9|1K / 1080p|1K/1080p" src functions public tests docs/2026-07-14-hero-featured-and-public-polish.md
```

Expected: no matches.

- [ ] **Step 3: Commit the documentation slice**

```bash
git add docs/2026-07-14-hero-featured-and-public-polish.md
git commit -m "docs: record near-ratio featured image support"
```

### Task 5: Verify the complete change without accessing images

**Files:**
- Verify only; do not open, download, decode, screenshot, or inspect image files.

- [ ] **Step 1: Run syntax checks for changed JavaScript**

Run:

```bash
node --check src/shared/featured-image-rules.js
node --check src/server/gallery-repository.js
node --check public/assets/admin/site-settings.js
node --check public/assets/admin/settings-page.js
```

Expected: every command exits 0 with no output.

- [ ] **Step 2: Run all focused tests**

Run:

```bash
node --test tests/featured-image-rules.test.js tests/site-settings-repository.test.js tests/site-api.test.js tests/site-settings-controller.test.js tests/templates.test.js
```

Expected: all focused tests PASS with 0 failures.

- [ ] **Step 3: Run the full suite**

Run:

```bash
npm test
```

Expected: all tests PASS with 0 failures.

- [ ] **Step 4: Verify patch hygiene and scope**

Run:

```bash
git diff --check 37d06f1..HEAD
git status --short
```

Expected: committed task changes have no whitespace errors. Status shows only the unrelated pre-existing user changes listed in the File Map; no task file remains uncommitted.

- [ ] **Step 5: Review the resulting commits**

Run:

```bash
git log --oneline 37d06f1..HEAD
git diff --stat 37d06f1..HEAD
```

Expected: focused classifier, server, admin, and documentation commits; no D1 migration and no unrelated user file is included.
