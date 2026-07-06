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

当前本地 `gallery` 已经是独立 Git 仓库，但远端 `XiaoZhi0079/cloudflare-imaged` 仍然保留着旧的大仓库结构，里面只是包含了一个较旧版本的 `gallery/` 子目录。

这意味着：

- 如果你现在直接让 Cloudflare 连接现有 GitHub 仓库并把根目录设为 `gallery`
  Cloudflare 可以部署
- 但是它部署的是 GitHub 上那个旧版 `gallery/`
  不是你本地现在这个最新独立版本

所以更推荐的做法是：

1. 先把本地独立 `gallery` 推到 GitHub
2. 再让 Cloudflare Pages 连接这个仓库

## 第二步：本地推送独立 gallery

进入本地独立仓库目录：

```powershell
cd "D:\GoodTry\Image Gallery\gallery"
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

由于远端现在仍是旧仓库历史，后续大概率需要覆盖远端主分支。

推荐先试：

```powershell
git push -u origin main
```

如果提示非 fast-forward 或历史不相关，再用：

```powershell
git push -u origin main --force
```

注意：

- `--force` 会用当前独立 `gallery` 仓库替换远端现有主分支内容
- 远端旧结构会被覆盖
- 这正符合“以后只保留 gallery 作为主项目”的目标

## 第三步：在 Cloudflare 中连接 GitHub 仓库

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

## 第四步：配置 Pages 构建参数

如果 Cloudflare 让你手动填写构建信息，使用：

- Framework preset: `None`
- Build command: 留空
- Build output directory: `public`
- Root directory:
  - 如果远端已经被独立 `gallery` 仓库覆盖，留空即可
  - 如果远端暂时还是旧大仓库结构，填 `gallery`

## 第五步：确认 Wrangler 配置

本项目的 `wrangler.toml` 需要至少包含：

- `pages_build_output_dir = "./public"`
- D1 绑定 `GALLERY_DB`
- R2 绑定 `GALLERY_BUCKET`

如果 Cloudflare 检测到 `wrangler.toml` 并自动读取，这是正常行为。

## 第六步：在 Cloudflare Pages 中配置变量和密钥

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

## 第七步：绑定 D1 和 R2

在 Pages 项目中确认：

- D1 绑定名是 `GALLERY_DB`
- R2 绑定名是 `GALLERY_BUCKET`

名字必须和代码里的绑定保持一致，不能改成别的。

## 第八步：配置 R2 CORS

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

## 第九步：首次上线后做冒烟验证

至少验证这些：

1. 首页能打开
2. 后台 `/admin/` 能打开
3. 输入管理密钥能进入后台
4. 新建标签成功
5. 上传 1 张图片成功
6. 图片能通过 `/file/...` 打开
7. 前台按标签筛选正常

## 如果你现在就想先部署

有两个路径：

### 路径 A：先不推本地独立仓库

可行，但 Cloudflare 只能部署 GitHub 上现有旧版 `gallery/` 子目录。

这适合临时验证 Cloudflare 配置是否打通，不适合作为最终正式结构。

### 路径 B：先把本地独立仓库推上去

这是推荐路径。

优点：

- GitHub 仓库结构和本地一致
- Cloudflare 根目录可以直接留空
- 以后维护更简单
- 不会再混着旧 `CloudFlare-ImgBed` 结构
