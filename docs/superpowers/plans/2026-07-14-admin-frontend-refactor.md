# Gallery Admin Frontend Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated Gallery admin pages with an authenticated image workbench and a content-settings page, backed by atomic taxonomy ordering and modular vanilla JavaScript.

**Architecture:** Keep Cloudflare Pages, Pages Functions, native HTML/CSS, and ES Modules with no production build step. A shared auth/API layer gates both admin pages, page-specific controllers own state, and a Pointer Events sortable component reproduces Edge tab-strip behavior. D1 repository methods own atomic ordering; R2-aware API handlers own image file operations.

**Tech Stack:** Cloudflare Pages Functions, Cloudflare D1/R2, native ES Modules, Pointer Events, CSS Grid, Node.js `node:test`, `node:sqlite`.

---

## Execution Prerequisite

Create an isolated worktree from design commit `8c092cc`. The current main worktree contains unrelated uncommitted files and a local repository experiment.

```powershell
git worktree add .worktrees/admin-frontend-refactor -b feat/admin-frontend-refactor 8c092cc
Set-Location .worktrees/admin-frontend-refactor
npm test
```

Expected clean baseline: `71` tests, `71` pass, `0` fail. The user chose contiguous tag ordering, so do not copy the current main worktree's “不规范化” changes into the feature worktree.

## File Map

**Create:**

- `functions/api/admin/tags/reorder.js`
- `functions/api/admin/categories/reorder.js`
- `functions/api/admin/images/category-assignments/bulk.js`
- `public/admin/settings.html`
- `public/assets/admin/api-client.js`
- `public/assets/admin/auth.js`
- `public/assets/admin/dialogs.js`
- `public/assets/admin/notifications.js`
- `public/assets/admin/sort-order.js`
- `public/assets/admin/sortable-list.js`
- `public/assets/admin/settings-state.js`
- `public/assets/admin/settings-page.js`
- `public/assets/admin/library-state.js`
- `public/assets/admin/library-page.js`
- `public/assets/admin/upload.js`
- `public/assets/admin/renderers/image-card.js`
- `public/assets/admin/renderers/taxonomy-item.js`
- `public/assets/admin/admin.css`
- `public/assets/admin/workbench.css`
- `public/assets/admin/settings.css`
- `tests/admin-core.test.js`
- `tests/admin-sortable.test.js`
- `tests/admin-settings.test.js`
- `tests/admin-library.test.js`
- `tests/admin-upload.test.js`
- `tests/reorder-api.test.js`
- `tests/bulk-category-api.test.js`

**Modify:**

- `src/server/gallery-repository.js`
- `functions/api/admin/_shared.js`
- `public/admin/index.html`
- `public/assets/main.css`
- `public/assets/templates.js`
- `src/shared/templates.js`
- `tests/templates.test.js`
- `tests/categories-ui.test.js`

**Delete:**

- `public/admin/upload.html`
- `public/admin/images.html`
- `public/admin/tags.html`
- `public/assets/admin.js`
- `public/assets/admin-categories.js`

## Task 1: Add Atomic Taxonomy Reordering

**Files:**
- Modify: `src/server/gallery-repository.js`
- Modify: `functions/api/admin/_shared.js`
- Create: `functions/api/admin/tags/reorder.js`
- Create: `functions/api/admin/categories/reorder.js`
- Create: `tests/reorder-api.test.js`

- [ ] **Step 1: Write failing repository and handler tests**

Test successful complete order, duplicate IDs, missing IDs, and non-contiguous sort values for tags and categories:

```js
test("tag reorder handler persists a complete contiguous order", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const alpha = await repository.createTag({ name: "alpha", sortOrder: 1 });
  const bravo = await repository.createTag({ name: "bravo", sortOrder: 2 });
  const charlie = await repository.createTag({ name: "charlie", sortOrder: 3 });

  const response = await reorderTagsHandler({
    env,
    request: adminRequest("/api/admin/tags/reorder", "PATCH", {
      items: [
        { id: charlie.id, sortOrder: 1 },
        { id: alpha.id, sortOrder: 2 },
        { id: bravo.id, sortOrder: 3 },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).tags.map(({ id, sortOrder }) => ({ id, sortOrder })),
    [
      { id: charlie.id, sortOrder: 1 },
      { id: alpha.id, sortOrder: 2 },
      { id: bravo.id, sortOrder: 3 },
    ],
  );
});
```

