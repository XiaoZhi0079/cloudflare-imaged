# Hero Asset Cache Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让透明 Hero 修复通过带版本的入口资源立即生效，并安全推送到 GitHub/Cloudflare 后完成不查看图片的生产验收。

**Architecture:** 首页只为本次发生变化的 `main.css` 与 `gallery.js` 使用同一个查询版本，保持现有静态资源缓存策略、Pages Functions、D1 与 R2 配置不变。部署仍由 Cloudflare Pages 的 GitHub `main` 集成负责，GitHub Actions 只执行 Node 22 测试。

**Tech Stack:** 原生 HTML、Node.js `node:test`、GitHub Actions、Cloudflare Pages、PowerShell

**Privacy Constraint:** 不截图、不读取图片像素、不使用 OCR/视觉分析；生产验收只读取 HTTP、DOM、类名与计算样式。

---

## File map

- Modify: `tests/templates.test.js` — 锁定 CSS/JS 入口使用相同的非空缓存版本。
- Modify: `public/index.html` — 给本次变更的两个入口资源增加统一查询版本。
- Modify: `docs/cloudflare-pages-deploy.zh-CN.md` — 删除固定 SHA 和易失效状态快照。
- Modify: `docs/repo-sync-notes.zh-CN.md` — 改为以 Git/Cloudflare 实时状态为准。
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md` — 更新测试总数并移除“待发布”临时说明。
- Modify: `docs/superpowers/specs/2026-07-15-hero-asset-cache-deployment-design.md` — 实施后更新状态。

### Task 1: Add the failing entry-asset version contract

**Files:**
- Modify: `tests/templates.test.js`
- Test: `tests/templates.test.js`

- [ ] **Step 1: Write the failing test**

在 `featured hero copy overlays the image without an opaque panel` 测试之后加入：

```js
test("public entry assets share one cache-busting release version", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const cssVersion = index.match(/href="\/assets\/main\.css\?v=([^"]+)"/);
  const scriptVersion = index.match(/src="\/assets\/gallery\.js\?v=([^"]+)"/);

  assert.ok(cssVersion, "main.css must include a non-empty release version");
  assert.ok(scriptVersion, "gallery.js must include a non-empty release version");
  assert.equal(cssVersion[1], scriptVersion[1]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="public entry assets share one cache-busting" tests/templates.test.js
```

Expected: FAIL with `main.css must include a non-empty release version`, because the current URLs have no query version.

- [ ] **Step 3: Commit the failing contract only after RED is recorded**

Do not commit yet; continue directly to Task 2 so the behavior and its regression test remain one atomic change.

### Task 2: Version the changed public entry assets

**Files:**
- Modify: `public/index.html`
- Modify: `tests/templates.test.js`
- Test: `tests/templates.test.js`

- [ ] **Step 1: Add one shared release token**

Change the two entry tags to:

```html
<link rel="stylesheet" href="/assets/main.css?v=20260715-hero-meta" />
<script type="module" src="/assets/gallery.js?v=20260715-hero-meta"></script>
```

Do not version unchanged imports or add a global `_headers` rule.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="public entry assets share one cache-busting" tests/templates.test.js
```

Expected: 1 passed, 0 failed.

- [ ] **Step 3: Run the complete template regression file**

Run:

```powershell
node --test tests/templates.test.js
```

Expected: all template tests pass.

- [ ] **Step 4: Commit the cache behavior**

```powershell
git add -- public/index.html tests/templates.test.js
git commit -m "fix: version hero entry assets for release"
```

### Task 3: Refresh durable deployment records

**Files:**
- Modify: `docs/cloudflare-pages-deploy.zh-CN.md`
- Modify: `docs/repo-sync-notes.zh-CN.md`
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`
- Modify: `docs/superpowers/specs/2026-07-15-hero-asset-cache-deployment-design.md`

- [ ] **Step 1: Replace the deployment guide's stale current-state bullets**

In `docs/cloudflare-pages-deploy.zh-CN.md`, replace the three fixed-state bullets under “第一步” with:

```markdown
- 当前本地与远端差异必须以 `git status --short --branch` 和 `git log origin/main..main` 的实时输出为准。
- Cloudflare Pages 只部署已经普通推送到 GitHub `main` 的提交；本地提交不会自动上线。
- 发布前先确认工作区干净、测试通过，并使用普通快进推送；不得用文档中的历史 SHA 判断当前发布状态。
```

- [ ] **Step 2: Replace the repository sync note's stale snapshot**

In `docs/repo-sync-notes.zh-CN.md`, replace the fixed SHA/uncommitted/old-production bullets with:

```markdown
- 本地分支：`main`
- 远端：`https://github.com/XiaoZhi0079/cloudflare-imaged.git`
- 本地与远端差异以 `git status --short --branch` 和 `git log origin/main..main` 的实时输出为准。
- Cloudflare Pages 生产版本以 GitHub `main` 的最新成功部署为准；不要用本文档中的历史提交号推断线上状态。
```

- [ ] **Step 3: Update verification records**

In `docs/2026-07-14-hero-featured-and-public-polish.md`:

- Remove `（本地已验收，待发布）` from the transparent Hero bullet.
- Change all three test totals from `132` to `133`.

In `docs/superpowers/specs/2026-07-15-hero-asset-cache-deployment-design.md`, change:

```text
状态：已批准，待实施
```

to:

```text
状态：已实施并验证
```

- [ ] **Step 4: Verify stale release snapshots are gone**

Run:

```powershell
rg -n "3bf57a1|Hero 精选、站点配置.*未提交|131 / 131|132 / 132|132 项" docs/cloudflare-pages-deploy.zh-CN.md docs/repo-sync-notes.zh-CN.md docs/2026-07-14-hero-featured-and-public-polish.md
git diff --check
```

Expected: `rg` returns no matches and `git diff --check` exits 0.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- docs/cloudflare-pages-deploy.zh-CN.md docs/repo-sync-notes.zh-CN.md docs/2026-07-14-hero-featured-and-public-polish.md docs/superpowers/specs/2026-07-15-hero-asset-cache-deployment-design.md
git commit -m "docs: refresh gallery deployment guidance"
```

### Task 4: Verify and integrate the release branch

**Files:**
- Verify: repository-wide

- [ ] **Step 1: Run full local verification**

Run:

```powershell
npm test
node --check public/assets/gallery.js
git diff --check
git status --short --branch
```

Expected: 133 tests pass, JavaScript syntax is valid, no whitespace errors exist, and the release branch is clean.

- [ ] **Step 2: Review the complete release diff**

Run `git diff --stat main...HEAD` and `git diff main...HEAD`. Confirm changes are limited to the file map and contain no secrets, generated demo assets, screenshots, or image files.

- [ ] **Step 3: Merge locally into `main`**

Use a fast-forward merge only. After merging, rerun `npm test`, `node --check public/assets/gallery.js`, `git diff --check`, and `git status --short --branch` on `main`. Remove the clean temporary worktree and merged branch only after all 133 tests pass.

### Task 5: Push and monitor the production deployment

**Files:**
- No source changes

- [ ] **Step 1: Reconfirm the remote baseline**

Run:

```powershell
git pull --ff-only
git status --short --branch
```

Expected: no divergence; local `main` remains ahead only by the reviewed release commits.

- [ ] **Step 2: Push normally**

Run:

```powershell
git push origin main
```

Never use `--force` or `--force-with-lease`.

- [ ] **Step 3: Wait for checks**

For the pushed SHA, poll GitHub Actions and commit checks until:

- workflow `CI` is `completed/success`;
- Cloudflare Pages reports a successful production deployment for `main`.

If either fails, stop and report the exact failure. Do not claim production success.

### Task 6: Verify production without viewing images

**Files:**
- No source changes

- [ ] **Step 1: Verify HTTP and versioned assets**

Check `https://gallery.140079.xyz/`, `/api/public/site`, `/assets/main.css?v=20260715-hero-meta`, and `/assets/gallery.js?v=20260715-hero-meta`. Expected: 200 responses; site API content type is JSON; the production HTML references the shared version token.

- [ ] **Step 2: Run desktop DOM/computed-style verification**

Without screenshots or image inspection, evaluate:

```js
() => {
  const hero = document.querySelector("#site-hero");
  const meta = document.querySelector(".hero-meta");
  const controls = document.querySelector("#hero-controls");
  const metaStyle = getComputedStyle(meta);
  const controlsStyle = getComputedStyle(controls);
  return {
    hasFeatured: hero.classList.contains("has-featured"),
    position: metaStyle.position,
    backgroundColor: metaStyle.backgroundColor,
    pointerEvents: metaStyle.pointerEvents,
    metaZIndex: Number(metaStyle.zIndex),
    controlsZIndex: Number(controlsStyle.zIndex),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  };
}
```

If production currently has featured images, expect absolute positioning, transparent background, `pointer-events: none`, meta z-index 1, controls z-index 2, and no horizontal overflow. If production has no featured images, expect `hasFeatured: false`, ordinary flow, and no horizontal overflow; do not alter production selections solely for testing.

- [ ] **Step 3: Repeat at 390px**

Resize to 390px and repeat the same DOM-only expression. Expected: no horizontal overflow and the state-appropriate layout. Do not call screenshot, canvas, OCR, `naturalWidth`, image-view, or vision tools.

- [ ] **Step 4: Report the exact deployed SHA and evidence**

Report GitHub CI, Cloudflare Pages, HTTP, desktop DOM, and 390px DOM results. Explicitly state that no production D1/R2 writes and no image-content inspection occurred.
