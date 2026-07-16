# Featured Resolution Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将精选候选图片稳定划分为 4K、2K、1K、其他四个互斥档位，并让“从图片库添加”弹层只显示这四个筛选器。

**Architecture:** `src/shared/featured-image-rules.js` 继续作为轮播资格与分辨率档位的唯一真源，管理员 API 通过现有 `toApiImage()` 自动透传分类结果。`public/assets/admin/site-settings.js` 只消费 `featuredEligibility.resolutionTier` 进行候选筛选，保留服务端保存校验和当前精选顺序逻辑。静态资源使用统一的新版本号确保 Cloudflare 不返回旧筛选代码。

**Tech Stack:** JavaScript ES modules、Node.js built-in test runner、Cloudflare Pages Functions、D1、静态 HTML/CSS。

---

## File Map

- Modify: `src/shared/featured-image-rules.js` — 定义四档分辨率分类和显示标签。
- Modify: `tests/featured-image-rules.test.js` — 锁定分类边界、近似 16:9 和无效尺寸行为。
- Modify: `tests/site-api.test.js` — 验证管理员 API 对 1672×941 返回 `other`。
- Modify: `public/assets/admin/site-settings.js` — 渲染四个候选筛选器、默认 4K，并处理未知档位。
- Modify: `public/assets/admin/settings.css` — 为“其他”候选卡片增加独立档位样式。
- Modify: `tests/site-settings-controller.test.js` — 验证四档过滤、按钮文案、默认档位和选择状态契约。
- Modify: `public/assets/admin/featured-page.js` — 更新 `site-settings.js` 的缓存版本。
- Modify: `public/admin/featured.html` — 更新精选脚本与共享 CSS 的缓存版本。
- Modify: `public/admin/settings.html` — 更新共享 CSS 的缓存版本。
- Modify: `tests/templates.test.js` — 锁定所有变更资源使用同一发布版本。

### Task 1: Split shared eligibility metadata into four resolution tiers

**Files:**
- Modify: `tests/featured-image-rules.test.js`
- Modify: `tests/site-api.test.js`
- Modify: `src/shared/featured-image-rules.js`

- [ ] **Step 1: Write failing shared-rule tests**

Replace the first test in `tests/featured-image-rules.test.js` with:

```js
test("featured eligibility splits near-16:9 images into four resolution tiers", () => {
  assert.deepEqual(classifyFeaturedImage({ width: 1600, height: 900 }), {
    dimensions: "1600×900",
    isExactSixteenNine: true,
    isApproximatelySixteenNine: true,
    meetsMinimum: true,
    eligible: true,
    is4K: false,
    resolutionTier: "other",
    qualityLabel: "其他",
    statusLabel: "轮播可用",
    reason: null,
  });

  const roundedExport = classifyFeaturedImage({ width: 1672, height: 941 });
  assert.equal(roundedExport.isExactSixteenNine, false);
  assert.equal(roundedExport.isApproximatelySixteenNine, true);
  assert.equal(roundedExport.eligible, true);
  assert.equal(roundedExport.resolutionTier, "other");
  assert.equal(roundedExport.qualityLabel, "其他");

  assert.equal(classifyFeaturedImage({ width: 1920, height: 1080 }).resolutionTier, "1k");
  assert.equal(classifyFeaturedImage({ width: 1920, height: 1080 }).qualityLabel, "1K");
  assert.equal(classifyFeaturedImage({ width: 2560, height: 1440 }).resolutionTier, "2k");
  assert.equal(classifyFeaturedImage({ width: 3200, height: 1800 }).resolutionTier, "2k");
  assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).resolutionTier, "4k");
  assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).is4K, true);
  assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).resolutionTier, "4k");
  assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).is4K, true);
});
```

- [ ] **Step 2: Add failing API assertions for the `other` tier**

In `tests/site-api.test.js`, immediately after the existing 1672×941 eligibility assertions, replace the old quality assertion with:

```js
  assert.equal(payload.featuredImages[0].featuredEligibility?.resolutionTier, "other");
  assert.equal(payload.featuredImages[0].featuredEligibility?.qualityLabel, "其他");
```