- [ ] **Step 2: Run the new test and verify red state**

Run: `node --test tests/reorder-api.test.js`

Expected: FAIL because handlers and repository methods do not exist.

- [ ] **Step 3: Add shared request validation**

Add this export to `functions/api/admin/_shared.js`:

```js
export function parseCompleteOrder(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: "排序内容不能为空。" };
  const items = value.map((item) => ({ id: Number(item?.id), sortOrder: Number(item?.sortOrder) }));
  const ids = new Set(items.map((item) => item.id));
  const orders = items.map((item) => item.sortOrder).sort((a, b) => a - b);
  const valid = items.every((item) => Number.isInteger(item.id) && item.id > 0
    && Number.isInteger(item.sortOrder) && item.sortOrder > 0);
  const contiguous = orders.every((order, index) => order === index + 1);
  if (!valid || ids.size !== items.length || !contiguous) return { error: "排序内容无效。" };
  return { items: [...items].sort((a, b) => a.sortOrder - b.sortOrder) };
}
```

- [ ] **Step 4: Add atomic repository methods**

Add a D1 `batch()` path plus `node:sqlite` transaction fallback:

```js
async function runBatch(database, entries) {
  const statements = entries.map(({ sql, params }) => bindStatement(database, sql, params));
  if (typeof database.batch === "function") return await database.batch(statements);
  database.exec("BEGIN");
  try {
    for (const statement of statements) await statement.run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
```

Expose `reorderTags(orderedIds)` and `reorderCategories(orderedIds)`. Each must compare the submitted ID set with the complete current entity list, throw `RangeError("incomplete order")` on mismatch, batch-update `sort_order = index + 1`, and return the ordered rows.

- [ ] **Step 5: Implement both Pages Functions**

Each handler requires the admin key, allows only `PATCH`, calls `parseCompleteOrder`, maps `RangeError` to `400`, and returns API-shaped rows:

```js
const parsed = parseCompleteOrder((await parseRequestJson(request)).items);
if (parsed.error) return jsonResponse({ error: parsed.error }, 400);
const tags = await getRepository(env).reorderTags(parsed.items.map((item) => item.id));
return jsonResponse({ tags: tags.map(toApiTag) });
```

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/reorder-api.test.js tests/gallery-repository.test.js tests/categories-repository.test.js`

Expected: all focused tests pass.

Run: `npm test`

Expected: `0` failures.

- [ ] **Step 7: Commit**

```powershell
git add src/server/gallery-repository.js functions/api/admin/_shared.js functions/api/admin/tags/reorder.js functions/api/admin/categories/reorder.js tests/reorder-api.test.js
git commit -m "新增标签与分类批量排序接口"
```

## Task 2: Add Bulk Image Category Movement

**Files:**
- Create: `functions/api/admin/images/category-assignments/bulk.js`
- Create: `tests/bulk-category-api.test.js`

- [ ] **Step 1: Write failing API tests**

Cover successful R2 moves, invalid category/image IDs, and partial R2 failure:

```js
assert.deepEqual(payload.failed, []);
assert.deepEqual(payload.images.map((image) => image.category.id), [scenery.id, scenery.id]);
assert.equal(env.GALLERY_BUCKET.objects.has("scenery/first.webp"), true);
assert.equal(env.GALLERY_BUCKET.objects.has("scenery/second.webp"), true);
```

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/bulk-category-api.test.js`

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement the handler**

Normalize unique positive `imageIds`, validate `categoryId`, load all images before processing, then process each image independently:

```js
for (const image of images) {
  try {
    const moved = await storage.moveImage(image.storageKey, category.directory_slug);
    const updated = await repository.updateImage(image.id, {
      storageKey: moved.storageKey,
      fileName: moved.fileName,
      fileUrl: moved.fileUrl,
      categoryId: category.id,
      syncStatus: "ok",
      note: null,
    });
    succeeded.push(toAdminImage(updated));
  } catch {
    await repository.updateImageSyncState(image.id, {
      syncStatus: "move_failed",
      note: "批量移动分类时底层文件移动失败。",
    });
    failed.push({ imageId: image.id, error: "底层文件移动失败。" });
  }
}
```

