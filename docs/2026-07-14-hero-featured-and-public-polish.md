# 前台轻品牌与大屏精选 — 变更与后续计划

日期：2026-07-14
状态：核心功能与发布安全修复已落地；自动测试与本地浏览器验收通过；生产环境仍待验证
更新：2026-07-15

---

## 1. 背景

公开画廊原先存在两类问题：

1. **文案偏工具感**：Hero 像功能说明，卡片/弹层暴露文件名，空状态/错误信息偏后台。
2. **缺少可运营的首屏大图区**：首页没有「精彩大图 + 一句氛围文案」的展示位；管理端也无法配置。

目标不是引入完整「图集/多期历史」产品，而是：

- 前台更克制、更像画廊
- 顶部大屏可手动精选
- 本期只保留：名字 + 张数（张数由精选数推导）
- 大屏文案仅一行，可在管理端编辑

---

## 2. 已完成的改变

### 2.1 前台文案与展示去工具化（轻品牌）

| 项 | 之前 | 现在 |
|----|------|------|
| 页面标题/气质 | 功能说明式文案 | 轻品牌；后续改为动态「本期」信息 |
| 卡片悬停 | 显示 `fileName` + 标签 | 只显示标签 |
| 大图弹层 | `fileName · 标签` | 只显示标签 |
| 「未分配标签」 | 可能出现 | 前台不再展示 |
| 空状态 | 「当前标签下还没有图片。」 | 「这个标签下暂时还没有内容，换一个看看。」 |
| 错误 | 直接展示 `error.message` | 「图集暂时打不开，请稍后再试。」 |
| 空状态多栏拆字 | 瀑布流把长句拆到两栏 | 空状态强制单列 / 整行占满 |

涉及文件：

- `public/index.html`
- `public/assets/gallery.js`
- `public/assets/templates.js`
- `src/shared/templates.js`
- `public/assets/main.css`
- `tests/templates.test.js`

### 2.2 杂志感原型（仅文档/原型，未接业务）

路径：`docs/prototypes/magazine/`

- `01-cover-issue.html` — 封面特刊线框
- `02-editorial-wall.html` — 编辑墙线框
- `03-immersive-reader.html` — 沉浸阅读线框
- `advanced-01-03.html` — 01+03 仓库内脱敏素材交互原型
- `index.html` — 总览

作用：对齐视觉方向；正式实现只采纳其中「大屏 + 一句文案」部分，不照搬图集体系。

### 2.3 大屏精选 + 轻量「本期」配置（已实现）

#### 数据模型

新增表（`schema.sql` + `src/server/gallery-repository.js` 运行时 bootstrap）：

```sql
site_settings(key, value, updated_at)
featured_images(image_id, sort_order, created_at)
```

配置键：

| key | 含义 | 默认 |
|-----|------|------|
| `issue_name` | 本期名字 | `图集` |
| `hero_copy` | 大屏唯一文案 | `慢慢看，挑一份喜欢的气质。本期以红调与侧光为主，适合夜色、轮廓与留白。` |

推导字段：

- `issueCount` = 精选图片数量（不单独存储）

Repository 新方法：

- `getSiteSettings()`
- `updateSiteSettings({ issueName?, heroCopy? })`
- `listFeaturedImages()`
- `setFeaturedImages(imageIds[])`
- 删除图片时同步清理 `featured_images`

#### API

| 路由 | 说明 |
|------|------|
| `GET /api/public/site` | 返回本期名、文案、精选图列表、张数 |
| `GET /api/admin/site` | 管理端读取（需密钥） |
| `PATCH /api/admin/site` | 更新文案/本期名/精选有序列表（需密钥） |

文件：

- `functions/api/public/site.js`
- `functions/api/admin/site.js`

#### 前台 UI

- 顶部大屏：展示精选图（多图轮播 + 点选；无精选则隐藏轮播，只留文案）
- 文案区：
  - `本期名字 · 本期 N 张`（无精选时只显示本期名字）
  - 一行 `hero_copy`

文件：

- `public/index.html`
- `public/assets/gallery.js`
- `public/assets/main.css`

#### 管理端 UI

- `内容设置` 增加 **站点** tab
- 可编辑：本期名字、大屏文案
- 可管理精选：从图片库勾选、上移/下移、移除、保存

文件：

- `public/admin/settings.html`
- `public/assets/admin/settings-page.js`
- `public/assets/admin/site-settings.js`
- `public/assets/admin/settings.css`
- `public/assets/admin/dialogs.js`（暴露 `open` 供选择器弹层使用）

#### 测试

- `tests/site-settings-repository.test.js`
- `tests/site-api.test.js`
- `tests/templates.test.js`（hero 容器与站点 tab 断言）
- `tests/public-data.test.js`
- `tests/hero-carousel.test.js`
- `tests/site-settings-controller.test.js`
- `tests/repository-safety.test.js`
- `tests/demo-db-files.test.js`

### 2.4 本地演示种子脚本

因本地可能没有真实上传图，新增：

- `scripts/seed-local-demo.mjs`
- `package.json` 脚本：`npm run seed:demo`

作用：

1. 生成 `public/demo/*.svg` 演示图
2. 写入本地 D1：标签、图片记录、本期配置、前 4 张精选

