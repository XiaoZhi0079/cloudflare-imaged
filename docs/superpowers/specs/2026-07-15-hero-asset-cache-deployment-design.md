# Hero 静态资源缓存与部署设计

日期：2026-07-15
状态：已实施并验证

## 问题

透明 Hero 文案修复修改了 `public/assets/main.css` 与 `public/assets/gallery.js`，但首页仍通过不带版本的固定 URL 引用这两个文件。生产响应当前为 `Cache-Control: public, max-age=14400, must-revalidate`，因此已经访问过站点的浏览器可能在最长 4 小时内继续使用旧资源，短暂保留白色文案框。

两份部署说明还记录着旧的固定提交 SHA 和“Hero 改动未提交”状态，继续保留会让后续发布判断依赖过时快照。

## 方案比较

1. **给本次变更的入口资源增加统一查询版本（采用）**
   - 将首页中的 `main.css` 与 `gallery.js` 引用改为相同的非空发布版本。
   - 范围最小，不改变其他静态资源的缓存策略，也能绕过浏览器现有缓存。
2. **通过 `_headers` 将所有静态资源改为每次重新验证**
   - 后续不必手动更新版本，但会永久增加静态请求验证流量，超出本次视觉修复范围。
3. **部署后仅清理 Cloudflare CDN 缓存**
   - 能处理边缘缓存，但无法清除用户浏览器仍处于有效期内的响应，不能保证立即生效。

## 设计

- `public/index.html` 中的 `/assets/main.css` 和 `/assets/gallery.js` 使用同一个发布版本参数。
- 版本只用于缓存键，不改变模块结构、运行时代码或 Cloudflare 绑定。
- 增加静态回归测试，要求两个入口资源都带版本且版本值一致。
- 部署文档移除固定 SHA 和容易失效的“未提交”快照，改为要求以 `git status`、`origin/main` 和 Cloudflare 当前部署为准。
- 本次发布不修改 D1、R2、生产变量、密钥、CORS、自定义域名或用户图片。

## 验证与发布

1. 先运行新增测试并确认因资源 URL 没有版本而失败。
2. 添加统一版本参数后确认聚焦测试通过，再运行完整测试、JavaScript 语法和 Git 差异检查。
3. 普通推送 `main`，不得强推；GitHub Actions 只负责 Node 22 测试，Cloudflare Pages 通过 Git 集成部署。
4. 等待 GitHub CI 和 Cloudflare Pages 检查完成。
5. 生产验收只使用 HTTP、DOM 与 `getComputedStyle`：确认新资源 URL、生效的透明背景、层级、桌面与 390px 无横向溢出。
6. 未经用户单独许可，不截图、不读取或分析图片内容。

## 回滚

如部署失败或生产行为异常，使用 `git revert` 创建普通回滚提交并推送；不删除或修改生产 D1/R2 数据。
