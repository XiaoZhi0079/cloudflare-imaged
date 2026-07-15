# D1 运行时初始化移除与标签切换性能设计

日期：2026-07-15
状态：已确认

## 背景与诊断证据

生产站点点击标签后，标签本身会立即高亮，但图库内容通常需要约 2–3 秒才更新。无图片内容的只读诊断已经把耗时定位到 Cloudflare Pages Functions 的 Repository/D1 路径：

- 静态 CSS 的 TTFB 约为 `93–128ms`；
- 不进入 Repository 的 `400/401` 响应平均约为 `90–132ms`；
- 一旦进入 Repository，即使查询不存在的标签并返回 0 张图片，TTFB 仍约为 `1.2s`；
- 浏览器实际标签切换中，API TTFB 为 `1.28–1.87s`，JSON 下载约 `1ms`，API 返回后的 DOM 更新约 `1–2ms`；
- 所有图片请求均在浏览器网络层被阻止，延迟仍然存在，因此图片加载、解码和 DOM 渲染不是主因。

根因是每个 Pages Function 请求都会通过 `getRepository(env)` 创建新的 Repository。Repository 内部的 `schemaReady` 只属于该实例，所以每个请求第一次调用方法时都会执行约 20 条初始化语句：PRAGMA、建表、迁移、建索引和默认数据写入检查，然后才执行真正的查询。公共 API 没有边缘缓存，因此每次标签点击都会重复该路径。

## 目标

- 生产 Repository 的在线请求不执行 `PRAGMA`、DDL、迁移、seed 或读时修复写入。
- `/api/public/images` 只执行获取图片及标签名称所必需的查询。
- `/api/public/tags` 和 `/api/public/site` 保持只读。
- 使用 Cloudflare D1 migrations 管理首次建库和未来 schema 变更。
- 本地开发和测试在请求前显式准备数据库，不依赖 Repository 自动建表。
- 不引入公共 API 边缘缓存，因此管理端修改后，前台重新请求即可读取最新数据。
- 部署后以相同的无图片诊断方法验证性能改善。

## 非目标

- 本阶段不增加 Cloudflare Cache API、浏览器持久缓存或 15 秒数据延迟。
- 本阶段不实现标签预取、加载骨架、请求取消或竞态处理；这些属于后续交互优化。
- 不合并图片与标签查询，不引入 ORM，也不更换 D1/R2 架构。
- 不修改图库图片、精选顺序、标签内容或其他生产业务数据。
- 不查看、渲染、截图或分析任何图片内容。

## 方案比较与决策

### 方案 A：正式 D1 migrations，运行时零初始化（采用）

将 schema 与 seed 放入版本化 migration，在本地或发布阶段显式执行。Repository 假定绑定的 D1 已准备好，在线请求只做业务查询。

优点：彻底消除热路径中的初始化；职责清晰；未来 schema 变更可追踪、可备份、可审计。
代价：首次环境和未来 schema 变更必须先执行 migration。

### 方案 B：生产环境传入“跳过初始化”选项（不采用）

保留 Repository 内部初始化，生产 `getRepository()` 传入关闭选项。

优点：改动较小。
缺点：schema 管理仍与业务查询耦合；新增入口若忘记传参会恢复性能问题，不属于结构性根治。

### 方案 C：模块级 Promise 或 WeakMap 缓存（不采用）

让同一个 Worker isolate 只初始化一次。

优点：温热 isolate 会更快。
缺点：冷启动和不同边缘 isolate 仍重复初始化；无法替代正式 migrations。

## 数据库迁移设计

### 迁移目录

新增 `migrations/0001_baseline.sql` 作为当前 schema 基线。Wrangler 默认使用 `migrations/`，并在 D1 的 `d1_migrations` 表中记录已应用文件。

基线 migration 包含：

- 当前 6 张业务表；
- 当前 7 个索引；
- 3 条默认分类 `INSERT ... ON CONFLICT DO NOTHING`；
- 2 条默认站点设置 `INSERT ... ON CONFLICT DO NOTHING`。

基线只使用幂等的 `CREATE ... IF NOT EXISTS` 和冲突忽略写入，不包含 `DROP`、覆盖更新或删除。现有生产库已经具有当前表和列，因此应用基线只会确认对象、补充缺失默认值，并由 Wrangler 记录 migration。Wrangler 应用 migration 时会创建备份；失败的 migration 会回滚。

### 生产迁移前置检查

在第一次应用基线前，使用只读 D1 命令检查：

- `images` 已包含 `category_id`、`width`、`height`、`sync_status` 和 `note`；
- 6 张业务表和 7 个索引存在；
- 当前 schema 没有与基线冲突的对象定义；
- `wrangler d1 migrations list GALLERY_DB --remote` 的待执行列表符合预期。

检查只输出表、列、索引和 migration 状态，不读取图片 URL、标签文本、文案或其他业务内容。

### 执行命令

本地：

```powershell
npx wrangler d1 migrations apply GALLERY_DB --local --persist-to ./.wrangler/state
```

生产：

```powershell
npx wrangler d1 migrations apply GALLERY_DB --remote
```

生产 migration 必须先成功，再部署任何依赖新 schema 的代码。本次代码不新增列，且当前生产 schema 已经存在，所以迁移与代码回滚互不破坏。

## Repository 设计

