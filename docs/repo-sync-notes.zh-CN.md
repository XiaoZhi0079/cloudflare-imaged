# GitHub 仓库同步说明

## 当前状态

本地：

- `D:\GoodTry\Image Gallery\gallery` 是独立仓库
- 当前分支是 `main`
- 最新提交是 `64114f6 docs: add deployment runbook and ci`

远端：

- 仓库地址：`https://github.com/XiaoZhi0079/cloudflare-imaged.git`
- 远端 `main` 仍然是旧大仓库结构
- 远端仓库中虽然有 `gallery/` 子目录，但它还是旧版“通过 ImgBed 中转上传”的实现

## 这意味着什么

本地当前状态和远端当前状态不是一个简单的“落后几次提交”的关系，而是两套仓库结构：

- 本地：独立 `gallery`
- 远端：旧仓库根目录 + 较旧的 `gallery/` 子目录

因此后续同步 GitHub 时，大概率不是普通快进推送，而是“用本地独立仓库替换远端主分支内容”。

## 推荐做法

在确认你要正式废弃旧远端结构后，进入本地 `gallery` 仓库运行：

```powershell
git push -u origin main --force
```

## 为什么这里推荐 force push

因为目标已经不是“保留旧远端历史并继续叠加”，而是：

- 让 GitHub 仓库只承载独立 `gallery`
- 让 Cloudflare Pages 以后只认这一套结构
- 彻底去掉旧 `CloudFlare-ImgBed` 主项目角色

## 风险说明

执行 `--force` 后：

- 远端主分支旧文件树会被当前本地仓库替换
- 旧项目历史仍然会保留在 GitHub 提交历史中，但主分支文件内容会变成新的独立 `gallery`
- 如果你以后还想参考旧项目，本地备份目录 `CloudFlare-ImgBed` 仍然在

## 如果不想 force push

那就只能继续保留远端旧结构，并在 Cloudflare Pages 中把根目录设置成 `gallery`。

但这样会带来两个问题：

1. GitHub 仓库根目录仍旧混着旧系统
2. Cloudflare 部署拿到的还是 GitHub 上当前那个旧版 `gallery/`

所以这只能算临时过渡方案，不适合作为长期主线。
