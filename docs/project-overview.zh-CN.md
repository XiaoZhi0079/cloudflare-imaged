# Gallery 项目说明

## 项目定位

这是一个部署在 Cloudflare 上的图片画廊系统，包含公开浏览页和轻量后台管理页。项目已经从旧的图床系统中拆分出来，当前仓库只负责 Gallery 自己的页面、接口、数据和文件存储。

## 技术组成

- 前端页面：原生 HTML、CSS、JavaScript，位于 `public/`
- 后端接口：Cloudflare Pages Functions，位于 `functions/`
- 数据库：Cloudflare D1，绑定名 `GALLERY_DB`
- 图片存储：Cloudflare R2，绑定名 `GALLERY_BUCKET`
- 部署方式：Cloudflare Pages 直接关联 GitHub 仓库

## 目录结构

- `public/`：静态页面和前端脚本
- `public/admin/`：后台页面，包括首页、上传、标签、图片管理
- `functions/api/public/`：公开 API，例如标签和图片列表
- `functions/api/admin/`：后台 API，例如标签、分类、图片、上传
- `functions/file/`：图片访问路由，从 R2 读取文件
- `src/server/`：D1、R2、上传、直传签名等服务逻辑
- `src/shared/`：前后端共享的模板和工具函数
- `tests/`：Node 原生测试
- `docs/`：部署说明、同步说明和项目文档

## 核心功能

- 公开画廊按标签浏览图片
- 后台通过管理密钥进入系统
- 新增、编辑、隐藏、删除标签
- 新增和编辑上传主分类
- 上传图片时选择主分类和标签
- 图片直传 R2，减少 Worker 中转压力
- 上传完成后把图片元数据、分类和标签关系写入 D1
- 后台支持搜索、标签筛选、批量打标签、批量删除
- 图片文件通过 `/file/...` 由当前项目统一对外提供

## 数据模型

D1 中主要有四张表：

- `tags`：标签，包含名称、slug、排序和可见状态
- `categories`：上传主分类，包含中文名称和英文目录名
- `images`：图片记录，包含 R2 key、文件名、公开 URL、尺寸和分类
- `image_tags`：图片与标签的多对多关系

默认主分类：

- `sexy-beauty`：性感美人
- `elegant-beauty`：气质美人
- `scenery`：风景

## 上传流程

1. 后台选择图片、主分类和标签。
2. 前端请求 `/api/admin/images/upload/init`。
3. 后端校验管理密钥、标签、分类，并生成 R2 预签名 `PUT` 地址。
4. 浏览器直接把图片上传到 R2。
5. 前端请求 `/api/admin/images/upload/complete`。
6. 后端确认 R2 文件存在，然后把图片记录和标签关系写入 D1。

## 关键接口

- `GET /api/public/tags`：公开标签列表
- `GET /api/public/images?tag=xxx`：按标签读取公开图片
- `GET /file/...`：读取 R2 图片文件
- `GET/POST/PATCH/DELETE /api/admin/tags`：标签管理
- `GET/POST/PATCH /api/admin/categories`：主分类管理
- `GET/PATCH/DELETE /api/admin/images`：图片管理
- `POST /api/admin/images/upload/init`：申请 R2 直传地址
- `POST /api/admin/images/upload/complete`：确认上传并写入 D1
- `POST /api/admin/images/tag-assignments/bulk`：批量修改图片标签
- `POST /api/admin/images/bulk-delete`：批量删除图片

后台接口都需要请求头：

```text
x-gallery-admin-key: <GALLERY_ADMIN_KEY>
```

## 配置项

Cloudflare Pages 需要配置这些变量和密钥：

- `GALLERY_ADMIN_KEY`：后台管理密钥
- `GALLERY_PUBLIC_BASE_URL`：图片公开访问前缀，通常是 `https://你的域名/file`
- `GALLERY_UPLOAD_NAME_TYPE`：文件命名方式，默认 `origin`
- `GALLERY_UPLOAD_FOLDER`：兜底上传目录
- `R2_ACCOUNT_ID`：Cloudflare Account ID
- `R2_BUCKET_NAME`：R2 桶名
- `R2_ACCESS_KEY_ID`：R2 S3 访问密钥 ID
- `R2_SECRET_ACCESS_KEY`：R2 S3 访问密钥

`wrangler.toml` 管理 D1 和 R2 绑定。迁移到新账号时，需要更新 D1 UUID 和 R2 bucket 名称。

## 部署要点

推荐部署方式是 Cloudflare Pages 直接连接 GitHub：

- Framework preset：`None`
- Build command：留空
- Build output directory：`public`
- Production branch：`main`

R2 必须配置 CORS，允许正式域名和 Pages 预览域名执行 `PUT` 上传。

## 本地开发

安装依赖后可运行：

```powershell
npm test
npm run dev
```

本地访问：

- 公开画廊：`http://127.0.0.1:8788/`
- 后台管理：`http://127.0.0.1:8788/admin/`

## 维护原则

- Gallery 项目独立维护，不再依赖旧 `CloudFlare-ImgBed`
- 图片文件走 R2，元数据走 D1
- 上传尽量保持浏览器直传 R2，避免 Worker 中转大文件
- 修改 UI 后同步补充 `tests/templates.test.js`
- 修改接口、存储或数据库逻辑后运行完整测试：`npm test`