Return `{ images: succeeded, failed }` with status `200` for partial completion; reject invalid input before moving any object.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/bulk-category-api.test.js tests/api-handlers.test.js`

Expected: all pass.

```powershell
git add functions/api/admin/images/category-assignments/bulk.js tests/bulk-category-api.test.js
git commit -m "新增图片批量移动分类接口"
```

## Task 3: Build the Admin API and Authentication Core

**Files:**
- Create: `public/assets/admin/api-client.js`
- Create: `public/assets/admin/auth.js`
- Create: `tests/admin-core.test.js`

- [ ] **Step 1: Write failing tests**

```js
test("admin key store persists and clears the key", () => {
  const store = createAdminKeyStore(fakeStorage());
  store.set(" secret ");
  assert.equal(store.get(), "secret");
  store.clear();
  assert.equal(store.get(), "");
});

test("api client clears auth on 401", async () => {
  let unauthorized = false;
  const client = createAdminApiClient({
    getKey: () => "secret",
    onUnauthorized: () => { unauthorized = true; },
    fetchImpl: async () => new Response('{"error":"Unauthorized"}', { status: 401 }),
  });
  await assert.rejects(() => client.request("/api/admin/tags"), AdminUnauthorizedError);
  assert.equal(unauthorized, true);
});
```

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/admin-core.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement `api-client.js`**

Export `AdminApiError`, `AdminUnauthorizedError`, and `createAdminApiClient`. `request()` must add the admin header, add JSON content type for string bodies, abort after `timeoutMs`, parse text safely, and call `onUnauthorized` for `401`.

```js
const headers = new Headers(init.headers ?? {});
headers.set("x-gallery-admin-key", getKey());
if (typeof init.body === "string" && !headers.has("content-type")) {
  headers.set("content-type", "application/json");
}
```

- [ ] **Step 4: Implement `auth.js`**

Export `ADMIN_KEY_STORAGE_KEY = "gallery-admin-key"`, `createAdminKeyStore(storage = localStorage)`, and `verifyAdminKey(client)`. `verifyAdminKey` requests `/api/admin/tags` and returns the verified tag array for page boot reuse.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/admin-core.test.js`

Expected: all pass.

```powershell
git add public/assets/admin/api-client.js public/assets/admin/auth.js tests/admin-core.test.js
git commit -m "拆分管理端认证与 API 客户端"
```

## Task 4: Build the Edge-Style Sortable Component

**Files:**
- Create: `public/assets/admin/sort-order.js`
- Create: `public/assets/admin/sortable-list.js`
- Create: `tests/admin-sortable.test.js`

- [ ] **Step 1: Write failing pure behavior tests**

```js
test("drag target changes after crossing a slot midpoint", () => {
  assert.equal(getTargetIndex({ dragTop: 33, step: 68, itemCount: 5 }), 0);
  assert.equal(getTargetIndex({ dragTop: 35, step: 68, itemCount: 5 }), 1);
});

test("moving down and back restores original order", () => {
  const original = [1, 2, 3, 4, 5];
  const moved = moveItem(original, 1, 4);
  assert.deepEqual(moved, [1, 3, 4, 5, 2]);
  assert.deepEqual(moveItem(moved, 4, 1), original);
});
```

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/admin-sortable.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement pure helpers**

```js
export function getTargetIndex({ dragTop, step, itemCount }) {
  return Math.max(0, Math.min(itemCount - 1, Math.round(dragTop / step)));
}

export function moveItem(items, fromIndex, toIndex) {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function ordersEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item.id === right[index].id);
}

export function serializeOrder(items) {
  return items.map((item, index) => ({ id: item.id, sortOrder: index + 1 }));
}
```

- [ ] **Step 4: Implement the Pointer Events controller**

