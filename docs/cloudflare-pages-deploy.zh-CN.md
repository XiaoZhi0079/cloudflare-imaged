# Cloudflare Pages 部署步骤

这份文档对应当前独立 `gallery` 项目。

## 先看结论

当前推荐架构：

- GitHub 仓库作为代码源
- Cloudflare Pages 直接连接 GitHub 仓库
- Cloudflare D1 作为图片与标签元数据数据库
- Cloudflare R2 作为图片文件存储
- GitHub Actions 只做 CI，不负责部署

## 第一步：确认 GitHub 仓库状态

核对日期：2026-07-15。

- 当前本地与远端差异必须以 `git status --short --branch` 和 `git log origin/main..main` 的实时输出为准。
- Cloudflare Pages 只部署已经普通推送到 GitHub `main` 的提交；本地提交不会自动上线。
- 发布前先确认工作区干净、测试通过，并使用普通快进推送；不得用文档中的历史 SHA 判断当前发布状态。

正确顺序是：本地验证 → 生产 D1 只读检查 → 应用待执行 migration → 精选暂存 → 提交 → 普通推送 → Cloudflare 部署检查。

## 第二步：只读检查并迁移生产 D1

Repository 的在线请求不会自动建表、建索引或 seed。首次部署当前版本前，必须显式应用 `migrations/` 中的版本化 migration。

先确认登录状态和待执行列表：

```powershell
npx wrangler whoami
npx wrangler d1 migrations list GALLERY_DB --remote
```

再执行只读 schema 检查。下面的命令只输出对象、列和索引定义，不读取图片 URL、标签文本、文案或其他业务数据：

```powershell
npx wrangler d1 execute GALLERY_DB --remote --command "SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA table_info(images)"
npx wrangler d1 execute GALLERY_DB --remote --command "PRAGMA index_list(images)"
```

确认当前六张业务表存在，`images` 包含 `category_id`、`width`、`height`、`sync_status`、`note`，并且待执行列表只有预期文件后，应用 migration：

```powershell
npx wrangler d1 migrations apply GALLERY_DB --remote
npx wrangler d1 migrations list GALLERY_DB --remote
```

`0001_baseline.sql` 只使用 `CREATE ... IF NOT EXISTS` 和 `ON CONFLICT DO NOTHING`，不会删除或覆盖业务数据。migration 失败时停止发布，不推送依赖该结构的新代码。生产 migration 不放入 Pages build 或 GitHub CI。

## 第三步：验证并安全推送

进入当前仓库：

```powershell
cd "D:\GoodTry\Image-Gallery"
```

当前远程已经配置为：

```powershell
git remote -v
```

应看到：

```text
origin  https://github.com/XiaoZhi0079/cloudflare-imaged.git
origin  https://github.com/XiaoZhi0079/cloudflare-imaged.git
```

推送前必须先验证并检查暂存内容：

如果本次修改了 `public/assets/main.css` 或 `public/assets/gallery.js`，先同步递增 `public/index.html` 中两个入口 URL 的 `?v` 发布版本，避免浏览器继续使用旧缓存。

```powershell
npm test
git diff --check
git status --short --branch
git diff --cached
```

确认提交内容后创建提交，再执行普通推送：

```powershell
git push -u origin main
```

也可以在工作区干净、提交已经创建后运行：

```powershell
.\sync-github.cmd
```

脚本只执行普通推送。如果 Git 提示无法快进，应先获取并审查远端提交，再决定合并或变基；不得自动覆盖远端历史。

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
