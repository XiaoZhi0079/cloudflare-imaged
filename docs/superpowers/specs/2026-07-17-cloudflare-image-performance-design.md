# Cloudflare 图片性能优化设计

## 目标

保留 R2 中的原始 AI 图片作为唯一源文件，在 Cloudflare 边缘按页面实际显示尺寸生成受控变体，并让浏览器通过 `srcset`/`sizes` 选择合适资源。功能不可依赖截图或真实图片内容验收，且任何变换失败都必须安全回退到现有 `/file/*` 原图。

## 方案审查

### 方案 A：直接使用 `/cdn-cgi/image`

实现最少，但前台模板会直接依赖账户已启用 Image Transformations；套餐、区域或配置异常时，所有使用该 URL 的图片都可能失败，回退控制也较弱。

### 方案 B：Pages Function 受控代理（采用）

新增 `/img/*` Pages Function，仅接受白名单宽度。Function 使用 `fetch(source, { cf: { image } })` 请求独立的 `/file/*` 原图路径，根据 `Accept` 协商 AVIF/WebP；变换失败或运行时异常时返回 307 到原图。它符合 Cloudflare 官方关于“变换路径与原图路径分离”和“失败可重定向原图”的建议，同时保留应用层参数控制。

### 方案 C：上传时预生成所有尺寸并存入 R2

运行期最稳定，但会放大存储、上传时间和后台复杂度，还需要处理重命名、移动、删除与所有派生文件的一致性。当前规模下收益不足。

## URL 与安全边界

- 原图继续使用 `/file/<R2 key>`。
- 变体使用 `/img/<R2 key>?w=<width>`。
- 宽度只允许：`320, 480, 640, 768, 960, 1280, 1600, 1920, 2560`。
- 不开放来源 URL、任意质量、任意格式、裁剪位置或高度参数，避免 SSRF 和无限变体消耗。
- 路径为空、包含 `.`/`..`、宽度缺失或不在白名单时返回 400，不触发上游请求。
- `/img/*` 只构造当前请求同源的 `/file/*`，不接受外部主机。

## 变换行为

- `fit: "scale-down"`，只缩小不放大，不裁剪图片。
- 固定质量 `82`。
- `Accept` 支持 AVIF 时输出 AVIF，否则支持 WebP 时输出 WebP；其余保持源格式。
- 成功响应增加 `Vary: Accept` 与浏览器缓存头。
- 上游非成功状态或异常返回 307 到同源原图，确保页面仍可显示。
- Cloudflare 官方说明变换结果会自动作为源 URL 的额外变体缓存，因此不自定义 `cacheKey`。

## 响应式页面策略

- 图库瀑布流：`320–960px` 候选，匹配 1–4 列布局和高像素密度屏幕。
- 图集封面：`480–1280px` 候选。
- Hero 与全屏查看器：`640–2560px` 候选；页面 CSS 最大显示宽度为 1280 CSS px，因此 2560 足以覆盖 2x 屏幕。
- 所有 `<img>` 的 `src` 保留原图，`srcset` 指向变体；旧浏览器仍可使用原图，支持 `srcset` 的浏览器使用边缘变体。
- 当元数据存在时输出 `width`/`height`，减少图片加载前后的布局抖动。
- Hero、查看器和相邻图片预加载统一使用共享变体规则。

## 缓存策略

- `/file/*` 增加 `Cache-Control: public, max-age=3600, must-revalidate`；R2 提供 ETag 时透传，并支持匹配 `If-None-Match` 返回 304。
- `/img/*` 成功响应增加 `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`；既减少重复传输，又避免同名对象更新后长期不可见。
- 变换失败的 307 不设置长期不可变缓存。

## 文件边界

- `src/shared/image-variants.js`：无 DOM 的宽度白名单、预设、变体 URL 和响应式属性生成。
- `public/assets/image-variants.js`：与共享文件完全一致的浏览器副本。
- `functions/img/[[path]].js`：Cloudflare 变换代理与回退。
- `src/shared/templates.js` / `public/assets/templates.js`：封面与瀑布流响应式标记。
- `gallery.js` / `image-viewer.js`：Hero、查看器与预加载应用响应式属性。
- `functions/file/[[path]].js`：原图缓存和 ETag。

## 隐私与验收

- 单元测试只使用合成 URL、字节和 Response。
- 线上验收只读取 HTML/JS 文本、响应头，以及对无效或不存在的 `/img/*` 路径检查 400/307；不请求任何真实 `/file/*`，不跟随回退，不生成截图。
- 若 Cloudflare 账户尚未启用 Image Transformations，代码仍通过 307 回退保持可用；实际变换命中率可后续从 Cloudflare Analytics 查看，无需读取图片内容。

## 验收标准

1. 页面为瀑布流、封面、Hero 和查看器输出合适的 `srcset`/`sizes`。
2. `/img/*` 只接受白名单宽度与同源 R2 路径，按 AVIF/WebP 协商格式。
3. 变换失败自动 307 回退原图，原有图片展示不因 Cloudflare 套餐或配置失败。
4. 原图具备缓存与 ETag 重验证，变体具备合理缓存和 `Vary: Accept`。
5. 全量测试、GitHub CI 和线上文本/响应头验收通过，未访问任何真实图片内容。
