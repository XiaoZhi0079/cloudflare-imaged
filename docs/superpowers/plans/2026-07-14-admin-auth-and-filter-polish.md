# 管理端认证与标签筛选微调实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除管理页面跳转时的验证表单闪现，并让无伪选项的多标签交集筛选具备清晰反馈。

**Architecture:** 保留现有 `localStorage` 密钥验证和 `library-state.js` 过滤模型。HTML 首屏同时隐藏认证区与管理区，由页面控制器在验证结果明确后选择显示；图片库控制器只渲染真实分类，并通过标签行状态类和计数呈现集合筛选。

**Tech Stack:** 原生 HTML/CSS/ES Modules、Node.js `node:test`、Playwright 浏览器验收。

---

### Task 1: 消除验证页面闪现

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/admin/settings.html`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: 写初始认证状态失败测试**

在 `tests/templates.test.js` 的共享认证测试中要求两个页面的认证区域初始带有 `hidden`：

```js
assert.match(html, /id="admin-auth-view"[^>]*hidden/);
assert.match(html, /id="admin-app"[^>]*hidden/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/templates.test.js`

Expected: FAIL，因为当前 `#admin-auth-view` 首屏可见。

- [ ] **Step 3: 隐藏两个页面的初始验证区域**

将两个模板的认证节点改为：

```html
<section id="admin-auth-view" class="admin-auth-view" hidden>
```

保留 `library-page.js` 和 `settings-page.js` 中现有 `showAuth()`；无本地密钥、退出和 `401` 仍通过 `elements.authView.hidden = false` 显示表单。

- [ ] **Step 4: 运行聚焦测试**

Run: `node --test tests/templates.test.js tests/admin-core.test.js`

Expected: all pass.

- [ ] **Step 5: 提交**

```powershell
git add public/admin/index.html public/admin/settings.html tests/templates.test.js
git commit -m "消除管理页面认证表单闪现"
```

### Task 2: 移除“全部图片”并强化多选反馈

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/assets/admin/library-page.js`
- Modify: `public/assets/admin/workbench.css`
- Modify: `tests/admin-library.test.js`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: 写筛选行为与界面失败测试**

在 `tests/admin-library.test.js` 增加空筛选与逐次多选测试：

```js
test("empty filters show every image and multiple tags use intersection", () => {
  const state = createLibraryState();
  state.setImages(images);
  assert.deepEqual(state.visibleImages().map((image) => image.id), [3, 2, 1]);
  state.setTagsFilter(new Set(["人像", "自然光"]));
  assert.deepEqual(state.visibleImages().map((image) => image.id), [1]);
});
```

在 `tests/templates.test.js` 读取控制器和模板，要求存在选中计数且不再包含伪分类名称：

```js
assert.match(html, /id="tag-filter-selected-count"/);
assert.doesNotMatch(controller, /name: "全部图片"/);
assert.match(controller, /filter-tag-option/);
assert.match(controller, /is-selected/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/admin-library.test.js tests/templates.test.js`

Expected: 状态行为测试通过，界面契约测试失败，因为伪选项与多选反馈尚未修改。

- [ ] **Step 3: 删除伪分类并加入已选计数**

将主分类选项从合成数组改为只遍历真实分类：

```js
const categoryOptions = state.getCategories().map((category) => ({
  ...category,
  count: categoryCounts.get(Number(category.id)) ?? 0,
}));
```

将标签标题改为包含动态计数：

```html
<h3>标签（全部匹配） <span id="tag-filter-selected-count">已选 0</span></h3>
```

在 `elements` 中缓存计数节点，并在 `renderFilters()` 中更新：

```js
elements.selectedTagCount.textContent = `已选 ${tagNames.size}`;
```

- [ ] **Step 4: 呈现并同步多选状态**

标签行使用独立类和选中态：

```js
const selected = tagNames.has(tag.name);
const label = createElement("label", {
  className: `filter-option filter-tag-option${selected ? " is-selected" : ""}`,
});
```

复选框变化时同步状态类，避免替换当前焦点元素：

```js
label.classList.toggle("is-selected", input.checked);
elements.selectedTagCount.textContent = `已选 ${next.size}`;
```

在 `workbench.css` 中增加明确但克制的反馈：

```css
.filter-tag-option { border:1px solid transparent; }
.filter-tag-option.is-selected {
  border-color:rgba(180,78,39,.34);
  background:rgba(180,78,39,.09);
  box-shadow:inset 3px 0 var(--admin-accent);
}
#tag-filter-selected-count { color:var(--admin-accent); font-weight:800; }
```

- [ ] **Step 5: 运行聚焦和完整测试**

Run: `node --test tests/admin-library.test.js tests/templates.test.js`

Expected: all focused tests pass.

Run: `npm test`

Expected: `0` failures.

- [ ] **Step 6: 浏览器验证**

在 `1440x900` 下：

1. 预置有效 `gallery-admin-key`，从 `/admin/` 跳到 `/admin/settings.html` 再返回。
2. 每次导航监听 `#admin-auth-view`，确认从未进入可见状态。
3. 确认主分类列表中没有“全部图片”。
4. 同时选中两个标签，确认两个标签行都保留选中样式、计数为 `已选 2`，结果为交集。
5. 点击“清空”，确认计数为 `已选 0` 且恢复全部图片。

- [ ] **Step 7: 提交**

```powershell
git add public/admin/index.html public/assets/admin/library-page.js public/assets/admin/workbench.css tests/admin-library.test.js tests/templates.test.js
git commit -m "完善图片库多标签筛选反馈"
```

### Task 3: 将 R2 目录移出内容筛选

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/assets/admin/library-state.js`
- Modify: `public/assets/admin/library-page.js`
- Modify: `public/assets/admin/workbench.css`
- Modify: `tests/admin-library.test.js`
- Modify: `tests/templates.test.js`

- [ ] **Step 1: 写职责边界失败测试**

更新状态测试，使筛选只接收查询和标签，并断言状态不再暴露分类筛选方法：

```js
assert.deepEqual(
  filterImages(images, { query: "", tagNames: new Set(["人像", "自然光"]) }),
  [images[0]],
);
const state = createLibraryState();
assert.equal(state.setCategory, undefined);
assert.equal("categoryId" in state.getFilters(), false);
```

更新模板测试，要求左侧没有主分类筛选，但管理端卡片仍输出目录标识：

```js
assert.doesNotMatch(html, /id="category-filter-list"/);
assert.doesNotMatch(html, /<h3>主分类<\/h3>/);
assert.match(renderImageCard(image), /Portrait/);
assert.doesNotMatch(renderGalleryCards([image]), /Portrait/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/admin-library.test.js tests/templates.test.js`

Expected: FAIL，因为状态和页面仍保留分类筛选。

- [ ] **Step 3: 从状态层移除分类筛选**

将 `filterImages` 参数缩减为查询与标签：

```js
export function filterImages(images, { query = "", tagNames = new Set() } = {}) {
  return images.filter((image) => {
    // 保留查询和全部标签匹配，不判断 image.category。
  });
}
```

从 `createLibraryState` 删除 `categoryId`、`setCategory()`，并从 `getFilters()`、`resetFilters()` 与 `visibleImages()` 中移除分类过滤数据。`categories`、`setCategories()` 和 `getCategories()` 保留给管理操作。

- [ ] **Step 4: 删除左侧主分类区块与控制器代码**

模板筛选栏只保留标签区：

```html
<aside id="admin-filters" class="filter-rail">
  <div class="filter-head">...</div>
  <section><!-- 标签多选 --></section>
</aside>
```

从 `library-page.js` 删除 `categoryFilters` 元素引用、分类计数和分类单选框渲染。上传对话框仍使用 `state.getCategories()`，但不再从已删除的筛选状态预选目录：

```js
category.append(createElement("option", { value: "" }, "选择主分类"));
for (const item of state.getCategories()) {
  category.append(createElement("option", { value: item.id }, `${item.name} /${item.directorySlug}`));
}
```

- [ ] **Step 5: 清理样式并运行测试**

将筛选列表选择器从：

```css
#category-filter-list,#tag-filter-list
```

改为：

```css
#tag-filter-list
```

Run: `node --test tests/admin-library.test.js tests/templates.test.js`

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: 浏览器验证并提交**

在 `/admin/` 确认左侧没有主分类区块；两个标签可同时选中；管理端图片卡片仍显示目录；上传、详情与批量移动的目录选择仍存在。

```powershell
git add public/admin/index.html public/assets/admin/library-state.js public/assets/admin/library-page.js public/assets/admin/workbench.css tests/admin-library.test.js tests/templates.test.js
git commit -m "移除图片库主分类筛选"
```
