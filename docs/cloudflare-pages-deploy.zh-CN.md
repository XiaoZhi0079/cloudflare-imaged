# Cloudflare Pages 部署步骤

这份文档对应当前独立 `gallery` 项目。

## 先看结论

当前推荐架构：

- GitHub 仓库作为代码源
- Cloudflare Pages 直接连接 GitHub 仓库
- Cloudflare D1 作为图片与标签元数据数据库
- Cloudflare R2 作为图片文件存储
- GitHub Actions 只做 CI，不负责部署

## 第一步：形成最终待发布的 `main` 提交

先完成代码审查、自动化测试和隐私安全的页面验收，再把已审查的功能分支本地合并到 `main`。生产 D1 preflight 只能针对最终待推送提交执行，不能在功能仍未提交或仍会变更时提前迁移。

进入正确仓库并确认最终状态：

```powershell
cd "D:\GoodTry\Image-Gallery"
git switch main
git status --short --branch
git remote -v
npm test
git diff --check
Get-Content .\wrangler.toml
if (git status --porcelain) { throw "发布前工作区必须干净" }
if ((git branch --show-current) -ne "main") { throw "生产发布只能从 main 执行" }
$releaseSha = git rev-parse HEAD
$releaseSha
```

确认 `wrangler.toml` 中 `GALLERY_DB` 的 `database_name`、`database_id` 和当前 Cloudflare 账户一致；R2 绑定仍为 `GALLERY_BUCKET`。记录 `$releaseSha` 后不得再修改或提交代码。

正确顺序是：功能分支验证与审查 → 本地合并到 `main` → 固定最终 SHA 和配置 → 生产 D1 只读 preflight → 应用 migration → 确认 SHA 未变 → 普通推送同一 SHA → 等待 GitHub CI 与 Cloudflare Pages。

## 第二步：执行完整的生产 D1 只读 preflight

Repository 的在线请求不会自动建表、建索引或 seed。首次部署当前版本前，必须显式应用 `migrations/` 中的版本化 migration。

先确认登录身份和待执行列表：

```powershell
npx wrangler whoami
npx wrangler d1 migrations list GALLERY_DB --remote
```

下面的检查只读取 schema、数量与排序数值，不读取图片 URL、文件名、标签名称、分类名称、站点文案或图片内容。

先核对六张业务表及 migration 记录：

```powershell
npx wrangler d1 execute GALLERY_DB --remote --command "SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
```

逐表核对完整列定义：

```powershell
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(tags)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(categories)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(images)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(image_tags)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(site_settings)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(featured_images)"
```

逐表核对全部外键；没有外键的表应返回空结果：

```powershell
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA foreign_key_list(tags)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA foreign_key_list(categories)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA foreign_key_list(images)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA foreign_key_list(image_tags)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA foreign_key_list(site_settings)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA foreign_key_list(featured_images)"
```

核对七个业务索引的完整 SQL：

```powershell
npx wrangler d1 execute GALLERY_DB --remote --command "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name IN ('idx_tags_visible_order', 'idx_categories_order', 'idx_images_file_id', 'idx_images_category_id', 'idx_image_tags_image_id', 'idx_image_tags_tag_id', 'idx_featured_images_order') ORDER BY name"
```

最后只用聚合数值检查标签与分类排序，不输出任何名称：

```powershell
npx wrangler d1 execute GALLERY_DB --remote --command "SELECT 'tags' AS entity, COUNT(*) AS row_count, COUNT(DISTINCT sort_order) AS distinct_sort_orders, MIN(sort_order) AS min_sort_order, MAX(sort_order) AS max_sort_order, SUM(CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END) AS null_sort_orders FROM tags UNION ALL SELECT 'categories' AS entity, COUNT(*) AS row_count, COUNT(DISTINCT sort_order) AS distinct_sort_orders, MIN(sort_order) AS min_sort_order, MAX(sort_order) AS max_sort_order, SUM(CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END) AS null_sort_orders FROM categories"
```

必须确认：六张表的列与 `schema.sql` 一致；外键目标和删除行为一致；七个索引名称与 SQL 一致；聚合结果没有异常空排序；待执行列表只有本次审查过的 migration。任何一项不一致都应停止发布，不得尝试用写入命令“顺手修复”。

