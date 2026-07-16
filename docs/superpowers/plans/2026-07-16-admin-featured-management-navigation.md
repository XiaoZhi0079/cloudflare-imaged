# Standalone Featured Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the mixed admin settings screen into a standalone featured-management page and a taxonomy-only labels/categories page, with a three-item admin navigation.

**Architecture:** Add `/admin/featured.html` and a focused `featured-page.js` entry that reuses the existing featured settings controller and `/api/admin/site`. Then remove all featured/site-mode branches from `settings-page.js`, leaving `/admin/settings.html` responsible only for tags and categories. Keep backend APIs and D1 unchanged, and use targeted cache versions for only the changed JavaScript chain.

**Tech Stack:** Static HTML, JavaScript ES modules, existing admin controllers, Cloudflare Pages Functions, Node.js built-in test runner, source/HTML contract tests.

---

## File map

- Create `public/admin/featured.html` — dedicated featured-management route and form markup.
- Create `public/assets/admin/featured-page.js` — authentication and featured-controller bootstrap only.
- Create `tests/featured-page.test.js` — focused entry-script authentication and dependency contracts.
- Modify `public/admin/index.html` — three-item navigation.
- Modify `public/admin/settings.html` — taxonomy-only content and three-item navigation.
- Modify `public/assets/admin/settings-page.js` — remove site mode and retain taxonomy logic only.
- Modify `public/assets/admin/site-settings.js` — change visible “site settings” language to “featured settings”.
- Modify `tests/templates.test.js` — route ownership, navigation, accessibility, module, and cache contracts.
- Modify `tests/site-settings-controller.test.js` — visible featured-setting language contract.
- Modify `docs/2026-07-14-hero-featured-and-public-polish.md` — current admin information architecture and verification evidence.
- Preserve `docs/superpowers/plans/2026-07-16-admin-featured-management-navigation.md` — this committed execution plan appears in the branch audit relative to design commit `a00bfa8`.

Do not modify or stage the unrelated current changes in `README.md`, `package.json`, `.playwright-mcp/`, `package-lock.json`, `tools/`, the codex-turn-cleaner tests, or its plan/spec files. Do not modify or remove the existing `admin-frontend-refactor` worktree.

### Task 1: Add a working standalone featured-management route

**Files:**
- Create: `tests/featured-page.test.js`
- Modify: `tests/templates.test.js`
- Modify: `tests/site-settings-controller.test.js`
- Create: `public/admin/featured.html`
- Create: `public/assets/admin/featured-page.js`
- Modify: `public/admin/index.html`
- Modify: `public/admin/settings.html`
- Modify: `public/assets/admin/site-settings.js`

- [ ] **Step 1: Write failing route and entry-script tests**

In `tests/templates.test.js`, replace the old “settings page exposes site configuration tab” test with a new featured-page ownership test that fails cleanly before reading the missing file:

```js
test("featured management page owns issue copy and carousel controls", () => {
  const pageUrl = new URL("../public/admin/featured.html", import.meta.url);
  assert.equal(existsSync(pageUrl), true, "featured management page must exist");
  const html = readFileSync(pageUrl, "utf8");
  for (const id of [
    "featured-panel", "site-issue-name", "site-hero-copy",
    "site-add-featured", "site-save", "site-featured-list",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, />精选管理</);
  assert.match(html, />保存精选设置</);
  assert.doesNotMatch(html, /data-settings-tab|taxonomy-list|taxonomy-create/);
});
```

Change the shared-authentication test to iterate over all three pages and require all three navigation destinations:

```js
for (const path of [
  "../public/admin/index.html",
  "../public/admin/featured.html",
  "../public/admin/settings.html",
]) {
  const html = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(html, /id="admin-auth-view"[^>]*hidden/);
  assert.match(html, /id="admin-app"[^>]*hidden/);
  assert.match(html, /id="admin-key"/);
  assert.match(html, /id="admin-login"/);
  assert.match(html, /data-admin-logout/);
  assert.match(html, /href="\/admin\/"/);
  assert.match(html, /href="\/admin\/featured\.html"/);
  assert.match(html, /href="\/admin\/settings\.html"/);
}
```