### 显式初始化与业务查询分离

- `createGalleryRepository(database)` 不再拥有 `schemaReady` 或 `ensureSchema()`。
- Repository 方法不再调用自动初始化。
- 现有 schema、migration、index 与 seed 常量从业务查询热路径移出。
- `DEFAULT_SITE_SETTINGS` 可继续作为只读响应的容错默认值，但不在请求中写入 D1。

生产调用链变为：

```text
标签点击
→ GET /api/public/images?tag=...
→ createGalleryRepository(env.GALLERY_DB)
→ SELECT 图片
→ 必要时 SELECT 图片标签
→ JSON 响应
```

### 删除读时写入

当前 `listVisibleTags()`、`listTags()` 和 `listCategories()` 会在读取前规范化排序。根治后，读取方法不得更新数据库：

- `listVisibleTags()` 直接执行可见标签查询；
- `listTags()` 和 `listCategories()` 直接读取排序后的记录；
- 连续排序只在创建、更新、删除和显式重排等管理写操作中维护；
- 生产迁移前只读检查现有排序状态，若存在异常，使用独立、可审计的修复步骤处理，而不是在公共请求中隐式修复。

## 本地开发与测试

### 本地启动

- `package.json` 增加 `db:migrate:local`。
- `start-local.cmd` 在启动 `wrangler pages dev` 前应用本地 migrations；迁移失败时停止启动。
- `.wrangler/state` 继续保存本地 D1 状态。
- 本地 seed 脚本在 migration 完成后运行，不负责建表。

### 测试数据库

- 测试 helper 在创建内存 SQLite 后显式应用基线 schema/migration。
- 目前依赖“空库自动建表”的测试改为验证“显式 migration 可准备空库”。
- 已经读取 `schema.sql` 的测试统一迁移到共享测试数据库 helper，避免每个文件重复准备逻辑。
- `schema.sql` 暂时作为兼容快照保留；增加结构一致性测试，防止它与 baseline migration 漂移。后续可在单独任务中移除快照。

## 自动化验证

新增查询边界测试，使用记录 SQL 的数据库适配器或代理验证：

- 公共 API 请求不执行 `PRAGMA`、`CREATE`、`ALTER`、`DROP`、`INSERT`、`UPDATE` 或 `DELETE`；
- 空标签 `/api/public/images` 最多执行 1 条业务 `SELECT`；
- 非空标签最多执行 2 条业务 `SELECT`；
- `/api/public/tags` 只读且不再规范化写入；
- `/api/public/site` 只读；
- migration 可在全新本地数据库成功执行，也可安全重复检查已准备的 schema；
- 现有 Repository、API、管理端和公开页面测试全部通过。

## 发布流程

1. 在隔离工作树按 TDD 实施。
2. 对新的 migration 和 SQL 边界测试完成 RED/GREEN。
3. 运行完整测试、语法检查和 `git diff --check`。
4. 独立检查范围、migration 安全、隐私与生产查询边界。
5. 对生产 D1 执行只读 schema/migration 前置检查。
6. 应用 `0001_baseline.sql` 到生产 D1，确认没有待执行 migration。
7. 正常推送 GitHub `main`，等待 CI 和 Cloudflare Pages 部署。
8. 通过 HTTP 时序和阻断图片的浏览器脚本验收，不截图、不读取图片内容。

本次不把 migration 自动放进 Pages 构建命令或 GitHub CI。当前项目规模下，生产 migration 作为显式发布步骤更安全；未来若需要自动化，应使用受保护的 GitHub Environment 和最小权限 Cloudflare API Token 单独设计。

## 性能验收

使用部署前相同方法重复测量：

- 不进入 Repository 的 `400/401` 继续作为网络/Function 基线；
- 对所有现有标签执行多轮 `/api/public/images` TTFB 测量；
- 浏览器阻止所有 image 请求，记录标签高亮、API TTFB、下载、DOM 更新时间；
- 不输出标签名、图片 URL、文案或图片内容。

验收门槛：

- 公共请求运行时 DDL/DML 测试必须为 0；
- 标签 API TTFB 中位数目标低于 `400ms`；
- 无论绝对网络条件如何，中位数相对当前基线至少改善 `60%`；
- API 返回后的 DOM 更新时间继续低于 `20ms`；
- 若移除初始化后仍未达到目标，先调查 D1 数据库位置与查询路径，不使用边缘缓存掩盖问题。

## 回滚与失败处理

- migration 前置检查不符合预期时停止，不应用 migration、不部署代码。
- migration 失败时依赖 Wrangler/D1 回滚，并保持当前生产代码。
- migration 成功但代码部署失败时，baseline 仅为幂等、增量对象，可以安全保留。
- 新代码出现回归时使用 `git revert` 普通推送；baseline migration 无需回滚。
- 不使用强推，不删除生产表，不自动清理 D1/R2 业务数据。

## 成功标准

- 根因修复通过自动化 SQL 边界测试，而不是仅靠缓存或加载动画隐藏。
- 当前 2–3 秒标签切换明显下降，并满足性能验收门槛。
- 管理端修改后，前台下一次请求立即读取最新数据。
- 本地开发、测试和首次部署均有明确、可重复的数据库准备步骤。
- GitHub、Cloudflare Pages、D1 和 R2 的现有绑定与域名保持不变。
