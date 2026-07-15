# GitHub 仓库安全同步说明

## 当前状态

核对日期：2026-07-15

- 本地分支：`main`
- 远端：`https://github.com/XiaoZhi0079/cloudflare-imaged.git`
- 本地 `HEAD` 与远端 `origin/main` 的已提交基线一致：`3bf57a1`
- Hero 精选、站点配置及发布安全修复目前位于本地未提交工作区
- Cloudflare 生产站点仍运行已提交的旧版代码

这不是两套仓库历史，也不需要用本地分支替换远端历史。完成本地验证和提交后，使用普通快进推送即可。

## 推荐同步流程

### 1. 完成验证

```powershell
npm test
git diff --check
git status --short --branch
```

所有测试通过后再进入暂存步骤。

### 2. 精选暂存文件

`public/demo/` 是本地种子脚本生成的演示资源，已被 `.gitignore` 排除。

不要在未检查状态时盲目暂存全部文件。先查看：

```powershell
git status --short
```

然后按确认过的文件或目录暂存，并检查实际暂存内容：

```powershell
git diff --cached --stat
git diff --cached
```

### 3. 创建普通提交

提交信息应描述 Hero 精选、站点配置和发布安全修复。提交前再次运行测试。

### 4. 普通推送

```powershell
git push -u origin main
```

仓库中的 `sync-github.cmd` 执行的也是这条普通推送命令。

如果远端出现新的、无法快进的提交，Git 会拒绝推送。此时应先获取并检查远端变化，再决定合并或变基；不要自动覆盖远端。

## 禁止强推

本项目当前没有覆盖远端历史的需求。不要对 `origin/main` 使用 `--force` 或 `--force-with-lease`。

普通推送的非快进拒绝是重要的安全保护，可避免覆盖其他设备或协作者已经推送的代码。

## Cloudflare 部署关系

Cloudflare Pages 通过 GitHub `main` 分支直接部署。推送后需要检查：

1. GitHub CI 是否通过
2. Cloudflare 部署是否成功
3. `/api/public/site` 是否返回 JSON
4. 首页标签浏览是否仍可用
5. 管理端“站点”页能否保存期名、文案和精选顺序
6. 删除精选图片后，首页数量与轮播是否同步

本说明只描述安全同步流程，不授权自动提交、推送或生产部署。
