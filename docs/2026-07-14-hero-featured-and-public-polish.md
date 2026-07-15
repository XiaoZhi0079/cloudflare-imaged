# 前台轻品牌与大屏精选 — 变更与后续计划

日期：2026-07-14
状态：精选分档/筛选分离与 D1 热路径根治已合并、迁移并发布至 `gallery.140079.xyz`
更新：2026-07-16

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

新增表（`schema.sql` + `migrations/0001_baseline.sql`；Repository 在线请求不再执行运行时 bootstrap）：

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
# 启动入口会先应用本地 migration，再启动 Pages
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
- 有精选图时，Hero 本期名称与文案改为完全透明背景的图片内叠加；无精选时仍保持普通文档流
- `npm test`：133 项全部通过

### 2.6 发布与生产验收

2026-07-15 已发布提交 `40739c4`：

- GitHub Actions（Node 22）与 Cloudflare Pages 检查均成功
- 新首页、公开站点 API、标签 API、图片 API 与新增静态模块均返回 200
- 生产公开图片响应不含 `fileName` 与分类字段
- 既有 4 个可见标签与图片数据保持可读
- 无精选时 Hero 图片区隐藏，桌面/390px 移动端无页面横向溢出
- 干净浏览器会话控制台无错误或警告
- 未授权管理站点请求返回 401；未使用生产管理密钥执行写操作

### 2.7 精选尺寸资格、筛选分离与固定 `16:9` Hero（已发布）

2026-07-15 在功能分支完成以下改造：

- 精选资格使用单一共享规则：图片必须为**精确 `16:9` 且至少 `1920×1080`**。合规图片按 `resolutionTier` 分为 1K/1080p、2K、4K；`3840×2160` 及更高的精确 16:9 图片（例如 `7680×4320`）归入 4K 档。
- 管理图片库只保留搜索、标签交集、排序和批量管理，不再显示轮播资格筛选、档位徽标或不合规原因；中性宽高元数据仍可用于管理排查。
- “内容设置 → 站点 → 大屏精选”选择器独立提供“全部可用 / 4K / 2K / 1K/1080p”互斥筛选，只创建合规候选 DOM；切换档位不会丢失其他档位的勾选。
- 当前精选列表中的旧不合规项继续保留警告和“移除”操作；打开、切换或确认 picker 不会静默删除，保存前必须由用户显式移除。
- D1 中的 `images.width` / `images.height` 是服务端权威来源。`setFeaturedImages()` 与 `updateSiteConfiguration()` 在写入前使用共享规则校验全部 ID；任一图片缺失或不合规时，站点名称、Hero 文案与精选顺序作为一个原子操作全部保持原值。
- Hero 舞台固定为响应式 `aspect-ratio: 16 / 9`，图片使用 `object-fit: contain` 与居中定位，不再按视口高度裁切。移动端文案位于舞台下方的正常文档流中，并继续使用透明背景。
- 本次改动的管理端入口和依赖资产统一使用缓存版本 `20260715-featured-filter-separation`；前台 Hero 的缓存版本保持既有已验证值，未改全局缓存头。
- 部署前已经存在于生产 `featured_images` 的旧不合规精选**不会被读取路径自动过滤或删除**，公开站点仍会返回并完整展示。用户需要在管理端手动移除；移除后服务端不允许再次加入不合规图片。

本地验证证据：

- `npm test`：171 项测试，171 项通过，0 项失败。
- 相对基线变更的 26 个 JavaScript 文件全部通过 `node --check`，`bash -n start-local.sh` 与 `git diff --check cada320` 均退出 0。
- 隔离本地 D1 的 DOM 验收确认：图库无轮播筛选；标签交集有效；picker 的全部/4K/2K/1K 数量为 3/1/1/1；跨档勾选保持；legacy 项不会被静默删除，显式移除后保存为 200。
- 浏览器在导航前阻断所有图片请求，共阻断 21 次、收到 0 个图片响应，所有图片自然尺寸均为 0；未截图、未查看或分析图片内容。
- 本地实施与验收阶段未访问或写入生产 D1/R2；生产发布证据见 2.9。

### 2.8 D1 请求热路径根治（已发布）