Export `createSortableList({ container, getItems, setItems, onChange, rowSelector, handleSelector })`. Use a 4px activation threshold, pointer capture, fixed row slots, midpoint calculation through `getTargetIndex`, and cancellation on `Escape`, `pointercancel`, or lost capture. Set `aria-grabbed`, restore focus to the handle, honor `prefers-reduced-motion`, and return a `destroy()` cleanup function.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/admin-sortable.test.js`

Expected: all pass.

```powershell
git add public/assets/admin/sort-order.js public/assets/admin/sortable-list.js tests/admin-sortable.test.js
git commit -m "实现 Edge 式标签排序组件"
```

## Task 5: Build the Shared Admin Shell and Login Gate

**Files:**
- Modify: `public/admin/index.html`
- Create: `public/admin/settings.html`
- Create: `public/assets/admin/dialogs.js`
- Create: `public/assets/admin/notifications.js`
- Create: `public/assets/admin/admin.css`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Replace old assertions with failing shell assertions**

Assert both pages contain `#admin-auth-view`, `#admin-app[hidden]`, `#admin-key`, `#admin-login`, `[data-admin-logout]`, navigation to both routes, and `/assets/admin/admin.css`. Assert settings loads `settings-page.js` and index loads `library-page.js`.

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/templates.test.js`

Expected: FAIL against old markup.

- [ ] **Step 3: Write the shared auth structure**

```html
<section id="admin-auth-view" class="admin-auth-view">
  <form id="admin-login-form" class="admin-login-panel" novalidate>
    <p class="admin-eyebrow">Gallery Admin</p>
    <h1>进入管理台</h1>
    <label class="admin-field" for="admin-key">管理密钥</label>
    <div class="admin-password-control">
      <input id="admin-key" type="password" autocomplete="current-password" required />
      <button type="button" data-toggle-password aria-label="显示管理密钥" title="显示管理密钥">显示</button>
    </div>
    <p id="admin-login-error" class="admin-field-error" aria-live="polite"></p>
    <button id="admin-login" class="admin-button-primary" type="submit">验证并进入</button>
  </form>
</section>
<div id="admin-app" hidden><!-- page content --></div>
```

- [ ] **Step 4: Implement dialog and notification modules**

`dialogs.js` exports `createDialogHost(element)` with `confirm()`, `textInput()`, and `destroy()`. Trap `Tab`, close on `Escape`/backdrop, and restore the opener. `notifications.js` exports `createNotifier(host)` with `success`, `error`, and `dismiss`; success auto-dismisses after 3000ms and errors remain.

- [ ] **Step 5: Add shared warm-palette CSS**

```css
.admin-body {
  --admin-bg: #f3f0e8;
  --admin-panel: #fffaf4;
  --admin-surface: #fff;
  --admin-ink: #28231f;
  --admin-muted: #776c62;
  --admin-line: #cfc3b7;
  --admin-accent: #b44e27;
  --admin-success: #39705a;
  --admin-warning: #936128;
  --admin-danger: #9b351f;
  margin: 0;
  min-height: 100dvh;
  background: var(--admin-bg);
  color: var(--admin-ink);
}
```

Add stable 44px controls, visible focus outlines, top navigation, full-screen auth view, dialog, drawer, Toast, skeleton, empty, and error states. Radius must not exceed 8px.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/templates.test.js tests/admin-core.test.js`

Expected: all updated tests pass.

```powershell
git add public/admin/index.html public/admin/settings.html public/assets/admin/dialogs.js public/assets/admin/notifications.js public/assets/admin/admin.css tests/templates.test.js
git commit -m "建立管理端登录门禁与共享界面"
```

## Task 6: Implement the Content Settings Page

**Files:**
- Create: `public/assets/admin/settings-state.js`
- Create: `public/assets/admin/settings-page.js`
- Create: `public/assets/admin/renderers/taxonomy-item.js`
- Create: `public/assets/admin/settings.css`
- Create: `tests/admin-settings.test.js`
- Modify: `tests/categories-ui.test.js`

- [ ] **Step 1: Write failing state and renderer tests**

```js
test("settings state keeps server and draft orders separately", () => {
  const state = createSettingsState({ tags: [{ id: 1 }, { id: 2 }], categories: [{ id: 3 }, { id: 4 }] });
  state.setDraft("tags", [{ id: 2 }, { id: 1 }]);
  assert.equal(state.isDirty("tags"), true);
  assert.equal(state.isDirty("categories"), false);
  assert.deepEqual(state.serialize("tags"), [
    { id: 2, sortOrder: 1 },
    { id: 1, sortOrder: 2 },
  ]);
});
```