- [ ] **Step 3: Run the focused tests and verify the expected failure**

Run:

```powershell
node --test tests/featured-image-rules.test.js tests/site-api.test.js
```

Expected: FAIL because 1600×900 and 1672×941 still return `resolutionTier: "1k"` and `qualityLabel: "HD+ / 900p+"`.

- [ ] **Step 4: Implement the minimal four-tier classifier**

In `src/shared/featured-image-rules.js`, replace the `resolutionTier` and `qualityLabel` expressions with:

```js
  const resolutionTier = !eligible
    ? null
    : width >= 3840 && height >= 2160
      ? "4k"
      : width >= 2560 && height >= 1440
        ? "2k"
        : width >= 1920 && height >= 1080
          ? "1k"
          : "other";
  const is4K = resolutionTier === "4k";
  const qualityLabel = resolutionTier === "4k"
    ? "4K"
    : resolutionTier === "2k"
      ? "2K"
      : resolutionTier === "1k"
        ? "1K"
        : resolutionTier === "other"
          ? "其他"
          : null;
```

- [ ] **Step 5: Run focused tests and syntax validation**

Run:

```powershell
node --check src/shared/featured-image-rules.js
node --test tests/featured-image-rules.test.js tests/site-api.test.js
```

Expected: both commands exit 0; all focused tests pass.

- [ ] **Step 6: Commit the shared classification change**

```powershell
git add -- src/shared/featured-image-rules.js tests/featured-image-rules.test.js tests/site-api.test.js
git commit -m "feat: split featured resolution tiers"
```

### Task 2: Replace the candidate picker with four visible filters

**Files:**
- Modify: `tests/site-settings-controller.test.js`
- Modify: `public/assets/admin/site-settings.js`
- Modify: `public/assets/admin/settings.css`

- [ ] **Step 1: Extend the candidate fixture with `other` and the new 1K label**

In `tests/site-settings-controller.test.js`, replace the `labels` and `dimensions` objects inside `candidate()` with:

```js
  const labels = {
    other: "其他",
    "1k": "1K",
    "2k": "2K",
    "4k": "4K",
  };
  const dimensions = {
    other: "1672×941",
    "1k": "1920×1080",
    "2k": "2560×1440",
    "4k": "3840×2160",
  };
```

- [ ] **Step 2: Write failing four-tier filtering assertions**

Replace the test named `featured candidates exclude every invalid record and split into resolution tiers` with:

```js
test("featured candidates exclude invalid records and split into four resolution tiers", () => {
  const images = [
    candidate(1, "other"),
    candidate(2, "1k"),
    candidate(3, "2k"),
    candidate(4, "4k"),
    { id: 5, featuredEligibility: { eligible: false, resolutionTier: null, reason: "比例不符" } },
    { id: 6, featuredEligibility: { eligible: false, resolutionTier: null, reason: "尺寸未知" } },
    { id: 7, featuredEligibility: { eligible: true, resolutionTier: null } },
    { id: 8, featuredEligibility: { eligible: true, resolutionTier: "future" } },
    { id: 9 },
  ];

  assert.deepEqual(filterFeaturedCandidates(images, "all").map(({ id }) => id), [1, 2, 3, 4]);
  assert.deepEqual(filterFeaturedCandidates(images, "4k").map(({ id }) => id), [4]);
  assert.deepEqual(filterFeaturedCandidates(images, "2k").map(({ id }) => id), [3]);
  assert.deepEqual(filterFeaturedCandidates(images, "1k").map(({ id }) => id), [2]);
  assert.deepEqual(filterFeaturedCandidates(images, "other").map(({ id }) => id), [1]);
  assert.deepEqual(filterFeaturedCandidates(images, "unsupported"), []);
});
```

- [ ] **Step 3: Write failing UI-contract assertions**

Replace the test named `picker owns independent tier controls and cross-tier selection state` with:

```js
test("picker exposes only four resolution controls and defaults to 4K", () => {
  assert.match(controllerSource, /接近 16:9（误差不超过 0\.5%）且至少 1600×900 可加入轮播/);
  assert.match(controllerSource, /label: "4K"/);
  assert.match(controllerSource, /label: "2K"/);
  assert.match(controllerSource, /label: "1K"/);
  assert.match(controllerSource, /label: "其他"/);
  assert.match(controllerSource, /let activeTier = "4k"/);
  assert.match(controllerSource, /selectedCandidateIds/);
  assert.doesNotMatch(controllerSource, /全部可用|HD\+ \/ 900p\+/);
});
```

In the CSS-contract test, add:

```js
  assert.match(settingsCss, /\.site-picker-card\.is-other/);
```

- [ ] **Step 4: Run the controller tests and verify the expected failure**

Run:

```powershell
node --test tests/site-settings-controller.test.js
```

Expected: FAIL because `other` is not accepted, unsupported filters fall back to all candidates, the old labels remain, and the picker defaults to `all`.

- [ ] **Step 5: Implement four-tier front-end metadata**

At the top of `public/assets/admin/site-settings.js`, replace the tier constants with:

```js
const RESOLUTION_TIERS = new Set(["4k", "2k", "1k", "other"]);
const TIER_LABELS = {
  "4k": "4K",
  "2k": "2K",
  "1k": "1K",
  other: "其他",
};
const PICKER_FILTERS = [
  { value: "4k", label: "4K" },
  { value: "2k", label: "2K" },
  { value: "1k", label: "1K" },
  { value: "other", label: "其他" },
];
```

Replace `filterFeaturedCandidates()` with:

```js
export function filterFeaturedCandidates(images, tier = "all") {
  const normalizedTier = tier === "all"
    ? "all"
    : RESOLUTION_TIERS.has(tier)
      ? tier
      : null;
  if (!normalizedTier) return [];

  return (Array.isArray(images) ? images : []).filter((image) => {
    const eligibility = image?.featuredEligibility;
    if (
      eligibility?.eligible !== true
      || !RESOLUTION_TIERS.has(eligibility.resolutionTier)
    ) {
      return false;
    }
    return normalizedTier === "all" || eligibility.resolutionTier === normalizedTier;
  });
}
```

In `openPicker()`, change active button rendering and the initial tier to:

```js
            <button class="site-picker-filter${value === "4k" ? " is-active" : ""}" type="button" data-picker-tier="${value}" aria-pressed="${value === "4k"}">
```

```js
      let activeTier = "4k";
```

- [ ] **Step 6: Add the `other` candidate-card style**

In `public/assets/admin/settings.css`, after `.site-picker-card.is-1k`, add:

```css
.site-picker-card.is-other {
  border-left-color: #a47a45;
}
```

- [ ] **Step 7: Run focused tests and JavaScript syntax checks**

Run:

```powershell
node --check public/assets/admin/site-settings.js
node --test tests/site-settings-controller.test.js
```

Expected: both commands exit 0; all controller tests pass.

- [ ] **Step 8: Commit the picker behavior**

```powershell
git add -- public/assets/admin/site-settings.js public/assets/admin/settings.css tests/site-settings-controller.test.js
git commit -m "feat: filter featured candidates by four tiers"
```

### Task 3: Invalidate Cloudflare static-asset caches

**Files:**
- Modify: `tests/templates.test.js`
- Modify: `public/assets/admin/featured-page.js`
- Modify: `public/admin/featured.html`
- Modify: `public/admin/settings.html`

- [ ] **Step 1: Write the failing cache-version test**

In `tests/templates.test.js`, keep the library references under `filterSeparationVersion`, remove both `settings.css` references from `unchangedReferences`, and add this block before the existing navigation-version assertions:

```js
  const resolutionFilterVersion = "20260717-featured-resolution-filters";
  const resolutionFilterReferences = [
    [settingsHtml, /href="\/assets\/admin\/settings\.css\?v=([^"]+)"/, "settings.css"],
    [featuredHtml, /href="\/assets\/admin\/settings\.css\?v=([^"]+)"/, "featured settings.css"],
    [featuredHtml, /src="\/assets\/admin\/featured-page\.js\?v=([^"]+)"/, "featured-page.js"],
    [featuredEntry, /from "\.\/site-settings\.js\?v=([^"]+)"/, "site-settings.js"],
  ];
  const resolutionFilterVersions = resolutionFilterReferences.map(([source, pattern, asset]) => {
    const match = source.match(pattern);
    assert.ok(match, `${asset} must include a cache-busting release version`);
    return match[1];
  });
  assert.deepEqual(
    resolutionFilterVersions,
    Array(resolutionFilterReferences.length).fill(resolutionFilterVersion),
  );
```

Remove the old `featuredLoadGuardVersion`, `guardReferences`, `guardVersions`, and their assertion because those two references now belong to the new release group.

- [ ] **Step 2: Run the template test and verify the expected failure**

Run:

```powershell
node --test tests/templates.test.js
```

Expected: FAIL because the HTML and import URLs still use the 20260715/20260716 versions.

- [ ] **Step 3: Apply the unified release version**

Use `20260717-featured-resolution-filters` in exactly these four locations:

```html
<!-- public/admin/featured.html -->
<link rel="stylesheet" href="/assets/admin/settings.css?v=20260717-featured-resolution-filters" />
<script type="module" src="/assets/admin/featured-page.js?v=20260717-featured-resolution-filters"></script>
```

```html
<!-- public/admin/settings.html -->
<link rel="stylesheet" href="/assets/admin/settings.css?v=20260717-featured-resolution-filters" />
```

```js
// public/assets/admin/featured-page.js
import { createSiteSettingsController } from "./site-settings.js?v=20260717-featured-resolution-filters";
```

- [ ] **Step 4: Run template and entry-module checks**

Run:

```powershell
node --check public/assets/admin/featured-page.js
node --test tests/templates.test.js tests/featured-page.test.js
```

Expected: both commands exit 0; all template and featured-entry tests pass.

- [ ] **Step 5: Commit cache invalidation**

```powershell
git add -- public/admin/featured.html public/admin/settings.html public/assets/admin/featured-page.js tests/templates.test.js
git commit -m "chore: refresh featured filter assets"
```

### Task 4: Full verification and production-safe handoff

**Files:**
- Verify only: all files changed in Tasks 1–3

- [ ] **Step 1: Run all syntax checks for changed JavaScript modules**

```powershell
node --check src/shared/featured-image-rules.js
node --check public/assets/admin/site-settings.js
node --check public/assets/admin/featured-page.js
```

Expected: every command exits 0 with no syntax errors.

- [ ] **Step 2: Run the complete automated test suite**

```powershell
npm test
```

Expected: exit 0 with every Node test passing. Do not run image-content, screenshot, browser-vision, or gallery-download checks.

- [ ] **Step 3: Review only the intended diff and preserve unrelated work**

```powershell
git status --short
git diff --check HEAD~3..HEAD
git diff --stat HEAD~3..HEAD
```

Expected: the three feature commits contain only the files listed in this plan. Existing unrelated modifications such as `README.md`, `package.json`, `.playwright-mcp/`, `tools/`, and codex-turn-cleaner files remain uncommitted and unchanged.

- [ ] **Step 4: Push the feature commits after explicit merge/deploy approval**

```powershell
git push origin main
```

Expected: push succeeds; the repository's Cloudflare Pages Git integration starts a production deployment.

- [ ] **Step 5: Verify deployed text assets without requesting images**

After deployment is successful, fetch only HTML and JavaScript text:

```powershell
curl.exe -L --fail --silent --show-error "https://gallery.140079.xyz/admin/featured.html"
curl.exe -L --fail --silent --show-error "https://gallery.140079.xyz/assets/admin/site-settings.js?v=20260717-featured-resolution-filters"
```

Expected: HTML references `20260717-featured-resolution-filters`; JavaScript contains the four labels `4K`, `2K`, `1K`, `其他`, defaults `activeTier` to `4k`, and contains no `全部可用` or `HD+ / 900p+`. Do not authenticate, invoke `/api/admin/images`, request image URLs, take screenshots, or decode image data.