- 新增 `migrations/0001_baseline.sql`，统一创建 6 张业务表、7 个索引和幂等默认数据；Repository 请求路径已移除 PRAGMA、DDL、seed 和读时排序写入。
- 公共 tags/images/site 的 SQL 边界测试证明读取只执行必要的业务 `SELECT`；空标签图片查询最多 1 条 SELECT，非空最多 2 条。
- 本地启动先执行 `wrangler d1 migrations apply`，再由 `wrangler.toml` 提供 Pages 的 D1 身份；已移除会创建另一份 `local-GALLERY_DB` 空库的 `pages dev --d1 GALLERY_DB` 覆盖。
- existing-schema 测试从 `schema.sql` 建库并写入哨兵图片、标签、关联、精选及自定义设置，baseline 连续应用两次后所有业务值保持不变。
- 发布顺序固定为：本地合并最终 `main` SHA → 完整生产 D1 只读 preflight → remote migration → 推送同一 SHA → GitHub/Cloudflare 验收。

### 2.9 生产发布与性能验收（已完成）

2026-07-16 首次发布 SHA `424dde2`：

- 生产 D1 只读 preflight 完整核对 6 张表的 `CREATE TABLE` SQL、列、外键、7 个业务索引和匿名排序连续性；未读取文件名、图片 URL、标签/分类名称或站点文案。
- `0001_baseline.sql` 成功应用且仅登记 1 条 migration；随后 `wrangler d1 migrations list` 返回无待执行项。应用后的匿名计数为 5 个标签、3 个分类、2 张图片、2 组图片标签关联、2 条站点设置、0 条精选。
- GitHub CI 在同一 SHA 上成功；Cloudflare Pages 项目 `cloudflare-imaged` 的生产部署 `fc87315d-e9e3-48c8-9cd5-50311d7d71f2` 使用同一 SHA，并绑定 `gallery.140079.xyz`。
- 5 个标签共 15 次公开图片 API 采样全部返回 200：TTFB 中位数 `128ms`、P95/最大值 `177.8ms`，相对根治前约 `1.2s` 的最低基线改善约 89%。
- 阻断图片请求的真实页面切换中，空标签 API/DOM 分别为 `148ms/150ms`，返回有内容标签为 `187ms/190ms`，API 后 DOM 更新约 `2–3ms`。
- 生产图库 DOM 有 0 个轮播筛选/资格控件并保留标签筛选；设置入口和模块包含全部可用、4K、2K、1K/1080p 四档逻辑；未授权管理 API 返回 401。
- 生产浏览器在首次导航前拦截全部 image 类型请求：4 次请求被阻断、图片响应为 0、自然尺寸为 0；未截图、未查看或分析图片内容，也未执行生产管理写操作。

---

## 3. 将要做 / 建议后续做的改变

以下**尚未实现**或仅停留在原型/讨论，按优先级排列。

### P0 — 已完成

1. **本机完整验证（已完成）**
   - [x] 跑通 `npm test` / 站点相关测试（133 / 133）
   - [x] 隔离运行 `seed:demo` → 前台大屏 / 管理站点 tab
   - [x] 清空精选、改文案、选择与排序后前台同步

2. **生产库 schema 同步（已完成）**
   - [x] 当前生产 `/api/public/site` 与既有标签/图片读取正常
   - [x] baseline migration 的 fresh、重复应用、schema 一致性和已有数据保全测试通过
   - [x] 在最终 `main` SHA 上完成六表完整 `CREATE TABLE` SQL/列定义、全部外键、七索引 SQL、排序连续性聚合和待执行 migration 的只读 preflight
   - [x] 应用 `0001_baseline.sql` 到生产 D1，确认无待执行 migration，再推送同一 SHA

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
- [x] 精选仅允许精确 `16:9` 且至少 `1920×1080`；合规图片按 1K/1080p、2K、4K 分档
- [x] 管理图片库只保留搜索与标签交集筛选；站点 picker 独立筛选全部可用、4K、2K、1K/1080p
- [x] 旧不合规精选保持只读兼容并可由用户手动移除
- [x] Hero 使用响应式 `16:9` + `contain`；移动端透明文案在舞台下正常流
- [x] Repository 公共读取路径不再执行运行时 DDL/DML；本地 migration 与 Pages 共用同一 D1 身份
- [x] 最终分支与合并后 `main` 全量测试均通过（171 / 171），GitHub CI 与 Cloudflare Pages 部署成功
- [x] 生产标签 API TTFB 中位数 `128ms`，浏览器标签切换完成于 `150–190ms`

---

## 7. 备注

- 管理鉴权仍是单密钥 + `localStorage`，与既有设计一致。
- 演示 SVG 仅用于本地预览，不是生产内容，且已由 `.gitignore` 排除。
- 本地浏览器验收在临时隔离副本中执行并已清理。
- 本轮只对生产 D1 执行 schema/匿名聚合 preflight 和版本化 baseline migration；未读取业务文本或图片内容，未执行生产管理 API 写操作或 R2 写入。