Extend the page-specific module test to require `settings.css` and `featured-page.js` from the new page.

Create `tests/featured-page.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const entryUrl = new URL("../public/assets/admin/featured-page.js", import.meta.url);

test("featured entry owns authentication and loads only featured settings", () => {
  assert.equal(existsSync(entryUrl), true, "featured entry module must exist");
  const source = readFileSync(entryUrl, "utf8");
  assert.match(source, /createAdminApiClient/);
  assert.match(source, /createAdminKeyStore/);
  assert.match(source, /createSiteSettingsController/);
  assert.match(source, /featuredController\.load\(\)/);
  assert.match(source, /featuredController\.bind\(\)/);
  assert.doesNotMatch(source, /verifyAdminKey|createSettingsState|\/api\/admin\/categories/);
});

test("featured entry handles logout unauthorized and safe load failures", () => {
  const source = readFileSync(entryUrl, "utf8");
  assert.match(source, /onUnauthorized:[\s\S]*keyStore\.clear\(\)[\s\S]*showAuth/);
  assert.match(source, /AdminUnauthorizedError/);
  assert.match(source, /notifier\.error\(messageFor\(error\)\)/);
  assert.match(source, /elements\.logout\.addEventListener/);
  assert.match(source, /keyStore\.get\(\)/);
});
```

In `tests/site-settings-controller.test.js`, add:

```js
test("featured controller uses task-specific settings language", () => {
  assert.match(controllerSource, /精选设置已修改，保存后生效/);
  assert.match(controllerSource, /精选设置已保存/);
  assert.doesNotMatch(controllerSource, /站点设置已修改|站点设置已保存/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/templates.test.js tests/featured-page.test.js tests/site-settings-controller.test.js
```

Expected: FAIL because `featured.html` and `featured-page.js` do not exist and the controller still uses visible “站点设置” language.

- [ ] **Step 3: Create the featured page**

Create `public/admin/featured.html` with the existing login gate, this navigation, and the existing featured form IDs:

```html
<nav class="admin-nav" aria-label="管理页面">
  <a href="/admin/">图片库</a>
  <a class="is-active" href="/admin/featured.html">精选管理</a>
  <a href="/admin/settings.html">标签与分类</a>
</nav>
```

The application body must be:

```html
<main class="settings-page">
  <header class="settings-heading">
    <div><p class="admin-eyebrow">Featured</p><h1>精选管理</h1></div>
  </header>
  <section id="featured-panel" class="settings-panel">
    <div class="site-form">
      <label class="admin-field" for="site-issue-name"><span>本期名字</span><input id="site-issue-name" type="text" maxlength="40" /></label>
      <label class="admin-field" for="site-hero-copy"><span>大屏文案</span><textarea id="site-hero-copy" rows="3" maxlength="240"></textarea></label>
      <div class="site-featured-head">
        <div>
          <h2>轮播精选</h2>
          <p class="admin-muted">手动选择前台大屏展示的图片，顺序即轮播顺序。本期张数由精选数量自动得出。</p>
        </div>
        <div class="site-featured-actions">
          <button id="site-add-featured" type="button">从图片库添加</button>
          <button id="site-save" class="admin-button-primary" type="button">保存精选设置</button>
        </div>
      </div>
      <p id="site-status" class="settings-status" aria-live="polite"></p>
      <div id="site-featured-list" class="site-featured-list"></div>
    </div>
  </section>
</main>
```

Reuse `/assets/admin/admin.css` and `/assets/admin/settings.css?v=20260715-featured-filter-separation`. Load `/assets/admin/featured-page.js?v=20260716-admin-featured-navigation` as the module entry.

