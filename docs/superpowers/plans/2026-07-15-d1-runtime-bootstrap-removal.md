# D1 Runtime Bootstrap Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用正式 Cloudflare D1 migration 取代每次请求中的建表、迁移、索引和 seed，使公开读取路径只执行必要的业务 `SELECT`。

**Architecture:** `migrations/0001_baseline.sql` 成为 schema 与默认数据的部署入口；测试 helper 显式把 migration 应用到内存 SQLite；`createGalleryRepository()` 只负责业务查询和写入，不再感知 schema 生命周期。生产发布先只读检查、再应用 migration、最后部署代码。

**Tech Stack:** Cloudflare Pages Functions、D1/SQLite、Wrangler migrations、原生 JavaScript ES modules、Node.js `node:test`

---

## File map

- Create: `migrations/0001_baseline.sql` — 六张业务表、七个索引和五条幂等默认 seed。
- Create: `tests/helpers/test-database.js` — 从 baseline migration 显式准备内存 SQLite。
- Create: `tests/d1-migrations.test.js` — fresh/reapply/快照一致性测试。
- Create: `tests/runtime-sql-boundary.test.js` — 记录公共请求及 Repository 读取路径执行的 SQL。
- Modify: `src/server/gallery-repository.js` — 删除 schema/seed 常量、`schemaReady`、`ensureSchema()` 和读取时排序写入。
- Modify: `tests/*.test.js` — 统一使用显式 migration helper，删除空库自动初始化预期。
- Modify: `package.json` — 增加本地 migration 命令并让 `dev` 先迁移。
- Modify: `start-local.cmd` — 启动 Pages 前应用 local migration，失败即退出。
- Modify: `start-local.sh` — 启动 Pages 前应用 local migration，失败即退出。
- Modify: `tests/demo-db-files.test.js` — 固定本地启动必须先迁移的契约。
- Modify: `README.md`、`docs/cloudflare-pages-deploy.zh-CN.md` — 记录 local/remote migration 与回滚顺序。

### Task 1: 建立 baseline migration 与测试数据库入口

**Files:**
- Create: `tests/d1-migrations.test.js`
- Create: `tests/helpers/test-database.js`
- Create: `migrations/0001_baseline.sql`

- [ ] **Step 1: 写 migration 的失败测试**

测试读取 `migrations/0001_baseline.sql`，在 `:memory:` SQLite 执行两次，断言六张表、七个索引、三个默认分类和两个默认站点设置；再把 `schema.sql` 与 baseline 分别应用到空库，对比 `sqlite_master` 中业务表和索引的标准化 SQL。

```js
test("baseline migration prepares a fresh database and is idempotent", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(BASELINE_SQL);
  database.exec(BASELINE_SQL);
  assert.deepEqual(objectNames(database, "table"), BUSINESS_TABLES);
  assert.deepEqual(objectNames(database, "index"), BUSINESS_INDEXES);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM categories").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM site_settings").get().count, 2);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/d1-migrations.test.js`

Expected: FAIL，原因是 baseline migration 或 helper 尚不存在。

- [ ] **Step 3: 写最小 baseline 与 helper**

`0001_baseline.sql` 复制当前六表七索引结构，并追加：

```sql
INSERT INTO categories (name, directory_slug, sort_order)
VALUES ('性感美人', 'sexy-beauty', 1),
       ('气质美人', 'elegant-beauty', 2),
       ('风景', 'scenery', 3)
ON CONFLICT DO NOTHING;

INSERT INTO site_settings (key, value)
VALUES ('issue_name', '图集'),
       ('hero_copy', '慢慢看，挑一份喜欢的气质。本期以红调与侧光为主，适合夜色、轮廓与留白。')
ON CONFLICT(key) DO NOTHING;
```

helper 导出 `BASELINE_SQL` 和：

```js
export function createTestDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(BASELINE_SQL);
  return database;
}
```

- [ ] **Step 4: 运行 migration 测试并确认 GREEN**

Run: `node --test tests/d1-migrations.test.js`

