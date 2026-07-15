# Admin Featured Filter Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图片库只按搜索与标签匹配筛选，并把只显示合规图片的 4K/2K/1K 轮播候选筛选独立放入站点设置选择器。

**Architecture:** `classifyFeaturedImage()` 是唯一像素分档来源并向管理 API 输出 `resolutionTier`；图片库状态完全忽略轮播字段；站点选择器先过滤 `eligible` 与合法档位，再在本地切换分辨率档。Repository 保存时继续执行权威资格校验。

**Tech Stack:** 原生 JavaScript ES modules、静态 HTML/CSS、Cloudflare Pages Functions、Node.js `node:test`

**Privacy Constraint:** 所有浏览器验收阻断 image 请求，只检查 DOM、宽高元数据和接口时序，不查看、截图或分析图片内容。

---

## File map

- Modify: `src/shared/featured-image-rules.js` — 增加 4K/2K/1K 阈值档位。
- Modify: `tests/featured-image-rules.test.js` — 分档边界与异常输入测试。
- Modify: `public/admin/index.html` — 删除图片库轮播规格控件。
- Modify: `public/assets/admin/library-state.js` — 删除 featured filter 状态。
- Modify: `public/assets/admin/library-page.js` — 删除轮播控件绑定，详情只显示中性宽高。
- Modify: `public/assets/admin/renderers/image-card.js` — 删除图片卡轮播资格覆盖层。
- Modify: `public/assets/admin/workbench.css` — 删除图库轮播筛选/徽章样式。
- Modify: `tests/admin-library.test.js`、`tests/templates.test.js` — 锁定图库只做标签筛选。
- Modify: `public/assets/admin/site-settings.js` — 合规候选、档位筛选、跨档选择和 legacy 保留。
- Modify: `public/assets/admin/settings.css` — 候选筛选按钮、计数、空状态。
- Modify: `tests/site-settings-controller.test.js` — 候选过滤、分档和合并回归。
- Modify: `public/admin/settings.html` 与相关模块 import — 统一缓存版本。
- Modify: `docs/superpowers/specs/2026-07-15-admin-featured-filter-separation-design.md` — 实施证据。

### Task 1: 扩展共享分辨率分类

**Files:**
- Modify: `tests/featured-image-rules.test.js`
- Modify: `src/shared/featured-image-rules.js`

- [ ] **Step 1: 写 4K/2K/1K 分档失败测试**

断言完整返回中包含：

```js
assert.equal(classifyFeaturedImage({ width: 1920, height: 1080 }).resolutionTier, "1k");
assert.equal(classifyFeaturedImage({ width: 2560, height: 1440 }).resolutionTier, "2k");
assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).resolutionTier, "4k");
assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).resolutionTier, "4k");
assert.equal(classifyFeaturedImage({ width: 1920, height: 1200 }).resolutionTier, null);
```

同时断言 `qualityLabel` 为 `1K / 1080p`、`2K`、`4K`，`is4K` 等于是否属于 4K 档。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/featured-image-rules.test.js`

Expected: FAIL，当前没有 `resolutionTier`，且 8K 不属于 4K 档。

- [ ] **Step 3: 实现最小分档逻辑**

在 `eligible` 后计算：

```js
const resolutionTier = !eligible
  ? null
  : width >= 3840 && height >= 2160
    ? "4k"
    : width >= 2560 && height >= 1440
      ? "2k"
      : "1k";