- [ ] **Step 4: Create the focused featured entry**

Create `public/assets/admin/featured-page.js` with this complete control flow:

```js
import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createNotifier } from "./notifications.js";
import { createSiteSettingsController } from "./site-settings.js?v=20260716-admin-featured-navigation";

const elements = {
  authView: document.querySelector("#admin-auth-view"),
  app: document.querySelector("#admin-app"),
  loginForm: document.querySelector("#admin-login-form"),
  loginButton: document.querySelector("#admin-login"),
  loginError: document.querySelector("#admin-login-error"),
  keyInput: document.querySelector("#admin-key"),
  passwordToggle: document.querySelector("[data-toggle-password]"),
  logout: document.querySelector("[data-admin-logout]"),
  featuredPanel: document.querySelector("#featured-panel"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(document.querySelector("#admin-dialog-host"));
const notifier = createNotifier(document.querySelector("#admin-toast-host"));

function showAuth(message = "") {
  elements.app.hidden = true;
  elements.authView.hidden = false;
  elements.loginError.textContent = message;
  elements.keyInput.value = keyStore.get();
  requestAnimationFrame(() => elements.keyInput.focus());
}

function showApp() {
  elements.authView.hidden = true;
  elements.app.hidden = false;
}

function messageFor(error) {
  return error?.message || "操作失败，请稍后重试。";
}

const client = createAdminApiClient({
  getKey: () => keyStore.get(),
  onUnauthorized: () => {
    keyStore.clear();
    showAuth("登录状态已失效，请重新输入管理密钥。");
  },
});

const featuredController = createSiteSettingsController({
  root: elements.featuredPanel,
  client,
  dialogs,
  notifier,
});
featuredController.bind();

async function authenticate(key) {
  keyStore.set(key);
  try {
    await featuredController.load();
    showApp();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) return;
    showApp();
    notifier.error(messageFor(error));
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = elements.keyInput.value.trim();
  if (!key) {
    elements.loginError.textContent = "请输入管理密钥。";
    return;
  }
  elements.loginButton.disabled = true;
  elements.loginError.textContent = "";
  try {
    await authenticate(key);
  } finally {
    elements.loginButton.disabled = false;
  }
});

elements.passwordToggle.addEventListener("click", () => {
  const visible = elements.keyInput.type === "text";
  elements.keyInput.type = visible ? "password" : "text";
  elements.passwordToggle.textContent = visible ? "显示" : "隐藏";
  elements.passwordToggle.setAttribute("aria-label", visible ? "显示管理密钥" : "隐藏管理密钥");
});

elements.logout.addEventListener("click", () => {
  keyStore.clear();
  showAuth();
});

if (keyStore.get()) {
  authenticate(keyStore.get());
} else {
  showAuth();
}
```

- [ ] **Step 5: Update navigation and visible featured language**

In both existing admin HTML files, use the same link order. `index.html` marks “图片库” active; `settings.html` temporarily keeps its existing content but marks “标签与分类” active:

```html
<nav class="admin-nav" aria-label="管理页面"><a href="/admin/">图片库</a><a href="/admin/featured.html">精选管理</a><a class="is-active" href="/admin/settings.html">标签与分类</a></nav>
```

In `public/assets/admin/site-settings.js`, replace only visible phrases:

```js
elements.status.textContent = isDirty()
  ? "精选设置已修改，保存后生效。"
  : `当前精选 ${draft.featuredImages.length} 张。`;
```

and:

```js
notifier.success("精选设置已保存");
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/templates.test.js tests/featured-page.test.js tests/site-settings-controller.test.js
```

Expected: all tests in the three files pass.

- [ ] **Step 7: Commit the standalone featured route**

```powershell
git add -- public/admin/featured.html public/assets/admin/featured-page.js public/admin/index.html public/admin/settings.html public/assets/admin/site-settings.js tests/featured-page.test.js tests/templates.test.js tests/site-settings-controller.test.js
git commit -m "feat: add standalone featured management"
```