使用：

```bash
# 先启动本地服务一次（生成 D1 状态）
bash start-local.sh
# 或
.\start-local.cmd

# 再灌演示数据
npm run seed:demo
```

然后打开：

- http://127.0.0.1:8788/
- http://127.0.0.1:8788/admin/settings.html → 站点
- 默认密钥：`gallery-secret`

### 2.5 发布安全修复

2026-07-15 完成：

- 站点文案与精选列表通过同一事务批次更新；校验失败不会部分落库
- 精选 ID 使用严格正整数、去重复和存在性校验
- 公开站点配置失败时只降级 Hero，不再阻断标签浏览
- Hero 支持手动暂停、悬停/聚焦/页面隐藏暂停，并尊重减少动态效果偏好
- 管理端重新选图时保留已有精选顺序，新图片追加到末尾
- 公开 API 不再显式返回 `fileName` 与分类字段
- `public/demo/` 已忽略；种子脚本按 SQLite 实际字节大小选择数据库
- GitHub 同步脚本改为普通推送，保留非快进保护
- 本地启动脚本将运行时配置显式传给 Wrangler bindings；干净环境默认管理密钥可用
- `npm test`：131 项全部通过

---

## 3. 将要做 / 建议后续做的改变

以下**尚未实现**或仅停留在原型/讨论，按优先级排列。

### P0 — 建议尽快确认

1. **本机完整验证（已完成）**
   - [x] 跑通 `npm test` / 站点相关测试（131 / 131）
   - [x] 隔离运行 `seed:demo` → 前台大屏 / 管理站点 tab
   - [x] 清空精选、改文案、选择与排序后前台同步

2. **生产库 schema 同步**
   - 本地有 repository bootstrap；生产若只依赖旧 `schema.sql` 手工执行，需确保新表已创建
   - 首次部署后检查 `site_settings` / `featured_images` 是否存在且有默认文案

### P1 — 产品增强（可选）

3. **精选选择体验**
   - 当前是设置页弹层勾选；可改为图片库批量操作「设为精选」
   - 或支持拖拽排序（现在是上移/下移）

4. **大屏交互剩余增强**
   - 进度指示更明显
   - 移动端手势滑动

5. **沉浸阅读（原型 03）**
   - 网格点开后的左右切换、模糊底、进度 `07 / N`
   - 与大屏精选独立，可后做

### P2 — 明确不做（除非需求升级）

6. **完整图集/多期系统**
   - 往期归档、多期切换、图集详情页
   - 当前只有「当前这一期」：名字 + 张数 + 精选图

7. **自动精选策略**
   - 最近上传 / 某标签自动入大屏
   - 当前坚持手动精选

8. **前台展示更多元数据**
   - 文件名、存储目录、同步状态等仍应留在管理端

---

## 4. 范围边界（当前共识）

| 要做 | 不做 |
|------|------|
| 大屏手动精选 | 多期历史图集 |
| 一行可编辑氛围文案 | 多段运营文案堆叠 |
| 本期名字 + 本期张数 | 图集详情/系列页 |
| 标签继续做主浏览方式 | 用「图集」替代标签体系 |
| 前台去文件名 | 前台暴露后台字段 |

---

## 5. 关键文件清单（实现相关）

### 后端 / 数据
- `schema.sql`
- `src/server/gallery-repository.js`
- `functions/api/public/site.js`
- `functions/api/admin/site.js`

### 前台
- `public/index.html`
- `public/assets/gallery.js`
- `public/assets/public-data.js`
- `public/assets/hero-carousel.js`
- `public/assets/templates.js`
- `src/shared/templates.js`
- `public/assets/main.css`

### 管理端
- `public/admin/settings.html`
- `public/assets/admin/settings-page.js`
- `public/assets/admin/site-settings.js`
- `public/assets/admin/settings.css`
- `public/assets/admin/dialogs.js`

### 测试 / 工具 / 原型
- `tests/site-settings-repository.test.js`
- `tests/site-api.test.js`
- `tests/templates.test.js`
- `tests/public-data.test.js`
- `tests/hero-carousel.test.js`
- `tests/site-settings-controller.test.js`
- `tests/repository-safety.test.js`
- `tests/demo-db-files.test.js`
- `scripts/demo-db-files.mjs`
- `scripts/seed-local-demo.mjs`
- `package.json`（`seed:demo`）
- `docs/prototypes/magazine/*`
- `start-local.sh`（本地启动辅助）

---

## 6. 验收清单

- [x] 管理端「站点」可改本期名字与大屏文案并保存
- [x] 管理端可手动选择/排序精选图
- [x] 前台大屏展示精选图；文案与配置一致
- [x] 前台显示「本期名字 · 本期 N 张」
- [x] 无精选时不出现破图或空轮播
- [x] 前台卡片/弹层不显示文件名（自动测试）
- [x] 标签浏览流程不受影响（自动测试）
- [x] 相关测试通过（131 / 131）

---

## 7. 备注

- 管理鉴权仍是单密钥 + `localStorage`，与既有设计一致。
- 演示 SVG 仅用于本地预览，不是生产内容，且已由 `.gitignore` 排除。
- 本地浏览器验收在临时隔离副本中执行并已清理；未修改生产 D1/R2。
