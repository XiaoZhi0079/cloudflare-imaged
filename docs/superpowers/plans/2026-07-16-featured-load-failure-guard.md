# Featured Load Failure Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the featured-management page from saving an uninitialized empty featured list after its initial site-configuration request fails.

**Architecture:** Give `createSiteSettingsController()` an explicit readiness state that is separate from request busy state, and keep all form actions locked until a complete site payload has been applied. Keep the page visible for non-authentication failures, expose an explicit retry action in `featured-page.js`, and add both controller-level behavioral tests and static route/cache contracts.

**Tech Stack:** Static HTML, JavaScript ES modules, existing admin controller/client infrastructure, Node.js built-in test runner, minimal fake DOM elements.

---

## File map

- Modify `tests/site-settings-controller.test.js` — exercise the real controller with fake elements and rejected/successful site requests.
- Modify `public/assets/admin/site-settings.js` — add readiness state, control locking, and defensive action guards.
- Modify `tests/featured-page.test.js` — require retry orchestration in the featured entry.
- Modify `tests/templates.test.js` — require initial disabled controls, retry DOM, and the new cache version chain.
- Modify `public/admin/featured.html` — start controls disabled and add the hidden retry button.
- Modify `public/assets/admin/featured-page.js` — show and run retry only for non-authentication load failures.
- Modify `docs/2026-07-14-hero-featured-and-public-polish.md` — record the safety fix and verification evidence.
- Preserve every API, Repository, D1, migration, public page, image rule, and unrelated user file.

### Task 1: Make the featured controller fail closed

**Files:**
- Modify: `tests/site-settings-controller.test.js`
- Modify: `public/assets/admin/site-settings.js`

- [ ] **Step 1: Add a minimal controller harness and failing readiness tests**

Append helpers to `tests/site-settings-controller.test.js` that create event-capable fake elements without reading any images:

```js
function fakeElement(initial = {}) {
  const listeners = new Map();
  return {
    disabled: false,
    value: "",
    textContent: "",
    innerHTML: "",
    ...initial,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      listeners.get(type)?.({ target: this, closest: () => null });
    },
  };
}

function controllerHarness(responses) {
  const elements = {
    "#site-issue-name": fakeElement(),
    "#site-hero-copy": fakeElement(),
    "#site-status": fakeElement(),
    "#site-featured-list": fakeElement(),
    "#site-add-featured": fakeElement(),
    "#site-save": fakeElement(),
  };
  const calls = [];
  const errors = [];
  const queue = [...responses];
  const controller = siteSettings.createSiteSettingsController({
    root: { querySelector: (selector) => elements[selector] },
    client: {
      async request(path, options) {
        calls.push({ path, options });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    dialogs: {},
    notifier: { error: (message) => errors.push(message), success() {} },
  });
  controller.bind();
  return { controller, elements, calls, errors };
}
```

Add these tests:

```js
test("featured controller stays locked and cannot save after initial load failure", async () => {
  const harness = controllerHarness([new Error("temporary site failure")]);
  const { elements, controller, calls, errors } = harness;

  for (const selector of [
    "#site-issue-name", "#site-hero-copy", "#site-add-featured", "#site-save",
  ]) {
    assert.equal(elements[selector].disabled, true);
  }

  await assert.rejects(controller.load(), /temporary site failure/);
  elements["#site-save"].dispatch("click");
  elements["#site-add-featured"].dispatch("click");

  assert.equal(calls.length, 1, "failed initialization must not allow image or save requests");
  assert.match(errors.at(-1), /尚未加载/);
  assert.equal(elements["#site-save"].disabled, true);
  assert.equal(elements["#site-add-featured"].disabled, true);
});

test("featured controller unlocks only after a later load succeeds", async () => {
  const payload = { issueName: "本期", heroCopy: "一句文案", featuredImages: [] };
  const harness = controllerHarness([new Error("temporary"), payload]);
  const { elements, controller } = harness;

  await assert.rejects(controller.load(), /temporary/);
  await controller.load();

  assert.equal(elements["#site-issue-name"].value, "本期");
  assert.equal(elements["#site-hero-copy"].value, "一句文案");
  assert.equal(elements["#site-issue-name"].disabled, false);
  assert.equal(elements["#site-hero-copy"].disabled, false);
  assert.equal(elements["#site-add-featured"].disabled, false);
  assert.equal(elements["#site-save"].disabled, true, "unchanged loaded data is not saveable");
});
```