### Task 2: Make labels and categories a taxonomy-only page

**Files:**
- Modify: `tests/templates.test.js`
- Modify: `public/admin/settings.html`
- Modify: `public/assets/admin/settings-page.js`

- [ ] **Step 1: Write failing taxonomy-page isolation tests**

Add to `tests/templates.test.js`:

```js
test("labels and categories page excludes featured management", () => {
  const html = readFileSync(new URL("../public/admin/settings.html", import.meta.url), "utf8");
  assert.match(html, /<h1>标签与分类<\/h1>/);
  assert.match(html, /data-settings-tab="tags"/);
  assert.match(html, /data-settings-tab="categories"/);
  assert.doesNotMatch(html, /data-settings-tab="site"|id="site-panel"/);
  assert.doesNotMatch(html, /site-issue-name|site-hero-copy|site-featured-list/);
});

test("taxonomy entry has no featured or site mode", () => {
  const source = readFileSync(new URL("../public/assets/admin/settings-page.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /site-settings\.js|createSiteSettingsController/);
  assert.doesNotMatch(source, /isSiteTab|ensureSiteController|sitePanel|siteController/);
  assert.doesNotMatch(source, /\/api\/admin\/site|\/api\/admin\/images/);
  assert.match(source, /activeType === "tags" \? "新增标签" : "新增主分类"/);
});
```

- [ ] **Step 2: Run template tests and verify RED**

Run:

```powershell
node --test tests/templates.test.js
```

Expected: FAIL because the settings page and entry still contain the old site tab and site-mode branches.

- [ ] **Step 3: Remove featured markup from settings.html**

Change the document title and heading to “Gallery 标签与分类” and “标签与分类”. Keep only the `tags` and `categories` tab buttons. Delete the complete `site-panel` section. Keep the taxonomy panel, dialog host, toast host, and authentication gate unchanged.

Change the settings entry script URL to:

```html
<script type="module" src="/assets/admin/settings-page.js?v=20260716-admin-featured-navigation"></script>
```

- [ ] **Step 4: Reduce settings-page.js to taxonomy-only behavior**

Delete the `createSiteSettingsController` import, `sitePanel` element, `siteController` variable, `isSiteTab()` and `ensureSiteController()`.

Replace `setBusy()` with:

```js
function setBusy(next) {
  busy = next;
  elements.create.disabled = next;
  elements.tabs.forEach((tab) => { tab.disabled = next; });
  updateOrderActions();
}
```

Replace `updateOrderActions()` with:

```js
function updateOrderActions() {
  const dirty = state.isDirty(activeType);
  const filtering = Boolean(elements.search.value.trim());
  elements.reset.disabled = busy || !dirty;
  elements.save.disabled = busy || !dirty;
  elements.status.textContent = dirty
    ? "顺序已调整，保存后生效。"
    : filtering ? "清除搜索后可调整顺序。" : "";
}
```

Remove `elements.create.hidden = isSiteTab()` from `renderTaxonomy()`. Replace `render()` with:

```js
function render() {
  renderTaxonomy();
  attachSortable();
}
```

Remove the site guard from `attachSortable()`, leaving controller creation immediately after `sortable?.destroy()`. Delete the conditional site load at the end of `authenticate()` so it ends with:

```js
showApp();
render();
```

Remove the site guards from `createItem()`, `saveOrder()`, reset, search, and list-click handling. Replace the tab click listener with:

```js
elements.tabs.forEach((tab) => tab.addEventListener("click", () => {
  activeType = tab.dataset.settingsTab;
  elements.search.value = "";
  render();
}));
```

The search handler becomes:

```js
elements.search.addEventListener("input", render);
```

The list handler starts with `if (busy) return;`. Preserve every existing tag/category API call and sorting operation.

- [ ] **Step 5: Update the targeted cache contract**

In `tests/templates.test.js`, keep these references on `20260715-featured-filter-separation`:

- library HTML → `workbench.css` and `library-page.js`;
- library entry → `library-state.js` and `renderers/image-card.js`;
- settings HTML and featured HTML → `settings.css`.

Require these references to use `20260716-admin-featured-navigation`:

- settings HTML → `settings-page.js`;
- featured HTML → `featured-page.js`;
- featured entry → `site-settings.js`.

Remove the old assertion that `settings-page.js` imports `site-settings.js`.

- [ ] **Step 6: Run settings, templates, and featured tests and verify GREEN**

Run:

```powershell
node --test tests/admin-settings.test.js tests/templates.test.js tests/featured-page.test.js tests/site-settings-controller.test.js
```

Expected: all tests in all four files pass.

- [ ] **Step 7: Commit the taxonomy-only page**

```powershell
git add -- public/admin/settings.html public/assets/admin/settings-page.js tests/templates.test.js
git commit -m "refactor: separate taxonomy from featured management"
```

### Task 3: Document and verify the complete admin split

**Files:**
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`

- [ ] **Step 1: Record current information architecture**

Add a dated subsection documenting:

```markdown
### 2.11 后台精选管理独立页面（本地完成，待发布）

- 顶栏调整为“图片库 / 精选管理 / 标签与分类”。
- `/admin/featured.html` 统一管理本期名字、大屏文案、轮播图片与顺序，并通过现有站点 API 原子保存。
- `/admin/settings.html` 只保留标签和主分类；其入口脚本不再导入精选控制器或请求站点配置。
- 精选页首次加载只请求站点配置，打开候选选择器时才请求图片库；标签与分类页只加载标签和分类。
- 设置 JavaScript 链使用 `20260716-admin-featured-navigation`，未变更图片库和 CSS 资产保持原缓存版本。
- 本次没有 D1 migration、Repository 或公开页面改动，验收未访问任何图片内容。
```

Update the acceptance checklist with the three-item navigation and route ownership.

- [ ] **Step 2: Run syntax and focused verification**

Run:

```powershell
node --check public/assets/admin/featured-page.js
node --check public/assets/admin/settings-page.js
node --check public/assets/admin/site-settings.js
node --test tests/admin-settings.test.js tests/templates.test.js tests/featured-page.test.js tests/site-settings-controller.test.js
```

Expected: every syntax check and focused test exits 0.

- [ ] **Step 3: Run the clean-branch full suite**

Run:

```powershell
npm test
git diff --check a00bfa8..HEAD
git status --short
```

Expected: all tracked tests pass with 0 failures, diff check exits 0, and the isolated implementation worktree is clean.

- [ ] **Step 4: Commit documentation and final evidence**

Append the actual focused and full test totals to section 2.11, then run:

```powershell
git add -- docs/2026-07-14-hero-featured-and-public-polish.md
git commit -m "docs: record featured management split"
```

### Task 4: Integrate without touching unrelated user work

**Files:**
- Verify only.

- [ ] **Step 1: Audit implementation scope**

Run:

```powershell
git diff --name-only a00bfa8..HEAD
git diff --check a00bfa8..HEAD
git log --oneline a00bfa8..HEAD
```

Expected: only files listed in this plan appear; no migration, schema, Repository, API, public-gallery, image asset, or unrelated user file appears.

- [ ] **Step 2: Fast-forward main and verify the merged workspace**

Fast-forward local `main` to the verified feature branch because the user already selected local merge. Preserve all unrelated modified and untracked files. Run:

```powershell
npm test
git status -sb
```

Expected: the merged workspace full suite passes, including any pre-existing untracked user tests; status lists only the pre-existing unrelated user changes.

- [ ] **Step 3: Clean up only this task's worktree and branch**

After verifying the resolved worktree path is inside `.worktrees/`, remove only this task's clean worktree and delete only its merged feature branch. Do not modify `.worktrees/admin-frontend-refactor`.