Expected: PASS，fresh、重复执行、seed 和 schema 快照一致性全部通过。

- [ ] **Step 5: 提交**

```powershell
git add migrations/0001_baseline.sql tests/helpers/test-database.js tests/d1-migrations.test.js
git commit -m "feat: add D1 baseline migration"
```

### Task 2: 让所有测试显式准备数据库

**Files:**
- Modify: `tests/api-handlers.test.js`
- Modify: `tests/bulk-category-api.test.js`
- Modify: `tests/categories-api.test.js`
- Modify: `tests/categories-repository.test.js`
- Modify: `tests/direct-upload.test.js`
- Modify: `tests/gallery-repository.test.js`
- Modify: `tests/reorder-api.test.js`
- Modify: `tests/site-api.test.js`
- Modify: `tests/site-settings-repository.test.js`
- Modify: `tests/upload-categories.test.js`

- [ ] **Step 1: 把空库自动初始化测试改成显式 migration 契约**

将 `public tags handler bootstraps...`、`listVisibleTags bootstraps...`、`listCategories bootstraps...`、`getSiteSettings seeds...` 改名并改为通过 `createTestDatabase()` 创建数据库。legacy `images` 表迁移测试改为 baseline 结构一致性测试覆盖，不再要求 Repository 执行 `ALTER TABLE`。

- [ ] **Step 2: 运行受影响测试并确认当前实现仍可通过**

Run: `node --test tests/api-handlers.test.js tests/categories-repository.test.js tests/gallery-repository.test.js tests/site-settings-repository.test.js`

Expected: PASS；这一步只改变环境准备，不改变业务行为。

- [ ] **Step 3: 替换重复的 `readFileSync(schema.sql)` helper**

所有列出的测试文件统一：

```js
import { createTestDatabase } from "./helpers/test-database.js";
```

并用 `createTestDatabase()` 取代 `new DatabaseSync(":memory:") + schema.sql`。确需空库的 migration 专项测试只保留在 `d1-migrations.test.js`。

- [ ] **Step 4: 运行全部数据库/API 测试**

Run: `npm test`

