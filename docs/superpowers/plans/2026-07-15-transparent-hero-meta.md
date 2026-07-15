# Hero Copy Transparent Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 有精选图片时，将本期名称与大屏文案以完全透明背景叠加在图片左下方，同时保留无精选时的普通布局。

**Architecture:** `renderHero(site)` 以 `has-featured` 类表达是否存在精选图片；CSS 仅在该状态下将 `.hero-meta` 改为绝对定位透明叠加层。轮播状态机、API 与数据结构保持不变，控制按钮继续使用更高层级。

**Tech Stack:** 原生 JavaScript、CSS、Node.js `node:test`、Wrangler Pages 本地运行时

**Privacy Constraint:** 未经用户明确许可，不查看截图或图片内容；只允许源码、DOM 与计算样式验证。

---

## File map

- Modify: `tests/templates.test.js` — 静态回归测试，锁定状态类、透明背景、定位、层级和文字阴影。
- Modify: `public/assets/gallery.js` — 根据精选数量切换 `has-featured`。
- Modify: `public/assets/main.css` — 精选态透明叠加布局与移动端间距。
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md` — 记录修复与最终测试数。
- Modify: `docs/superpowers/specs/2026-07-15-transparent-hero-meta-design.md` — 将状态更新为已实施。

### Task 1: Add the failing overlay contract

**Files:**
- Modify: `tests/templates.test.js`
- Test: `tests/templates.test.js`

- [ ] **Step 1: Write the failing test**

在 `single-image hero controls have an explicit hidden override` 测试之后加入：

```js
test("featured hero copy overlays the image without an opaque panel", () => {
  const css = readFileSync(new URL("../public/assets/main.css", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../public/assets/gallery.js", import.meta.url), "utf8");

  assert.match(gallery, /siteHero\.classList\.toggle\("has-featured", count > 0\)/);
  assert.match(
    css,
    /\.hero-featured\.has-featured\s*\{[^}]*position:\s*relative/,
  );
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-meta\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*72px[^}]*background:\s*transparent[^}]*pointer-events:\s*none/,
  );
  assert.match(
    css,
    /\.hero-featured\.has-featured \.hero-copy\s*\{[^}]*color:\s*#fff[^}]*text-shadow:/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="featured hero copy overlays" tests/templates.test.js
```

Expected: FAIL because `has-featured` and the transparent overlay rules do not exist.

### Task 2: Implement the minimal state and transparent overlay

**Files:**
- Modify: `public/assets/gallery.js`
- Modify: `public/assets/main.css`
- Test: `tests/templates.test.js`

- [ ] **Step 1: Toggle the featured state in `renderHero`**

Immediately after `const count = featuredImages.length;` add:

```js
siteHero.classList.toggle("has-featured", count > 0);
```

This executes before the no-featured early return, so stale overlay state is always removed.

- [ ] **Step 2: Add the desktop transparent overlay rules**

After the base `.hero-featured` rule in `public/assets/main.css`, add:

```css
.hero-featured.has-featured {
  position: relative;
  background: #1a1411;
}

.hero-featured.has-featured .hero-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 72px;
  z-index: 1;
  padding: 0 24px;
  background: transparent;
  pointer-events: none;
}

.hero-featured.has-featured .hero-issue {
  color: rgba(255, 248, 240, 0.78);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.72);
}

.hero-featured.has-featured .hero-copy {
  color: #fff;
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.78);
}
```

The overlay uses no gradient, blur, border, panel color, or background opacity. Existing `.hero-controls { z-index: 2; }` keeps buttons above the text layer.

- [ ] **Step 3: Add the mobile spacing override**

Inside `@media (max-width: 720px)`, after the base `.hero-meta` rule, add:

```css
  .hero-featured.has-featured .hero-meta {
    bottom: 68px;
    padding: 0 18px;
  }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="featured hero copy overlays" tests/templates.test.js
```

Expected: 1 test passed, 0 failed.

- [ ] **Step 5: Run related regressions**

Run:

```powershell
node --test tests/hero-carousel.test.js tests/public-data.test.js tests/templates.test.js
```

Expected: all related tests pass, including single-image control hiding and public fallback behavior.

- [ ] **Step 6: Commit the behavior fix**

```powershell
git add -- public/assets/gallery.js public/assets/main.css tests/templates.test.js
git commit -m "fix: make hero copy overlay transparent"
```

### Task 3: Verify without viewing images and update records

**Files:**
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`
- Modify: `docs/superpowers/specs/2026-07-15-transparent-hero-meta-design.md`

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm test
node --check public/assets/gallery.js
git diff --check
git status --short --branch
```

Expected: all tests pass, JavaScript syntax is valid, no whitespace errors exist, and only the intended documentation changes remain.

- [ ] **Step 2: Run DOM-only browser verification**

Use an isolated local Wrangler/D1 demo environment. Do not call screenshot, image-view, OCR, vision, canvas pixel, `naturalWidth`, or image-content tools. Evaluate only DOM and computed styles:

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

Expected with featured images:

```js
{
  hasFeatured: true,
  position: "absolute",
  backgroundColor: "rgba(0, 0, 0, 0)",
  pointerEvents: "none",
  metaZIndex: 1,
  controlsZIndex: 2,
  horizontalOverflow: false,
}
```

Repeat at 390px viewport width using the same DOM-only expression. Then verify the no-featured state has `hasFeatured: false` and `.hero-meta` is no longer absolutely positioned.

- [ ] **Step 3: Update documentation**

In `docs/2026-07-14-hero-featured-and-public-polish.md`:

- Add a release-safety bullet stating that featured Hero copy now overlays the image with a fully transparent background.
- Update the automated test count from 131 to 132 after the new regression test passes.

In `docs/superpowers/specs/2026-07-15-transparent-hero-meta-design.md`, change:

```text
状态：已批准，待实施
```

to:

```text
状态：已实施并验证
```

- [ ] **Step 4: Commit documentation**

```powershell
git add -- docs/2026-07-14-hero-featured-and-public-polish.md docs/superpowers/specs/2026-07-15-transparent-hero-meta-design.md
git commit -m "docs: record transparent hero overlay verification"
```

- [ ] **Step 5: Deployment checkpoint**

Before pushing, report the local commits and verification results to the user. Push and production deployment require explicit user confirmation. After confirmation, use normal `git push origin main`, wait for GitHub Actions and Cloudflare Pages, then repeat only the DOM/computed-style checks against production—never inspect screenshots or image contents.