- [ ] **Step 2: Run the controller test and verify RED**

Run:

```powershell
node --test tests/site-settings-controller.test.js
```

Expected: the new tests fail because the controller does not initially disable controls and does not track whether a payload was loaded.

- [ ] **Step 3: Implement readiness and defensive guards**

In `public/assets/admin/site-settings.js`, add `ready` next to `busy`:

```js
let busy = false;
let ready = false;
let bound = false;
```

Replace `setBusy()` with a single availability calculation:

```js
function updateAvailability() {
  const locked = busy || !ready;
  elements.issueName.disabled = locked;
  elements.heroCopy.disabled = locked;
  elements.add.disabled = locked;
  elements.save.disabled = locked || !isDirty();
}

function setBusy(next) {
  busy = next;
  updateAvailability();
  onBusyChange?.(next);
}
```

Make `updateStatus()` preserve the same rule:

```js
elements.save.disabled = busy || !ready || !isDirty();
```

Replace `load()` with a fail-closed transition:

```js
async function load() {
  ready = false;
  setBusy(true);
  try {
    const payload = await client.request("/api/admin/site");
    applyPayload(payload);
    ready = true;
  } finally {
    setBusy(false);
  }
}
```

Add guards at the start of candidate loading and saving:

```js
async function openPicker() {
  if (!ready) return;
  // existing implementation
}

async function save() {
  if (!ready) {
    notifier.error("精选设置尚未加载，请重新加载后再试。");
    return;
  }
  // existing implementation
}
```

Call `updateAvailability()` once in `bind()` before registering event listeners so programmatic use and older markup also start locked.

- [ ] **Step 4: Run the controller test and verify GREEN**

Run:

```powershell
node --test tests/site-settings-controller.test.js
```

Expected: all controller tests pass, including rejected load, guarded actions, and successful retry.

- [ ] **Step 5: Commit the fail-closed controller**

```powershell
git add -- tests/site-settings-controller.test.js public/assets/admin/site-settings.js
git commit -m "fix: guard uninitialized featured settings"
```

### Task 2: Add explicit retry and release contracts

**Files:**
- Modify: `tests/featured-page.test.js`
- Modify: `tests/templates.test.js`
- Modify: `public/admin/featured.html`
- Modify: `public/assets/admin/featured-page.js`
- Modify: `docs/2026-07-14-hero-featured-and-public-polish.md`

- [ ] **Step 1: Write failing retry, initial-lock, and cache tests**

In `tests/featured-page.test.js`, extend the failure-handling test with:

```js
assert.match(source, /retry:\s*document\.querySelector\("#featured-retry"\)/);
assert.match(source, /elements\.retry\.addEventListener\("click"/);
assert.match(source, /elements\.retry\.hidden = false/);
assert.match(source, /elements\.retry\.hidden = true/);
assert.match(source, /elements\.retry\.disabled = true/);
```

In the featured ownership test in `tests/templates.test.js`, include `featured-retry` in the required IDs and require initial disabled state:

```js
assert.match(html, /id="site-issue-name"[^>]*disabled/);
assert.match(html, /id="site-hero-copy"[^>]*disabled/);
assert.match(html, /id="site-add-featured"[^>]*disabled/);
assert.match(html, /id="site-save"[^>]*disabled/);
assert.match(html, /id="featured-retry"[^>]*hidden/);
```

Change the targeted cache expectation for featured HTML and its direct import to `20260716-featured-load-guard`, while keeping `settings-page.js` on `20260716-admin-featured-navigation` and unchanged CSS/library assets on `20260715-featured-filter-separation`.

- [ ] **Step 2: Run focused entry/template tests and verify RED**

Run:

```powershell
node --test tests/featured-page.test.js tests/templates.test.js tests/site-settings-controller.test.js
```

Expected: retry/initial-disabled/cache assertions fail because the page has no retry element and still uses the prior featured cache version.