Also test HTML escaping, tag visibility controls, and immutable category directory display.

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/admin-settings.test.js tests/categories-ui.test.js`

Expected: FAIL because settings modules are absent and old-page assertions remain.

- [ ] **Step 3: Implement state and renderer modules**

`createSettingsState` exposes `getItems`, `setDraft`, `commitDraft`, `resetDraft`, `replaceItem`, `appendItem`, `removeItem`, `isDirty`, and `serialize`. `renderTaxonomyItem(item, type)` outputs `data-sort-id`, a `data-sort-handle` button, order, name, tag visibility or category directory, edit controls, and only tag hide/delete controls.

- [ ] **Step 4: Implement settings page boot and CRUD**

`settings-page.js` must authenticate with `GET /api/admin/tags`, reuse returned tags, load categories, switch segmented views, instantiate the sortable controller, save through exact reorder endpoints, call existing CRUD endpoints, preserve drafts on failure, and clear storage/return to auth on logout or `401`.

- [ ] **Step 5: Add settings CSS**

Use absolute stable slots only while sorting; normal entries remain clear repeated blocks. Add responsive controls and disable transitions under `prefers-reduced-motion`.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/admin-settings.test.js tests/categories-ui.test.js tests/admin-sortable.test.js`

Expected: all pass.

```powershell
git add public/assets/admin/settings-state.js public/assets/admin/settings-page.js public/assets/admin/renderers/taxonomy-item.js public/assets/admin/settings.css tests/admin-settings.test.js tests/categories-ui.test.js
git commit -m "实现标签与分类内容设置页"
```

## Task 7: Implement Workbench State and Image Rendering

**Files:**
- Create: `public/assets/admin/library-state.js`
- Create: `public/assets/admin/renderers/image-card.js`
- Create: `public/assets/admin/workbench.css`
- Create: `tests/admin-library.test.js`

- [ ] **Step 1: Write failing filter and selection tests**

```js
test("library filters require every tag and the selected category", () => {
  const images = [
    { id: 1, fileName: "a.webp", tags: ["人像", "自然光"], category: { id: 3 } },
    { id: 2, fileName: "b.webp", tags: ["人像"], category: { id: 4 } },
  ];
  assert.deepEqual(
    filterImages(images, { query: "", tagNames: new Set(["人像", "自然光"]), categoryId: 3 }),
    [images[0]],
  );
});
```

Test selection persistence across filtering and removal of deleted IDs.

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/admin-library.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement library state**

Export `filterImages(images, filters)` and `createLibraryState({ initialRenderLimit = 120, renderIncrement = 120 })`. Include setters for images/tags/categories/query/category/tags, filter reset, selection toggles, `syncImages`, `visibleImages`, `renderedImages`, and `showMore`.

- [ ] **Step 4: Implement safe image cards**

`renderImageCard(image, { selected })` escapes all values, lazy-loads images, uses a stable `4 / 3` media stage, exposes selection/detail actions, shows category plus at most two tags, and includes a missing-preview fallback.

- [ ] **Step 5: Implement workbench CSS**

Add the approved desktop grid (`280px` filter rail plus library), adaptive image grid, sticky command area, bottom bulk bar, right details drawer, centered upload dialog, skeletons, and breakpoints at 1100px and 720px.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/admin-library.test.js`

Expected: all pass.

```powershell
git add public/assets/admin/library-state.js public/assets/admin/renderers/image-card.js public/assets/admin/workbench.css tests/admin-library.test.js
git commit -m "实现图片工作台状态与渲染"
```

## Task 8: Implement Workbench Controllers, Details, and Bulk Actions

**Files:**
- Modify: `public/admin/index.html`
- Create: `public/assets/admin/library-page.js`
- Modify: `tests/templates.test.js`
- Modify: `tests/admin-library.test.js`

- [ ] **Step 1: Add failing workbench structure tests**

Assert final HTML contains search, category/tag filters, sort/density controls, image grid, load-more action, upload dialog, details drawer, bulk toolbar, bulk tag/category/delete actions, dialog host, and Toast host. Assert the old inline tag manager is absent.

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/templates.test.js tests/admin-library.test.js`

Expected: FAIL until final markup/controller exists.

- [ ] **Step 3: Finish workbench HTML**

