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
