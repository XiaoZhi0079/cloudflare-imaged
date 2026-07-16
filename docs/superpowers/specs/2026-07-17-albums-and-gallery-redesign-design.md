# 多图集与图片站统一改版设计

日期：2026-07-17

## 目标

本次版本把现有“单一精选列表 + 标签图片墙”升级为完整但克制的多图集系统，同时修复前台图片名称缺失和后台图片详情过窄的问题。最终成果包括：

- 前台图片卡片与大图弹层显示图片文件名，标签作为辅助信息；
- 后台图片详情从 440px 侧栏升级为宽屏双栏工作区，完整展示不同比例图片；
- “精选管理”升级为“图集管理”，支持创建、编辑、删除图集以及多对多图片归属；
- 一个图集可包含多张图片，一张图片可属于多个图集；
- 图集拥有名字、URL 标识、介绍、封面、图片顺序和首页主图集状态；
- 前台增加图集列表与图集详情页，首页主图集继续驱动顶部轮播；
- 首页参考根目录 `参考.html` 的布局语言进行调整，并统一前后台色彩、圆角、排版和交互变量。

## 已确认的根因

### 前台弹层显示标签

公开图片序列化函数 `toPublicImage()` 曾被刻意设计为移除 `fileName`，前台 `gallery.js` 只能把标签拼成弹层文字。这不是偶发渲染错误，而是 API 数据契约与当前产品需求不一致。

### 后台详情显得过窄

所有管理抽屉共用 `.admin-drawer { width: min(440px, 100%) }`，图片预览又被固定在 4:3 容器中。`object-fit: contain` 不会裁剪原图，但竖图和超宽图会在狭窄、固定比例的容器中被显著缩小，造成“显示不完全”的感受。

### 单一精选无法表达图集

当前 `featured_images` 只有图片 ID 和顺序，站点名称与介绍存放在全局 `site_settings`。它无法支持多个命名集合、图片多对多归属、独立介绍、封面或图集详情页。

## 方案选择

### 多图集数据方案

1. **用标签模拟图集**：无需迁移，但标签没有介绍、封面、独立顺序或首页主图集语义，无法满足需求。
2. **在图片表增加单一 album_id**：实现简单，但一张图片不能属于多个图集。
3. **独立 albums + album_images 多对多表**：结构清晰，支持独立元数据、有序成员和多图集复用。

采用方案 3。

### 首页与主图集方案

1. 轮播继续独立于图集：会保留两套重复的选图与排序模型。
2. 移除轮播，只显示图集封面：改动简单，但丢失已经验证的主视觉能力。
3. 指定唯一首页主图集，由其合规图片驱动轮播：图集成为唯一内容真源，同时保留现有轮播。

采用方案 3。

### 后台图片详情方案

1. 把侧栏从 440px 加宽到 600px：改动小，但复杂表单和竖图仍然拥挤。
2. 使用居中大弹层：能放大图片，但与管理表单的持续编辑体验较弱。
3. 桌面端宽屏双栏抽屉，移动端全屏单栏：左侧专注预览，右侧编辑元数据，兼顾浏览上下文与可用空间。

采用方案 3。

## 数据模型

新增迁移 `migrations/0002_albums.sql`：

```sql
CREATE TABLE albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  cover_image_id INTEGER,
  is_home INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cover_image_id) REFERENCES images(id) ON DELETE SET NULL
);

CREATE TABLE album_images (
  album_id INTEGER NOT NULL,
  image_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, image_id),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);
```

索引包括图集展示顺序、图集图片顺序、按图片反查图集以及唯一首页主图集的部分唯一索引。

迁移会把当前 `site_settings.issue_name`、`site_settings.hero_copy` 和 `featured_images` 转换为一个默认首页图集：

- 名字沿用 `issue_name`，空值回退为“图集”；
- 介绍沿用 `hero_copy`；
- slug 使用稳定的 `home`；
- 当前精选顺序复制到 `album_images`；
- 第一张精选作为封面；
- 旧表暂时保留但新代码不再写入，便于部署回滚和数据核对。

新增图集默认不是首页图集。设置某图集为首页时，Repository 在同一批事务中先清除旧 `is_home`，再设置新图集，保证始终最多一个首页图集。

## Repository 与 API

Repository 新增：

- `listAlbums({ includeImages })`
- `getAlbumBySlug(slug)`
- `createAlbum(changes)`
- `updateAlbum(albumId, changes)`
- `deleteAlbum(albumId)`
- `setAlbumImages(albumId, imageIds)`
- `setHomeAlbum(albumId)`

图集图片 ID 必须是去重的正整数并全部存在。封面必须为空或属于该图集；当成员移除导致封面失效时，自动改为第一张成员或空值。删除图片依靠外键清理 `album_images`，封面使用 `ON DELETE SET NULL`。

管理员 API：

- `GET /api/admin/albums`：返回全部图集、成员和可编辑元数据；
- `POST /api/admin/albums`：创建图集；
- `PATCH /api/admin/albums`：原子更新名字、介绍、封面、首页状态、顺序和成员；
- `DELETE /api/admin/albums`：删除非首页或空图集；删除当前首页图集前必须先指定另一个首页图集，避免首页主视觉无意消失。

公开 API：