Use stable controller IDs: `admin-search`, `category-filter-list`, `tag-filter-list`, `image-list`, `admin-load-more`, `admin-upload-open`, `admin-detail-drawer`, `admin-bulk-toolbar`, `bulk-assign-tags`, `bulk-assign-category`, `bulk-delete`, `admin-dialog-host`, and `admin-toast-host`.

- [ ] **Step 4: Implement page boot and filtering**

`library-page.js` authenticates first, loads images/categories while reusing verified tags, renders through `library-state`, debounces search by 150ms, updates counts/load-more, and uses event delegation.

- [ ] **Step 5: Implement details and bulk actions**

- Detail save: PATCH file name through `/api/admin/images`, POST tags through `/api/admin/images/tag-assignments`, and POST one image ID through the bulk-category endpoint.
- Bulk tags: POST `/api/admin/images/tag-assignments/bulk`.
- Bulk category: POST `/api/admin/images/category-assignments/bulk`; replace successes and retain failed selections.
- Bulk delete: POST `/api/admin/images/bulk-delete` after confirmation.
- Update local state after each success without reloading unrelated taxonomy data.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/templates.test.js tests/admin-library.test.js`

Expected: all pass.

```powershell
git add public/admin/index.html public/assets/admin/library-page.js tests/templates.test.js tests/admin-library.test.js
git commit -m "完成图片工作台筛选详情与批量操作"
```

## Task 9: Extract Upload Tasks with Failure Retry

**Files:**
- Create: `public/assets/admin/upload.js`
- Create: `tests/admin-upload.test.js`
- Modify: `public/assets/admin/library-page.js`

- [ ] **Step 1: Write failing upload-state tests**

```js
test("upload runner retries only failed files", async () => {
  const runner = createUploadRunner({
    batchSize: 2,
    requestUploadUrls: async (tasks) => tasks.map((task) => ({
      taskId: task.id,
      uploadUrl: `https://upload.test/${task.file.name}`,
      method: "PUT",
      headers: { "content-type": task.file.type },
      storageKey: `gallery/${task.file.name}`,
      fileName: task.file.name,
    })),
    uploadFile,
    completeUploads: async (tasks) => tasks.map((task) => ({ id: task.id })),
    onChange: () => {},
  });
  runner.setFiles([file("a"), file("b"), file("c")]);
  await runner.run();
  assert.deepEqual(runner.tasks().map((task) => task.status), ["success", "error", "success"]);
  await runner.retryFailed();
  assert.deepEqual(uploadedNames, ["a", "b", "c", "b"]);
});
```

Also test batch size, metadata drafts, task transitions, and counts.

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/admin-upload.test.js`

Expected: FAIL because `upload.js` does not exist.

- [ ] **Step 3: Implement the upload runner**

Export `createUploadRunner({ batchSize = 12, requestUploadUrls, uploadFile, completeUploads, onChange })`. Use task states `queued | signing | uploading | completing | success | error`, retain each error, and preserve successful results across `retryFailed()`.

Both init and complete payloads include `categoryId` and `tagIds`; signed PUT requests use server-provided method and headers.

- [ ] **Step 4: Connect the upload dialog**