```

让 `is4K = resolutionTier === "4k"`，并从档位映射 `qualityLabel`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `node --test tests/featured-image-rules.test.js tests/site-api.test.js`

Expected: 全部 PASS，管理 API 自动携带新字段，公开 API 仍不包含资格对象。

- [ ] **Step 5: 提交**

```powershell
git add src/shared/featured-image-rules.js tests/featured-image-rules.test.js
git commit -m "feat: classify featured resolution tiers"
```

### Task 2: 从图片库移除轮播筛选职责

**Files:**
- Modify: `tests/admin-library.test.js`
- Modify: `tests/templates.test.js`
- Modify: `public/admin/index.html`
- Modify: `public/assets/admin/library-state.js`
- Modify: `public/assets/admin/library-page.js`
- Modify: `public/assets/admin/renderers/image-card.js`
- Modify: `public/assets/admin/workbench.css`

- [ ] **Step 1: 将图片库测试改为目标契约并确认 RED**

删除 featured 组合筛选预期，新增断言：`getFilters()` 只含 `query/tagNames/sort`；`setFeaturedFilter` 不存在；模板不含 `featured-filter` 或“轮播规格”；卡片不含 `image-featured-badge`、`轮播可用` 或不合规原因；标签交集行为不变。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/admin-library.test.js tests/templates.test.js`

Expected: FAIL，因为当前 HTML、状态和卡片仍含轮播筛选。

- [ ] **Step 3: 删除图片库 featured 状态和 DOM 绑定**

`filterImages()` 只返回：

```js
return matchesQuery && matchesTags;
```

删除 `featuredFilter`、`setFeaturedFilter()`、`featuredFilters` DOM 引用、`syncFeaturedFilters()` 和 radio change handler。`resetFilters()` 只清空 query/tag。

- [ ] **Step 4: 删除卡片覆盖层并保留中性宽高详情**

从 `renderImageCard()` 删除 `renderFeaturedBadge()`；详情用 `image.width` 与 `image.height` 渲染 `宽×高` 或“尺寸未知”，不显示“轮播可用”“比例不符”等资格文案。

- [ ] **Step 5: 删除 HTML 与 CSS 中对应控件/样式**

移除 `featured-filter-heading`、三个 radio、`.featured-filter-list`、`.filter-featured-option`、`.image-featured-*`；标签筛选样式保持不变。

- [ ] **Step 6: 运行测试并确认 GREEN**

Run: `node --test tests/admin-library.test.js tests/templates.test.js`

Expected: PASS，原有标签交集、搜索、排序、分页和选择回归保持通过。

- [ ] **Step 7: 提交**

```powershell
git add public/admin/index.html public/assets/admin/library-state.js public/assets/admin/library-page.js public/assets/admin/renderers/image-card.js public/assets/admin/workbench.css tests/admin-library.test.js tests/templates.test.js
git commit -m "refactor: keep library filters tag focused"
```

### Task 3: 在站点设置建立独立候选档位筛选

**Files:**
- Modify: `tests/site-settings-controller.test.js`
- Modify: `public/assets/admin/site-settings.js`
- Modify: `public/assets/admin/settings.css`

- [ ] **Step 1: 写候选过滤与 legacy 保留失败测试**

新增纯函数目标：

```js
assert.deepEqual(filterFeaturedCandidates(images, "all").map(({ id }) => id), [1, 2, 3]);
assert.deepEqual(filterFeaturedCandidates(images, "4k").map(({ id }) => id), [3]);
assert.deepEqual(filterFeaturedCandidates(images, "2k").map(({ id }) => id), [2]);
assert.deepEqual(filterFeaturedCandidates(images, "1k").map(({ id }) => id), [1]);
```

输入同时包含比例不符、尺寸未知和 `eligible:true` 但缺失合法 tier 的记录，断言它们不在 `all`。更新合并测试：不在候选集中的当前 legacy 图片即使不出现在 `selectedIds` 也必须保留。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/site-settings-controller.test.js`

Expected: FAIL，因为过滤函数和独立档位 UI 尚不存在，当前 picker 仍渲染不合规卡片。

- [ ] **Step 3: 实现候选纯函数与安全合并**

```js
const RESOLUTION_TIERS = new Set(["4k", "2k", "1k"]);