- `GET /api/public/albums`：返回图集卡片所需的名字、slug、介绍摘要、封面和图片数量；
- `GET /api/public/albums?slug=<slug>`：返回单一图集及其有序图片；
- `GET /api/public/site`：从首页主图集生成现有 Hero 数据；只有符合近似 16:9 且至少 1600×900 的成员进入轮播，其余成员仍可在图集详情中展示；
- `GET /api/public/images`：恢复安全的 `fileName` 字段，用于图片标题，不暴露 storage key、分类或管理状态。

## 后台图集管理

保留 `/admin/featured.html` 地址以兼容现有书签，但页面和导航名称改为“图集管理”。页面采用主从结构：

- 左侧图集列表：名称、图片数量、首页标记、新建和删除；
- 右侧编辑区：名字、介绍、封面、首页主图集开关、图片成员和顺序；
- “从图片库添加”打开候选选择器；候选可以按 4K、2K、1K、其他筛选，但这些档位只用于帮助挑选首页轮播质量，不阻止普通比例图片加入非轮播图集；
- 已加入成员支持上移、下移、移除；同一图片可在其他图集中继续存在；
- 保存以单个图集为事务单位，加载失败时保持锁定，沿用当前防误清空保护。

普通图集允许任意比例和分辨率图片。只有首页主图集的 Hero 轮播会过滤出符合轮播资格的成员。管理界面会明确显示“图集共 N 张，轮播可用 M 张”。

## 后台图片详情工作区

桌面端抽屉宽度调整为 `min(1040px, calc(100vw - 48px))`，内部使用两栏：

- 左栏约 58%，深色中性预览舞台，图片使用 `max-width/max-height: 100%` 和 `object-fit: contain`，舞台高度限制在视口内；
- 右栏约 42%，包含文件名、实际尺寸、主分类、标签和保存按钮；
- 预览不再强制 4:3，使用可伸缩舞台完整呈现横图、竖图和超宽图；
- 900px 以下改为全宽抽屉和单栏；720px 以下保持全屏移动端体验。

不通过截图验收，而使用 DOM/CSS 契约测试确认宽度、两栏、contain、视口高度和响应式规则。

## 前台信息与交互

### 图片标题

- 瀑布流悬停层第一行显示 `fileName`，第二行显示标签；
- 大图弹层主标题显示 `fileName`，标签作为次级信息；
- 图片 `alt` 和打开按钮的 accessible name 优先使用 `fileName`；
- 文件名为空时回退“未命名图片”。

### 首页

参考 `参考.html`，采用中性、克制、内容优先的杂志式布局：

- 顶部吸附半透明导航，左侧站点名称，右侧提供“图集”和“标签浏览”锚点，不提供公开上传按钮；
- 大标题使用大字号无衬线字体，介绍文案保持短行宽；
- 首页主图集轮播保留完整图片展示，降低卡片边框和装饰阴影；
- 增加图集卡片区，展示封面、名称、简介和图片数量；
- 标签继续使用胶囊筛选；
- 图片墙保留真实比例瀑布流，卡片圆角缩小到更克制的 16–20px，悬停轻微缩放和底部渐变；
- 移动端两列，极窄屏单列；支持 reduced-motion。

### 图集详情页

新增 `/album.html?slug=<slug>`：

- 顶部返回首页、图集名字、介绍和图片数量；
- 按图集成员顺序展示瀑布流；
- 点击图片复用统一大图弹层；
- 未找到图集显示安全空状态，不泄露内部错误。

## 统一视觉系统

色调采用 `参考.html` 的中性灰白方向，同时保留一个低饱和暖色作为操作强调：

- 页面背景：`#f7f7f5`
- 主文字：`#222222`
- 次文字：`#666666`
- 表面：`#ffffff`
- 边线：`rgba(0, 0, 0, 0.08)`
- 强调色：`#9a4b2f`
- 深色按钮/激活态：`#171717`

前台变量放在 `main.css`，后台对应变量放在 `admin.css`，名称和实际色值保持一致。所有管理页同步更新背景、面板、边线、文字、按钮与焦点颜色；不局部混用旧暖黄背景。

## 错误处理与兼容

- 没有首页图集时，首页隐藏轮播但继续展示图集列表和标签图片墙；
- 首页图集没有轮播合规图片时，显示名字和介绍，不出现破图；
- 图集详情没有图片时显示空状态；
- 公开接口继续隐藏 storage key、同步状态、备注和分类；
- 前台恢复 `fileName` 是有意的公开展示字段；
- 旧 `/admin/featured.html` URL 不变；
- D1 迁移幂等且保留旧精选数据；
- 所有写入接口要求管理密钥并返回 JSON 错误；
- 保存失败不会部分修改图集元数据或成员顺序。

## 测试与验收

测试覆盖：

- 0002 迁移创建完整对象并把旧精选转换为首页图集；
- 一张图片可同时属于多个图集；
- 图集成员顺序、封面、删除和首页唯一性；
- 管理 API 鉴权、输入校验、原子更新和错误响应；
- 公开 API 不暴露管理字段但包含 `fileName`；
- 首页 Hero 只使用首页图集中的合规图片；
- 首页、图集详情和图片弹层的静态契约；
- 后台宽屏详情工作区和移动端响应式契约；
- 图集管理加载失败保护、创建、编辑、成员选择、排序和删除；
- 前后台统一颜色变量和缓存版本。

验收只使用合成数据库记录、静态 HTML/CSS/JavaScript、HTTP 文本与自动化测试。禁止请求、下载、解码、截图或分析任何图库图片。生产验收检查 GitHub CI、D1 迁移状态、Cloudflare 部署 SHA 以及线上 HTML/JavaScript/CSS 文本版本。