## 第三步：迁移、推送同一 SHA 并等待部署

只读 preflight 通过后应用 migration，并再次检查待执行列表：

```powershell
npx wrangler d1 migrations apply GALLERY_DB --remote
npx wrangler d1 migrations list GALLERY_DB --remote
```

`0001_baseline.sql` 只使用 `CREATE ... IF NOT EXISTS` 和 `ON CONFLICT DO NOTHING`，不会删除或覆盖业务数据。migration 失败时停止发布，不推送依赖该结构的新代码。生产 migration 不放入 Pages build 或 GitHub CI。

确认本地仍是完全相同的已审查提交，然后普通推送：

```powershell
if ((git rev-parse HEAD) -ne $releaseSha) { throw "migration 后 HEAD 发生变化，停止发布" }
if (git status --porcelain) { throw "migration 后工作区发生变化，停止发布" }
git push -u origin main
```

如果 Git 提示无法快进，应停止发布，获取并审查远端提交后重新执行整套验证和 D1 preflight；不得强推。推送成功后等待 GitHub CI 与 Cloudflare Pages 部署同一个 `$releaseSha`，再进行只读 API、DOM 和时序验收。

## 第四步：在 Cloudflare 中连接 GitHub 仓库

进入：

- `Cloudflare Dashboard`
- `Workers & Pages`
- `Create application`
- `Pages`
- `Connect to Git`

然后：

1. 选择 GitHub
2. 授权并选择仓库 `cloudflare-imaged`
3. 选择生产分支 `main`

## 第五步：配置 Pages 构建参数

如果 Cloudflare 让你手动填写构建信息，使用：

- Framework preset: `None`
- Build command: 留空
- Build output directory: `public`
- Root directory: 留空

## 第六步：确认 Wrangler 配置

本项目的 `wrangler.toml` 需要至少包含：

- `pages_build_output_dir = "./public"`
- D1 绑定 `GALLERY_DB`
- R2 绑定 `GALLERY_BUCKET`

如果 Cloudflare 检测到 `wrangler.toml` 并自动读取，这是正常行为。

## 第七步：在 Cloudflare Pages 中配置变量和密钥

进入：

- `Workers & Pages`
- 你的 Pages 项目
- `Settings`
- `Variables and Secrets`

至少设置这些：

- `GALLERY_ADMIN_KEY`
- `GALLERY_PUBLIC_BASE_URL`
- `GALLERY_UPLOAD_NAME_TYPE`
- `GALLERY_UPLOAD_FOLDER`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

推荐值：

- `GALLERY_UPLOAD_NAME_TYPE=origin`
- `GALLERY_UPLOAD_FOLDER=gallery`
- `GALLERY_PUBLIC_BASE_URL=https://你的正式域名/file`

## 第八步：绑定 D1 和 R2

在 Pages 项目中确认：

- D1 绑定名是 `GALLERY_DB`
- R2 绑定名是 `GALLERY_BUCKET`

名字必须和代码里的绑定保持一致，不能改成别的。

## 第九步：配置 R2 CORS

由于浏览器会直接上传到 R2，R2 存储桶必须允许你的站点跨域上传。

至少允许：

- Pages 预览域名
- 你的正式自定义域名

示例：

```json
[
  {
    "AllowedOrigins": [
      "https://your-pages-domain.pages.dev",
      "https://your-custom-domain.example"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 第十步：首次上线后做冒烟验证

至少验证这些：

1. 首页能打开
2. 后台 `/admin/` 能打开
3. 输入管理密钥能进入后台
4. 新建标签成功
5. 上传 1 张图片成功
6. 图片能通过 `/file/...` 打开
7. 前台按标签筛选正常
8. `/api/public/site` 返回 JSON，而不是静态 HTML
9. 管理端“站点”页可以保存期名、文案和精选顺序
10. 首页轮播可以暂停，且删除精选图片后数量同步

## 回滚原则

如果新部署破坏核心浏览流程，使用 `git revert` 创建回滚提交并普通推送，让 Cloudflare 部署回滚后的 `main`。baseline migration 可以安全保留；不要删除生产数据表，也不要强推远端历史。