export function filterFeaturedCandidates(images, tier = "all") {
  const normalizedTier = RESOLUTION_TIERS.has(tier) ? tier : "all";
  return images.filter((image) => {
    const eligibility = image.featuredEligibility;
    if (eligibility?.eligible !== true || !RESOLUTION_TIERS.has(eligibility.resolutionTier)) return false;
    return normalizedTier === "all" || eligibility.resolutionTier === normalizedTier;
  });
}
```

`mergeFeaturedSelection()` 先保留“不属于候选集的当前项”，再保留已勾选的当前候选，最后按候选顺序追加新项。

- [ ] **Step 4: 让 picker 只创建合规候选 DOM**

`openPicker()` 请求图片后先得到 `candidateImages = filterFeaturedCandidates(images)`；HTML 只映射该数组。顶部渲染四个互斥按钮及数量，网格为空时显示 `.site-picker-empty`。候选卡只显示尺寸与档位，不显示禁用态或“不符合”原因。

- [ ] **Step 5: 保持跨档选择状态**

用 `selectedCandidateIds` Set 保存所有档位的 checkbox change；切换按钮前后由该 Set 回填 checked。确认时把整个 Set 交给 `mergeFeaturedSelection(draft.featuredImages, candidateImages, [...selectedCandidateIds])`。

- [ ] **Step 6: 增加筛选控件样式**

添加 `.site-picker-filters`、`.site-picker-filter.is-active`、`.site-picker-filter-count`、`.site-picker-empty`，继续保留当前精选 legacy 警告样式。

- [ ] **Step 7: 运行测试并确认 GREEN**

Run: `node --test tests/site-settings-controller.test.js tests/featured-image-rules.test.js`

Expected: PASS；不合规候选不会渲染，三档正确，legacy 保留。

- [ ] **Step 8: 提交**

```powershell
git add public/assets/admin/site-settings.js public/assets/admin/settings.css tests/site-settings-controller.test.js
git commit -m "feat: filter featured candidates by resolution"
```

### Task 4: 更新缓存契约、全量验收与规格证据

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/admin/settings.html`
- Modify: `public/assets/admin/library-page.js`
- Modify: `public/assets/admin/settings-page.js`
- Modify: `tests/templates.test.js`
- Modify: `docs/superpowers/specs/2026-07-15-admin-featured-filter-separation-design.md`

- [ ] **Step 1: 先更新缓存版本测试并确认 RED**

把管理端变更资产的期望 token 固定为 `20260715-featured-filter-separation`，运行模板测试确认旧 query token 导致失败。

- [ ] **Step 2: 同步所有变更资产 query token**

两个管理 HTML 的 CSS/入口 module，以及入口 module 内对 `library-state.js`、`image-card.js`、`site-settings.js` 的 import 使用同一 token。

- [ ] **Step 3: 运行全量自动化验证**

Run: `npm test`

Run: `node --check src/shared/featured-image-rules.js`

Run: `node --check public/assets/admin/library-state.js`

Run: `node --check public/assets/admin/library-page.js`

Run: `node --check public/assets/admin/renderers/image-card.js`

Run: `node --check public/assets/admin/site-settings.js`

Run: `node --check public/assets/admin/settings-page.js`

Run: `git diff --check`

Expected: 全部退出 0、测试 0 失败。

- [ ] **Step 4: 执行隐私安全的本地 smoke test**

启动本地 Pages 后，使用不下载图片的 HTTP/DOM 检查确认：图片库没有 `featured-filter`；站点 picker 有四个档位；候选 DOM 数量等于 API 中 `eligible + valid resolutionTier` 的数量；DOM 中不含不合规原因文本。不得截图或访问任何 `img src`。

- [ ] **Step 5: 写实施证据并提交**

规格只记录实际命令、测试数和无图片验收结果。

```powershell
git add public docs tests src functions package.json start-local.cmd start-local.sh migrations README.md
git commit -m "docs: record filter separation verification"
```