Opening upload preselects active tag filters, requires one category and one tag, measures image dimensions, renders per-file progress, exposes “重试失败项”, and merges returned images into workbench state. Close automatically only when no failures remain.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/admin-upload.test.js tests/direct-upload.test.js tests/upload-categories.test.js`

Expected: all pass.

```powershell
git add public/assets/admin/upload.js public/assets/admin/library-page.js tests/admin-upload.test.js
git commit -m "拆分上传任务并支持失败重试"
```

## Task 10: Delete Legacy Pages and Separate Public/Admin Assets

**Files:**
- Delete: `public/admin/upload.html`
- Delete: `public/admin/images.html`
- Delete: `public/admin/tags.html`
- Delete: `public/assets/admin.js`
- Delete: `public/assets/admin-categories.js`
- Modify: `public/assets/main.css`
- Modify: `public/assets/templates.js`
- Modify: `src/shared/templates.js`
- Modify: `tests/templates.test.js`
- Modify: `tests/categories-ui.test.js`

- [ ] **Step 1: Add failing cleanup assertions**

Use `existsSync` to assert all legacy files are absent. Assert `main.css` contains no `.admin-` selector, both template files export only `renderTagChips` and `renderGalleryCards`, and admin HTML links the three admin stylesheets.

- [ ] **Step 2: Run and verify red state**

Run: `node --test tests/templates.test.js tests/categories-ui.test.js`

Expected: FAIL while legacy resources remain.

- [ ] **Step 3: Delete legacy files and admin renderers**

Delete the listed files. Remove `renderAdminTagList`, `renderAdminTagRail`, `renderAdminImageGrid`, and `renderAdminImageList` from both template files while keeping runtime/shared files byte-identical.

- [ ] **Step 4: Move admin CSS out of `main.css`**

Delete `.admin-*`, management-only button/dialog selectors, and admin keyframes only after equivalent rules exist in admin stylesheets. Preserve public gallery selectors and colors unchanged.

- [ ] **Step 5: Run full tests and commit**

Run: `npm test`

Expected: `0` failures and no test references to deleted pages.

```powershell
git add -A -- public/admin public/assets src/shared/templates.js tests/templates.test.js tests/categories-ui.test.js
git commit -m "删除旧管理页面并分离前后台资源"
```

## Task 11: Accessibility, Responsive, and Browser Verification

**Files:**
- Modify: `public/assets/admin/admin.css`
- Modify: `public/assets/admin/workbench.css`
- Modify: `public/assets/admin/settings.css`
- Modify: `public/assets/admin/dialogs.js`
- Modify: `public/assets/admin/sortable-list.js`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: Add static accessibility assertions**

Assert icon-only buttons have `aria-label` and `title`, status hosts have `aria-live`, dialogs have `role="dialog"` and `aria-modal="true"`, and file inputs have labels.

- [ ] **Step 2: Run automated tests**

Run: `npm test`

Expected: all tests pass with `0` failures.

- [ ] **Step 3: Start local Pages preview**

Run: `npm run dev`

Expected: `http://127.0.0.1:8788/admin/`. If occupied, run the equivalent Wrangler command on 8789 and record the URL.

- [ ] **Step 4: Verify desktop workflows with Playwright**

At `1440x900`, verify login, remembered-key refresh, logout, search, category filter, multi-tag all-match filter, selection, bulk tags/category/delete, details save, upload progress/retry, settings CRUD, and Edge-style `2 -> 5 -> 2` drag restoration. Capture workbench, settings, upload error, and active-sort screenshots; inspect console and failed requests.

- [ ] **Step 5: Verify responsive workflows**

At `768x1024` and `390x844`, verify filter drawer, single-column images, full-screen upload/details, bottom bulk toolbar, text containment, focus order, and no horizontal overflow.

- [ ] **Step 6: Verify reduced motion and rendering**

Use screenshot pixel coverage to confirm pages are nonblank. Emulate `prefers-reduced-motion: reduce`; sorting must work while sibling animation is disabled.

- [ ] **Step 7: Run final checks**

Run: `npm test`

Run: `git diff --check`

Run: `git status --short`

Expected: tests pass, diff check is clean, and status contains only intended changes.

- [ ] **Step 8: Commit verification fixes**

```powershell
git add public/assets/admin tests/templates.test.js
git commit -m "完善管理端响应式与无障碍体验"
```

## Spec Coverage Review

- Routes, login gate, `localStorage`, logout, and `401` reset: Tasks 3, 5, 6, and 8.
- Warm visual system, workbench layout, settings layout, responsive behavior: Tasks 5 through 8 and Task 11.
- Edge-style Pointer Events ordering and reduced motion: Task 4, integrated in Task 6, verified in Task 11.
- Atomic tag/category order persistence: Task 1.
- Search, all-match tags, category filters, rendering limits, details, and bulk actions: Tasks 7 and 8.
- R2 direct upload, batching, per-file state, and failed-item retry: Task 9.
- Legacy page/script deletion and public/admin asset separation: Task 10.
- Loading, empty, error, partial failure, dialogs, Toasts, focus, and mobile states: Tasks 5 through 9 and Task 11.
- Automated, API, responsive, accessibility, and browser verification: every task has focused tests; Task 11 runs the complete gate.

Self-review result: all design-spec requirements map to at least one implementation task; no unresolved scope gaps remain.