Expected: 157 项或更多全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add tests
git commit -m "test: prepare gallery databases explicitly"
```

### Task 3: 以 SQL 边界测试锁定运行时零初始化

**Files:**
- Create: `tests/runtime-sql-boundary.test.js`
- Modify: `src/server/gallery-repository.js`

- [ ] **Step 1: 写公共 API 和读取方法的失败测试**

用代理包装已经 migration 完成的 `DatabaseSync`，记录传入 `prepare()` 与 `exec()` 的 SQL。断言：

```js
const FORBIDDEN_READ_SQL = /\b(PRAGMA|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i;
assert.equal(statements.some((sql) => FORBIDDEN_READ_SQL.test(sql)), false);
```

覆盖 `/api/public/tags`、空结果 `/api/public/images?tag=missing`、非空结果图片 API、`/api/public/site`、`repository.listTags()`、`repository.listCategories()`。同时断言空标签结果只执行 1 条 `SELECT`，非空标签最多执行 2 条 `SELECT`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/runtime-sql-boundary.test.js`

Expected: FAIL，记录到 `PRAGMA`、`CREATE`、seed `INSERT` 或读取时 `UPDATE`。

- [ ] **Step 3: 删除 Repository 运行时 schema 生命周期**

从 `gallery-repository.js` 删除 `DEFAULT_CATEGORIES`、`SCHEMA_STATEMENTS`、`MIGRATION_STATEMENTS`、`INDEX_STATEMENTS`、两个 seed 函数、`schemaReady`、`ensureSchema()` 及所有 `await ensureSchema()`。保留 `DEFAULT_SITE_SETTINGS` 仅作为只读缺省映射。

- [ ] **Step 4: 删除读取时排序写入**

实现保持为：

```js
async listTags() {
  return await listTagsOrdered(database);
},
async listVisibleTags() {
  return await all(database, VISIBLE_TAGS_QUERY);
},
async listCategories() {
  return await listCategoriesOrdered(database);
},
```

创建、更新、删除和显式重排路径继续维护连续排序。

- [ ] **Step 5: 运行边界测试并确认 GREEN**

Run: `node --test tests/runtime-sql-boundary.test.js`

Expected: PASS；公共读取无 DDL/DML，图片查询数满足上限。

- [ ] **Step 6: 运行 Repository/API 回归**

Run: `node --test tests/gallery-repository.test.js tests/categories-repository.test.js tests/site-settings-repository.test.js tests/api-handlers.test.js tests/site-api.test.js`

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```powershell
git add src/server/gallery-repository.js tests/runtime-sql-boundary.test.js
git commit -m "perf: remove D1 bootstrap from request paths"
```

### Task 4: 把 local migration 变成启动前置步骤

**Files:**
- Modify: `tests/demo-db-files.test.js`
- Modify: `package.json`
- Modify: `start-local.cmd`
- Modify: `start-local.sh`

- [ ] **Step 1: 写启动脚本失败测试**

新增断言三个入口都包含 `wrangler d1 migrations apply GALLERY_DB --local --persist-to ./.wrangler/state`，并且 migration 文本位置在 `pages dev` 前；Windows 脚本包含失败退出，shell 脚本依赖 `set -euo pipefail`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test tests/demo-db-files.test.js`

Expected: FAIL，当前入口没有 migration 步骤。

- [ ] **Step 3: 更新启动入口**

`package.json` 增加：

```json
"db:migrate:local": "wrangler d1 migrations apply GALLERY_DB --local --persist-to ./.wrangler/state",
"dev": "npm run db:migrate:local && wrangler pages dev ./public --compatibility-date 2026-03-02 --ip 127.0.0.1 --port 8788 --persist-to ./.wrangler/state"
```

`start-local.cmd` 在 `pages dev` 前调用 `npx.cmd wrangler d1 migrations apply...` 并检查 `errorlevel`；`start-local.sh` 在 `exec npx wrangler pages dev...` 前执行相同 migration。

- [ ] **Step 4: 运行脚本契约并确认 GREEN**

Run: `node --test tests/demo-db-files.test.js`

Expected: PASS。

- [ ] **Step 5: 实际应用 local migration**

Run: `npm run db:migrate:local`

Expected: Wrangler 报告 `0001_baseline.sql` 已应用或无待执行 migration，退出码 0。

- [ ] **Step 6: 提交**

```powershell
git add package.json start-local.cmd start-local.sh tests/demo-db-files.test.js
git commit -m "build: migrate local D1 before startup"
```

### Task 5: 文档、全量验证与生产迁移准备

**Files:**
- Modify: `README.md`
- Modify: `docs/cloudflare-pages-deploy.zh-CN.md`
- Modify: `docs/superpowers/specs/2026-07-15-d1-runtime-bootstrap-removal-design.md`

- [ ] **Step 1: 写清本地与生产顺序**

文档给出精确命令：

```powershell
npm run db:migrate:local
npx wrangler d1 migrations list GALLERY_DB --remote
npx wrangler d1 migrations apply GALLERY_DB --remote
```

注明生产必须“只读 schema preflight → remote migration → 代码部署”，baseline 不删除或覆盖业务数据，代码回滚使用普通 `git revert`。

- [ ] **Step 2: 更新规格实施证据但不预先声称性能达标**

只记录自动化 SQL 边界与本地 migration 证据；生产 TTFB 必须部署后实测再填写。

- [ ] **Step 3: 运行完整验证**

Run: `npm test`

Run: `node --check src/server/gallery-repository.js`

Run: `node --check functions/api/admin/_shared.js`

Run: `git diff --check`

Expected: 全部退出 0、测试 0 失败。

- [ ] **Step 4: 提交**

```powershell
git add README.md docs/cloudflare-pages-deploy.zh-CN.md docs/superpowers/specs/2026-07-15-d1-runtime-bootstrap-removal-design.md
git commit -m "docs: document D1 migration release flow"
```