- [ ] **Step 3: Add initial disabled markup and retry control**

In `public/admin/featured.html`:

- add `disabled` to `site-issue-name`, `site-hero-copy`, `site-add-featured`, and `site-save`;
- add this button to `.settings-heading`:

```html
<button id="featured-retry" type="button" hidden>重新加载</button>
```

- change the module URL to:

```html
<script type="module" src="/assets/admin/featured-page.js?v=20260716-featured-load-guard"></script>
```

- [ ] **Step 4: Implement retry orchestration**

In `public/assets/admin/featured-page.js`, query the button and update the controller import:

```js
import { createSiteSettingsController } from "./site-settings.js?v=20260716-featured-load-guard";

// inside elements
retry: document.querySelector("#featured-retry"),
```

Make `showAuth()` clear application retry state:

```js
elements.retry.hidden = true;
elements.retry.disabled = false;
```

Update `authenticate()` so every load begins with retry disabled, success hides it, and only non-authentication failure exposes it:

```js
async function authenticate(key) {
  keyStore.set(key);
  elements.retry.disabled = true;
  try {
    await featuredController.load();
    elements.retry.hidden = true;
    elements.retry.disabled = false;
    showApp();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) return;
    showApp();
    elements.retry.hidden = false;
    elements.retry.disabled = false;
    notifier.error(messageFor(error));
  }
}
```

Bind retry without adding another API path:

```js
elements.retry.addEventListener("click", () => {
  if (!elements.retry.disabled) authenticate(keyStore.get());
});
```

- [ ] **Step 5: Update feature documentation**

Add section `2.12 精选配置加载失败保护（本地完成，待发布）` to `docs/2026-07-14-hero-featured-and-public-polish.md` documenting:

- forms are locked until `GET /api/admin/site` succeeds;
- non-auth failures expose retry without allowing PATCH or image-library requests;
- 401 still returns to login;
- featured HTML/entry/controller use `20260716-featured-load-guard`;
- no API, D1, migration, public page, or image inspection occurred.

- [ ] **Step 6: Run syntax and focused verification**

Run:

```powershell
node --check public/assets/admin/featured-page.js
node --check public/assets/admin/site-settings.js
node --test tests/featured-page.test.js tests/templates.test.js tests/site-settings-controller.test.js
```

Expected: both syntax checks exit 0 and every focused test passes.

- [ ] **Step 7: Run full release verification**

Run:

```powershell
npm test
git diff --check 10b8acc..HEAD
git status --short
```

Expected: the clean feature worktree has zero test failures and no whitespace errors; Git status lists only the Task 2 HTML, entry, tests, and documentation awaiting their planned commit.

- [ ] **Step 8: Record actual evidence and commit**

Append the actual focused and full test totals to section 2.12, then run:

```powershell
git add -- public/admin/featured.html public/assets/admin/featured-page.js tests/featured-page.test.js tests/templates.test.js docs/2026-07-14-hero-featured-and-public-polish.md
git commit -m "fix: add featured settings reload guard"
```

### Task 3: Re-audit and integrate safely

**Files:**
- Verify only.

- [ ] **Step 1: Audit the complete release delta**

Run:

```powershell
git diff --name-only origin/main..HEAD
git diff --check origin/main..HEAD
git log --oneline 10b8acc..HEAD
```

Expected: this fix adds only the spec, plan, featured HTML/entry/controller, their tests, and the current feature document; no API, Repository, schema, migration, Wrangler, public page, or image asset appears.

- [ ] **Step 2: Fast-forward local main**

Fast-forward `main` to the verified fix branch without staging or modifying the existing `README.md`, `package.json`, `.playwright-mcp/`, codex-turn-cleaner files, `package-lock.json`, `tools/`, or the existing `admin-frontend-refactor` worktree.

- [ ] **Step 3: Verify merged main and clean only this task**

Run `npm test` in the merged main workspace, confirm the existing unrelated status is unchanged, remove only `.worktrees/featured-load-failure-guard`, and delete only the merged `fix/featured-load-failure-guard` branch.

Do not push GitHub or deploy Cloudflare in this plan.
