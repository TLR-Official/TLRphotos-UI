# 航空摄影工作室 - 项目上下文文档

## 1. 项目概述

**项目名称**：航空摄影工作室网站

**团队定位**：极微型工作室，由非技术人员主导

**核心目标**：搭建一个极致轻量、低成本、零运维的航空摄影作品展示与管理平台

**核心理念**：

- 服务器仅承担数据存储与后端运行，所有前端开发在本地完成
- 避免引入复杂基础设施（Docker/Redis 等）
- 降低运维成本和技术门槛

***

## 2. 技术架构

### 2.1 前端

- **框架**：React + TypeScript
- **样式**：TailwindCSS
- **构建工具**：Vite
- **开发环境**：本地开发，本地调试，构建产物上传至服务器静态目录
- **数据请求层**：纯代码实现，与后端 `api.md` 契约严格对齐，无 NocoBase/PocketBase 耦合

### 2.2 后端

- **框架**：Node.js + Express
- **数据库**：SQLite（通过 sqlite3 + sqlite 包）
- **代码位置**：`backend/` 目录，所有表结构、路由、权限均写在代码中
- **开发环境**：本地运行 `npm run dev`，端口 3001
- **访问方式**：通过 RESTful API 提供服务，前端通过 Vite Proxy 联调

### 2.3 存储

- **混合存储模式**：
  - 缩略图：以 URL 形式存储（开发环境使用 picsum.photos）
  - 原图：存储在 Cloudflare R2 对象存储（生产环境）
  - 数据库文件：`backend/data/database.db`

***

## 3. 存储策略详细说明

### 3.1 缩略图存储（本地）

- **格式**：WebP（高压缩比，画质可接受）
- **存储位置**：`/mnt/data/pb_data/thumbnails/`
- **存储形式**：Blob 文件（禁止 Base64 编码存储）
- **命名规则**：使用唯一标识符命名，如 `{photo_id}_thumb.webp`

### 3.2 原图存储（Cloudflare R2）

- **存储位置**：Cloudflare R2 存储桶
- **访问方式**：通过 CDN 域名访问
- **命名规则**：与缩略图保持一致的命名逻辑，如 `{photo_id}_original.jpg`

### 3.3 数据库记录

- 在 PocketBase 的 `photos` 表中记录：
  - 缩略图文件路径（本地相对路径）
  - 原图 URL（R2 完整 URL）
  - 其他元数据（拍摄时间、地点、标签等）

***

## 4. API 契约规范

### 4.1 列表查询规范

- **必须按需查询指定字段**，禁止返回完整记录
- **示例**：列表页只返回缩略图路径、标题、标签，不返回原图 URL
- **分页**：必须支持分页查询，默认每页 20 条

### 4.2 数据结构示例（草稿）

```JSON
{
  "id": "photo_001",
  "title": "城市夜景航拍",
  "thumbnail_path": "/mnt/data/pb_data/thumbnails/photo_001_thumb.webp",
  "original_url": "https://cdn.example.com/photos/photo_001_original.jpg",
  "created_at": "2024-01-15T10:30:00Z",
  "tags": ["城市", "夜景", "航拍"]
}
```

### 4.3 接口命名规范

- 使用 RESTful 风格
- 路径示例：
  - `GET /api/photos` - 获取照片列表
  - `GET /api/photos/:id` - 获取单张照片详情
  - `POST /api/photos` - 上传新照片（仅管理员）

***

## 5. 团队协作原则

### 5.1 需求确认流程

采用 **"大白话需求 → AI 确认卡 → 人工审核 → 写入代码/文档"** 的协作流程：

1. **大白话需求**：用户用通俗语言描述功能需求
2. **AI 确认卡**：AI 生成结构化的确认卡片，包含技术实现要点
3. **人工审核**：用户审核确认卡片内容
4. **写入代码/文档**：确认无误后，AI 执行代码或文档写入

### 5.2 代码提交规范

- 每次功能开发前，必须先更新此上下文文档
- 重大架构变更需人工确认后方可执行
- 代码注释使用中文

***

## 6. 已知约束

### 6.1 技术约束

- ❌ **禁止引入 Docker**
- ❌ **禁止引入 Redis 或其他缓存服务**
- ❌ **禁止将缩略图存为 Base64 字符串**
- ✅ **必须按需查询指定字段**（列表页 API）
- ✅ 文件存储必须通过 `IStorageAdapter` 接口访问，禁止业务代码直接依赖任何特定对象存储 SDK；SQLite 仅存元数据，严禁存储二进制文件。

### 6.2 开发约束

- 服务器仅用于运行 PocketBase 和存储数据
- 前端构建产物部署到服务器静态目录

### 6.3 存储约束

- 缩略图存储路径固定为 `/mnt/data/pb_data/thumbnails/`
- 原图必须存储到 Cloudflare R2
- 数据库与缩略图存储在同一数据盘

***

## 7. 项目目录结构（规划）

```
TLRphotos/
├── .ai/
│   └── context.md              # 本文档
├── src/
│   ├── features/               # 业务功能模块
│   ├── shared/                 # 共享组件与工具
│   ├── App.tsx                 # 应用入口
│   └── main.tsx                # React 挂载点
├── public/                      # 静态资源
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

***

## 8. 项目进度

### 里程碑记录

| 日期         | 里程碑                                                  | 状态   |
| ---------- | ---------------------------------------------------- | ---- |
| 2026-06-28 | 项目冷启动，初始化 React + TypeScript + TailwindCSS 项目        | ✅ 完成 |
| 2026-06-28 | 首页轮播组件 + 照片网格列表 Mock 版本                              | ✅ 完成 |
| 2026-06-28 | 配置 Favicon 和网站图标                                     | ✅ 完成 |
| 2026-06-28 | GitHub 仓库初始化并完成首次推送                                  | ✅ 完成 |
| 2026-06-28 | GitHub Actions 自动化：dev 分支每周一自动合并到 main               | ✅ 完成 |
| 2026-06-30 | 主题切换功能：深色/浅色模式 + 平滑动画过渡                              | ✅ 完成 |
| 2026-06-30 | 动态背景线条效果：48 条流动线条 + 鼠标干扰效果                           | ✅ 完成 |
| 2026-06-30 | 照片详情页：点击跳转 + 完整 EXIF 信息展示                            | ✅ 完成 |
| 2026-06-30 | 轮播图优化：固定白色标题文字，适应深浅主题                                | ✅ 完成 |
| 2026-06-30 | TypeScript 类型修复：ThemeContext 和 MouseFollowBackground | ✅ 完成 |
| 2026-07-01 | 首页布局重构：轮播图左中位置 + 右侧专栏 + 底部疏松图片                       | ✅ 完成 |
| 2026-07-01 | 专栏功能：列表组件 + 详情页 + Markdown/LaTeX 渲染                  | ✅ 完成 |

### Git 仓库信息

- **仓库地址**：<https://github.com/TLR-Official/TLRphotos-UI>
- **默认分支**：main
- **远程仓库**：origin (<git@github.com>:TLR-Official/TLRphotos-UI.git)

***

## Changelog

| 2026-10-30 20:22 | [release] 版本号升级至 V4.6.2-beta — 注册号识别结果自动写入机型/航司标签 | 全项目 |
| 2026-10-30 20:22 | [feat] 注册号识别结果自动写入「机型」「航司」标签 (V4.6.2-beta) — 后端：新增 `mergeAircraftInfoIntoTags()`，航空分区上传时把识别出的机型/航司合并进 `structured_tags` 的「机型」「航司」键（仅当用户未手动填写，不覆盖人工输入）；`/upload/complete` 补齐此前缺失的 `structured_tags` 落库逻辑（解析 + 敏感词过滤 + INSERT 列同步）；`tags.db` 新增「航司」属性 `av_flight_airline`（`key='航司'`, text），`cleanupDeprecatedAttributes()` 启动期幂等补齐存量库；前端：`AircraftInfoCard` 新增 `onHit` 回调，桌面 `UploadPage` 与移动 `MobileUploadPage` 识别命中后自动回填「飞行器」标签的机型/航司输入框（同样仅当字段为空时写入，尊重用户输入）；后端 tsc 0 error、28 套件 474 用例全绿，前端 oxlint 0 warning 0 error、build 通过；`backend/docs/api.md` 补充 structured_tags 自动合并说明 | backend/src/routes/photos.ts、backend/src/db/tagsDb.ts、src/shared/AircraftInfoCard.tsx、src/features/upload/UploadPage.tsx、src/features/upload/mobile/MobileUploadPage.tsx、backend/docs/api.md、package.json、package-lock.json |
| 2026-10-30 19:41 | [release] 版本号升级至 V4.6.1-beta — 移除重复的注册号采集入口 | 全项目 |
| 2026-10-30 19:41 | [refactor] 删除「飞行器」标签属性中的「注册号」并清理存量重复数据 (V4.6.1-beta) — 上传页注册号已由独立字段采集（V4.6.0 起自动识别机型/航司并落库 `photos.registration_number`），标签属性再存一份属重复数据：`backend/src/db/tagsDb.ts` 从 `aviationAttributes` 种子移除 `av_flight_reg`（`key='注册号'`），并新增启动期幂等清理 `cleanupDeprecatedAttributes()` 删除存量 `tag_attributes.av_flight_reg` 行（`seedTags` 仅在分类表为空时执行，故必须独立清理，否则老库仍会渲染该字段）；`backend/src/db.ts` 在 `structured_tags` 建列迁移之后新增一次性清理：按 `structured_tags LIKE '%"注册号"%'` 命中行逐条 `JSON.parse` 后 `delete parsed['注册号']` 并回写，非 JSON 脏数据保持原样不阻断启动（清理必须位于建列迁移之后，否则测试库报 `no such column: structured_tags`）；前端 `TagSelector` 由接口驱动渲染，无需改动即自动消失；`backend/docs/api.md` 补充「飞行器不再包含注册号属性」说明与上传字段备注；后端 tsc 0 error、28 套件 474 用例全绿，前端 oxlint 0 warning 0 error | backend/src/db/tagsDb.ts、backend/src/db.ts、backend/docs/api.md、package.json、package-lock.json |
| 2026-10-30 19:04 | [release] 版本号升级至 V4.6.0-beta — 飞机注册号自动识别机型与所属航司 | 全项目 |
| 2026-10-30 19:04 | [feat] 飞机注册号自动识别机型/航司并落库可检索 (V4.6.0-beta) — 上传航空分区输入注册号后，服务端按注册号查询第三方航空器库并写入机型与航司：新增 `backend/src/services/aircraftLookupService.ts`（`AircraftProvider` 抽象 + provider 链，当前唯一免费源 `adsbdb`（`GET /v0/aircraft/{reg}`，无 Key，返回 manufacturer / icao_type / registered_owner / registered_owner_country_name），5s 超时；`ICAO_TYPE_NAMES` 字典把 B77W/B738/A20N/A359 等 ICAO 代码翻译为 `Boeing 777-300ER` 等友好型号；`normalizeAircraftRegistration` 统一去空格大写 + 2~20 位校验；`buildAircraftTypeLabel` 拼接「制造商 + 型号」；本地缓存表 `aircraft_cache`（以 registration 为主键，TTL 90 天，仅缓存成功结果，失败可重试）；任一步异常 `console.warn` 后降级返回 null，**绝不阻断上传**）；`db.ts` 新增 V4.6.0 幂等迁移 `photos.aircraft_type` / `photos.airline` 两列与 `aircraft_cache` 表；新增 `GET /api/aircraft/lookup?reg=`（`routes/aircraft.ts`，requireAuth + 60 次/分 IP 限速，命中返回 registration/aircraft_type/icao_type/manufacturer/airline/country/source，格式非法 400 `INVALID_REGISTRATION`、未收录 404 `AIRCRAFT_NOT_FOUND`），`server.ts` 挂载 `/api/aircraft`；`/upload` 与 `/upload/complete` 两条落库路径在注册号校验后**与图片处理/OSS 确认并行**发起查询，INSERT 列清单同步追加 `aircraft_type` / `airline`，客户端无需提交（只读派生字段）；`/search` 的 SELECT 增加两列且 `keyword` 条件扩展为 title/description/registration_number/aircraft_type/airline，可用「777」「国航」直接命中；`GET /photos/:id`（SELECT *）自动返回新列；前端新增 `src/api/aircraft.ts` 与 `src/shared/AircraftInfoCard.tsx`（500ms 防抖 + 请求序号丢弃过期响应，命中展示「机型 / 航司 / 注册地 + 数据来源仅供参考」，未收录提示可手动填写），桌面 `UploadPage` 与移动 `/m/upload` 第 2 步注册号输入框下接入（仅登录态查询）；`PhotoDetailPage` 照片信息卡按非空展示「机型」「所属航司」；`gallery/types` 的 `PhotoListItem` 增 `aircraft_type` / `airline` 可选字段；新增 `backend/scripts/backfill-aircraft-info.ts`（`--dry-run` / `--limit N` / `--concurrency N`，默认 4；仅处理注册号非空且机型为空的记录，不覆盖已识别结果，幂等可重复执行）；新增 `backend/tests/unit/aircraftLookup.test.ts` 9 用例；数据源结论：OpenSky 公开元数据接口（`metadata/aircraft/icao|registration`）实测返回 **410 Gone**（已退役）且按 icao24 而非注册号检索，故不作实时查询源，确定为 adsbdb 主源并保留 provider 链便于日后接入付费源；后端 tsc 0 error、scripts tsconfig 0 error、28 套件 474 用例全绿，前端 oxlint 0 warning 0 error、build index-zyfD_39B.js（首包 gzip 326.69KB、MobileUploadPage 分包 7.96KB）；`backend/docs/api.md` 新增「航空器信息查询」章节并同步上传只读字段、列表/详情字段与关键词匹配说明 | backend/src/services/aircraftLookupService.ts（新增）、backend/src/routes/aircraft.ts（新增）、backend/src/routes/photos.ts、backend/src/db.ts、backend/src/server.ts、backend/scripts/backfill-aircraft-info.ts（新增）、backend/tests/unit/aircraftLookup.test.ts（新增）、backend/docs/api.md、src/api/aircraft.ts（新增）、src/shared/AircraftInfoCard.tsx（新增）、src/features/upload/UploadPage.tsx、src/features/upload/mobile/MobileUploadPage.tsx、src/features/gallery/PhotoDetailPage.tsx、src/features/gallery/types.ts、package.json、package-lock.json |
| 2026-10-30 17:14 | [release] 版本号升级至 V4.5.2-beta — 修复编辑器内 backend 脚本无法解析 sharp 类型 | 全项目 |
| 2026-10-30 17:14 | [config] 修复 backend/scripts 在编辑器中报「找不到模块 sharp」 (V4.5.2-beta) — 根因有二：(1) 临时校验脚本 `/tmp/verify-band.ts`（一次性验证横幅像素用）遗留在仓库外，其所在目录无 node_modules，IDE 打开即报模块缺失，已删除；(2) `backend/scripts/` 未被 `backend/tsconfig.json` 的 `include`（仅 `src/**/*`）覆盖，脚本文件成为孤儿文件，编辑器回落到非工程默认 moduleResolution，无法解析 `backend/node_modules/sharp`（sharp 0.35.5 的 `types` 指向 `./dist/index.d.mts`，需 node10 及以上解析策略）；现新增 `backend/scripts/tsconfig.json`（extends 上级配置、`noEmit: true`、`rootDir: ".."`、`include: ["./**/*"]`），编辑器按就近 tsconfig 正确解析 sharp 与 `../src` 服务模块；`npm run build` 仍只编译 `src`（rootDir 与 dist 布局不变），运行方式仍是 `npx ts-node --transpile-only scripts/rerender-watermarks.ts`；`npx tsc -p scripts/tsconfig.json --noEmit` 0 error | backend/scripts/tsconfig.json（新增） |
| 2026-10-24 14:58 | [refactor] 水印合成抽为独立函数并新增存量重渲染脚本 (V4.5.1-beta) — (1) `imageService` 把 watermark+band 合成逻辑从 `processImage` 抽出为导出函数 `renderWatermarkedImage(previewBuffer, config)`（含 sharpen 实例/临时 Buffer 的 finally 释放），`processImage` 改为调用该函数，上传流程与批量补渲染共用同一实现，规避两套逻辑漂移；(2) 新增 `backend/scripts/rerender-watermarks.ts`（`--dry-run` / `--limit N` / `--concurrency N`，默认 4）：按 `id` 遍历 photos，联表取上传者 `username`，用 `toOssKey` 把存量签名 URL 还原为纯 Key（外部资源计入跳过），读预览图 → `renderWatermarkedImage` → 上传新对象（文件名追加 `_band`，不覆盖旧图，`_band` 兼作幂等标记）→ 回写 `photos.watermarked_url`（**存纯 Key**，经代理层按需签名，避免历史签名过期死链，同时让照片删除可按 Key 清理 OSS 对象）；脚本首行必须是 `import 'dotenv/config'`，否则 ossService 顶层读取的环境变量为空（S3 报 `No value provided for input HTTP label: Bucket`）；(3) 执行结果：备份 `data/database.db.bak-rerender-202610241456` 后先 `--dry-run` 全量演练（188/188 尺寸断言通过），再正式写入 188/188 成功、0 跳过 0 失败，二次执行全部命中幂等跳过；抽查 1 张线上图：预览 1200×800 → 水印图 1200×888（= 高 + 条高 88），条区左右采样 [0,0,0,255] 不透明纯黑、条内 1226 个白色文字像素、`watermarked_url` 代理访问 200 `image/webp` 148KB；后端 tsc 0 error、27 套件 465 用例全绿，服务重启后 `/api/photos` 200 | backend/src/services/imageService.ts、backend/scripts/rerender-watermarks.ts（新增）、backend/data/database.db（188 条更新）、package.json |
| 2026-10-24 14:47 | [release] 版本号升级至 V4.5.0-beta — 水印图新增底部黑色信息条（在画面下方扩展、随图下载） | 全项目 |
| 2026-10-24 14:47 | [feat] 水印合成流程新增底部黑色信息条 (V4.5.0-beta) — 按「在图片底部再往下扩出一块区域、且横幅必须属于图片本体随下载一并带走」的口径实现，非覆盖式压条：后端 `imageService.processImage` 在文字水印落到画面后，用 `sharp.extend({ bottom: bandHeight, background: { r:0,g:0,b:0,alpha:1 } })` 向下扩展等宽纯黑条（不裁切、不遮挡画面），再以 `top: processedHeight` 把条内文字图层 composite 进扩展区，一次 `webp({quality:90})` 输出，水印图高度 = 预览图高 + 条高，故 `watermarked_url` 下载即带横幅；两行文案居中——第一行站名 `TLRphotos`，第二行 `© 2026 {上传者用户名}`（`authUser.username`，缺失回落「TLRphotos 用户」），SVG 文本统一 `fill=#ffffff`、`text-anchor=middle`、`dominant-baseline=middle`、字体族 `Liberation Sans, Noto Sans CJK SC, sans-serif`（服务器已确认中文字体在位），用户名经 XML 转义防注入；比例常量全部以预览图（≤1200px）为基准自适应：条高 = 短边 × 11%（clamp 48px ~ 图高 40%）、文字可用宽 = 图宽 × 92%、两行字号 = 条高 × 30% / 26%（下限 10px，仍超宽则按估算 em 逐字截断补 `…`）、行垂直中心位于条内 36% / 74%，故不同分辨率字号与条高线性缩放、文字不越界；前端桌面 `UploadPage` 与移动 `WatermarkEditor` 预览图下方同步渲染等宽黑条并用同源 `shared/watermarkBand.ts`（100% 复刻后端比例与宽度估算）换算，`useUser()` 补取 `user.username` 作第二行，实现所见即所得；零接口字段变更（仅传 `watermarkText` 即触发，无需新增分步操作），`backend/docs/api.md` 上传接口补充信息条行为说明；新增 `backend/tests/unit/watermarkBand.test.ts` 14 用例（横/竖/小图 clamp、em 估算、缩字号与截断兜底）；实测 1600×900 样例：输出 1200×749 与「预览高 + 条高」一致、底部条区 RGB(0,0,0) alpha 255、条内 860 个白色文字像素、画面末行仍为原图色（未被裁切）、不传 band 时高度保持 675（旧流程兼容）；后端 tsc 0 error、27 套件 465 用例全绿，前端 oxlint 0 warning 0 error、build index-CeOqemEk.js（首包 gzip 325.95KB、MobileUploadPage 分包 7.93KB） | backend/src/services/imageService.ts、backend/src/routes/photos.ts、backend/tests/unit/watermarkBand.test.ts（新增）、backend/docs/api.md、src/shared/watermarkBand.ts（新增）、src/features/upload/UploadPage.tsx、src/features/upload/mobile/（MobileUploadPage.tsx、WatermarkEditor.tsx） |
| 2026-10-24 14:32 | [fix] 首页精选作品改为 4:3 完整展示不裁切 (V4.4.6-beta) — 「精选作品」网格容器原为 `aspect-[4/3]` 但图片用 `object-cover`，宽高比不符的作品会被裁掉构图；现改为 `object-contain` 完整展示原比例作品，容器补 `bg-gray-50` 作留白底色区分画面边界，悬停缩放由 `group-hover:scale-110` 收敛为 `scale-105` 避免放大时溢出裁切；缩略图后端为 `sharp.resize(800,800,{fit:'inside'})` 保持原比例不裁切，故 contain 可还原完整画面；卡片外层 hover:scale-105 与阴影、标题/标签结构不变；零接口变更；oxlint 0 warning 0 error、build index-BImxN0fA.js（首包 gzip 325.42KB） | src/App.tsx |
| 2026-10-24 14:28 | [feat] 上传页新增必选的「同意作品版权协议」勾选框 (V4.4.5-beta) — 桌面 UploadPage「填写信息」步与移动 /m/upload 第 4 步确认页，在原有安全声明之下各新增一张蓝底（bg-blue-50 + border-blue-200）协议同意卡片：「我已阅读并同意《作品许可协议》，理解作品经审核通过后将以 CC BY 4.0 协议公开展出，著作权仍归我所有」，其中《作品许可协议》为内部路由链接（Link to="/about" + target="_blank" + rel="noopener noreferrer"，新标签打开不打断上传流程）；桌面端新增 licenseAgreement 状态并纳入 canSubmit，未勾选时底部提示「请阅读并同意作品版权协议」；移动端同名字段接入 localStorage 草稿（DraftPayload 读写 + 依赖数组）保证刷新后状态留存，handleSubmit 前置校验未勾选即 setError 拦截；蓝底为非警示色（沿用三色体系），必选标记与勾选框热区 ≥44px 移动端达标；安全声明与协议同属前端提交门，后端接口与数据表零变更；顺带补齐 runUpload useCallback 依赖 isRegistrationRequired（消除 V4.4.3 引入的 exhaustive-deps warning）；oxlint 0 warning 0 error、build index-noFRHhDj.js（首包 gzip 325.42KB） | src/features/upload/UploadPage.tsx、src/features/upload/mobile/MobileUploadPage.tsx |
| 2026-10-24 14:22 | [feat] 关于我们页新增作品许可协议说明区块 (V4.4.4-beta) — 将页脚新增的 CC BY 4.0 协议内容站内化润色：AboutPage 在「站点数据」与「支持我们」之间新增「作品许可协议」卡片（白底 1px 边框，桌面双列 md:grid-cols-2、移动端单列），含导语（经审核公开展出的摄影作品采用 CC BY 4.0 授权、著作权归作者所有）+ 四张子卡：适用范围（仅航空/铁路/公路经审核入库作品，论坛/评论/新闻/专栏文字不在许可范围）、你可以自由使用（复制传播、裁剪调色合成改编、商业用途均无需另行授权）、使用时须注明（署名格式「作品标题 · 作者名 · 来源 TLRphotos」+ 协议链接 + 修改说明 + 不得附加额外限制/暗示背书）、关于水印与原图（规范下载件为带 TLRphotos 水印版本，水印不得裁切遮挡抹除，无水印原图须联系作者另行授权）+ 协议全文外链（中文版 deed.zh-hans / 官方英文 legalcode），外链统一 rel="license noopener noreferrer" 新标签打开；沿用 blue-700 强调色与既有卡片规范，零接口变更；oxlint 0 错误、build index-ChaUQxTi.js（首包 gzip 325.15KB） | src/features/about/AboutPage.tsx |
| 2026-10-24 14:18 | [fix] 飞机注册号输入项改为仅航空分区渲染 (V4.4.3-beta) — 此前非航空分区仍显示「飞机注册号（选填，仅航空分区必填）」输入框，与「仅航空类目出现并要求填写」的业务规则不符；现桌面 UploadPage 与移动 /m/upload 第 2 步均以 `isRegistrationRequired`（category === 'aviation'）整体包裹注册号区块，非航空分区与未选分区时该字段完全不渲染；移动端第 4 步确认摘要同步隐藏「注册号」行（原固定显示「未填写」）；两处提交 meta 统一为 `registration_number: isRegistrationRequired ? trimmedRegistration : ''`，杜绝切换分类后残留旧值入库（后端非航空仍归一化 null）；航空分区保留必填星号、格式校验红字与「如 B-1234 / G-DCDE」常驻提示；后端校验逻辑与错误码 REGISTRATION_REQUIRED 不变（零接口变更）；oxlint 0 错误、build index-CqSb5aeE.js（首包 gzip 324.18KB） | src/features/upload/UploadPage.tsx、src/features/upload/mobile/MobileUploadPage.tsx |
| 2026-10-24 14:13 | [fix] 页脚版权行增补知识共享署名 4.0 国际许可协议 (V4.4.2-beta) — Footer 版权行由单行 `<p>` 改为居中弹性容器（移动端纵排、≥640px 横排并用「·」分隔），版权文字后新增「知识共享署名 4.0 国际许可协议 (CC BY 4.0)」外链，指向 https://creativecommons.org/licenses/by/4.0/deed.zh-hans，rel="license noopener noreferrer"、新标签打开，沿用 12px 灰字与 hover:text-blue-800 强调色，用户端全站页脚统一生效（管理端不渲染 Footer，维持既有隔离）；零接口变更；oxlint 0 错误、build index-D4krJXBp.js（首包 gzip 324.27KB），线上已验证新 bundle 与 CC 链接均 200 | src/shared/Footer.tsx |
| 2026-10-24 12:17 | [release] 版本号升级至 V4.4.1-beta — 全库架构审查与系统性重构（去重 + 死代码清理 + 热点索引） | 全项目 |
| 2026-10-24 12:17 | [refactor] 全库重复实现合并与死代码清理（V4.4.1-beta）：(1) 后端新增 4 个工具模块收敛重复纯函数 — utils/photoTags.ts（parsePhotoTags 2→1）、utils/optionalAuth.ts（getOptionalUserId 2→1）、utils/pagination.ts（parsePagination 参数化，6 处内联钳制公式→1）、utils/datetime.ts（formatLocalDateTime 2→1）；(2) photos 表新增 3 个索引（status+created_at / user_id+status / created_at，CREATE INDEX IF NOT EXISTS 纯加法 DDL）——实测画廊列表 4.54×、主页作品 2.79×、管理端待审 15.86×、作品计数 9.67×（N=200 中位数，SCAN+TEMP B-TREE→SEARCH/COVERING INDEX）；(3) 前端 shared/utils.ts 新增 formatDateTime/formatLongDate/formatDateOnly，收敛 7 处本地格式化副本（通知中心保持空串兜底）；(4) 删除死代码 src/shared/PhotoUploader.tsx(458 行)、src/features/gallery/mockData.ts(345 行)，移除 theme 恒为 light 导致的 dark 死分支 146 处（保留 ThemeProvider 与根节点 class 同步）；(5) 明确留档不合并项 — getClientIp×4（兜底顺序/x-real-ip 不一致）、notifications 分页（无页码钳制）、相对时间文案（可见差异）、超大文件纯规模拆分、findPhotoByOssKey 缓存（陈旧数据窗）；源码 41,777→40,673 行（-1,104），diff +266/-1,489，后端 26 套件 451 用例全绿、前端 19 用例全绿、oxlint 0 错误（27→26 warning）、build index-CKGeJTHo.js（首包 gzip 324.12KB，-0.78KB）；零接口变更，api.md 无需同步；重构说明见 docs/refactor-report-v4.4.1.md | backend/src/utils/（photoTags/optionalAuth/pagination/datetime 新增）、backend/src/routes/（photos/users/forum/announcements/news/admin）、backend/src/db.ts、src/shared/utils.ts、src/admin/（AppealsPage/NewsPage）、src/features/（news/notifications/profile/gallery/column/upload/user）、docs/refactor-report-v4.4.1.md（新增） |
| 2026-10-24 08:59 | [release] 版本号升级至 V4.4.0-beta — 移动端全站适配（响应式主干 + /m/upload 独立页混合架构） | 全项目 |
| 2026-10-24 08:59 | [feat] 移动端全站适配落地（依据 docs/prd-mobile-full-site.md）(V4.4.0-beta) — (1) 基础：viewport 锁缩放+viewport-fit=cover、安全区变量+dvh 工具类、useIsMobile/useIsTouch（useSyncExternalStore）、/upload 移动端分流 /m/upload（React.lazy 独立分包）；(2) 导航：MobileTabBar 底部五栏 56px+安全区（中央 52px 深蓝凸起上传钮按登录态分流）、Header 移动端收敛 Logo+通知铃铛（管理端入口不出现）、MobileBackHeader 二级页返回栏；(3) 核心浏览：首页横幅 48px/轮播横滑 Snap 无自动播放/分区入口三卡/双列网格/下拉刷新 70px；画廊分区 Tab 吸顶/热门 chips 横滑+Bottom Sheet 全部标签抽屉（70vh 下滑关闭）/双列瀑布流 aspect-ratio 占位防 CLS/POP 返回还原筛选与滚动；照片详情双击 1x↔2.5x+pinch 1x~4x（scale>1 锁滚动）+底部固定下载栏（TabBar 上方）+评论 L3 平铺「回复 @」+「…」菜单+聚焦 scrollIntoView；推荐页双列；(4) /m/upload 四步分步表单：步进条/单文件选图/注册号仅航空必填自动大写/水印九宫格+三档字号+透明度滑杆（scaleFactor 同源）/XHR 进度遮罩/断网退避 1s2s4s×3/REGISTRATION_REQUIRED 跳回定位/localStorage 草稿；(5) 互动：论坛单列+纯文本统计组件化+下拉刷新+楼主卡 3px 深蓝左边框+发帖 Aa 折叠工具条；通知中心未读加粗蓝点+全部已读+无限滚动+related_type 跳转扩展+处罚类深蓝左边框浅蓝底；Profile 聚合页/MyWorks segmented 三态/新建 MyAppealsPage（接 /my-appeals）/PublicProfile 处罚公示卡；(6) 管理端只读：Layout 移动端汉堡抽屉+MobileReadOnlyNotice 提示条挂五个复杂操作页+表格横滚；(7) PWA：manifest.json+icon.svg+sw.js（仅 /assets/ 与图片 cache-first、/api/ 放行）+https 注册；(8) 引导：useTip（tip_ 前缀≤3 次）+OnboardingCard 首访浮层+上传步骤提示条；(9) 红线：全站 violet/purple 清零、api.md 增移动端 page_size 备注（零契约变更）；后端 26 套件 451 用例全绿、前端 oxlint 0 错误、build index-C1etsqS2.js（首包 gzip 324KB、MobileUploadPage 独立分包 7.4KB） | index.html、src/index.css、src/App.tsx、src/shared/（useIsMobile/MobileTabBar/MobileBackHeader/Header/TopBanner/useTip/OnboardingCard）、src/features/gallery/（GalleryPage/PhotoCarousel/PhotoDetailPage/MobileZoomableImage/RecommendPage）、src/features/comments/components/、src/features/upload/mobile/（新增）、src/features/forum/、src/features/notifications/、src/features/profile/（ProfilePage/MyWorksPage/MyAppealsPage 新增）、src/features/user/PublicProfilePage、src/features/auth/AuthPage、src/features/news/、src/features/about/、src/admin/（Layout/MobileReadOnlyNotice 新增/BansPage/PhotosPage/PhotoDetailPage/AppealsPage/NewsEditorPage/LogsPage/MyAuditsPage/UsersPage/AdminsPage）、public/（manifest.json/icons/icon.svg/sw.js 新增）、backend/docs/api.md |
| 2026-10-24 08:05 | [docs] 新增移动端全站PRD：混合架构选型/19页清单/交互排版规范/引导体系/验收标准 (V4.3.0-beta.1) | docs/prd-mobile-full-site.md、package.json、package-lock.json、.trae/rules/版本管理规则.md |
| 2026-10-24 08:00 | [release] 版本号升级至 V4.3.0-beta — 管理端论坛治理页落地（板块管理 + 帖子管理，替换占位页） | 全项目 |
| 2026-10-24 08:00 | [feat] 管理端论坛治理页落地（V4.3.0-beta）— 替换 V4.0.0 起 /admin/forum 占位页：新建 ForumPage 双 tab，板块管理（列表含停用状态与基础板块徽章、编辑弹窗名称/描述/图标/排序、启停切换、删除、按 CANONICAL 白名单幂等补齐基础板块按钮）+ 帖子管理（板块筛选/最新最热排序/分页/置顶切换/删除挂人机验证门级联删除评论）；admin/api.ts 新增 7 个论坛治理封装（帖子列表复用公开 GET /api/forum/threads），types.ts 新增 ForumBoard/ForumThreadItem；AdminApp 移除 PlaceholderPage 接入 ForumPage 并传 currentAdmin 角色门（super/zone_master/forum_moderator，与后端 /api/admin/forum/* 一致）；复用既有后端契约零 API 变更；build index-BY4_n2hL.js，oxlint 0 错误 | src/admin/ForumPage.tsx（新增）、src/admin/AdminApp.tsx、src/admin/Layout.tsx、src/admin/api.ts、src/admin/types.ts |
| 2026-10-23 23:47 | [release] 版本号升级至 V4.2.0-beta — 标签体系与审核流转迭代（三层标签浏览/上传标签必填/顺序审核软约束/申诉责任判定/热门推荐） | 全项目 |
| 2026-10-23 23:47 | [feat] V4 标签体系与审核流转迭代落地（依据 docs/prd-v4-tag-audit-workflow.md）(V4.2.0-beta) — 三层标签浏览（GalleryPage 分区 › 标签对象 › 细分类属性逐层下钻 + 面包屑逐层返回 + 清除筛选，移除旧 TagSelector 侧栏，筛选统一 searchPhotos({tag,tag_key,tag_value})；后端 /search 与 GET /photos 支持逗号分隔多标签 AND 与 structured_tags 属性匹配）；上传第二层标签强制必填（UploadPage canSubmit 要求 selectedTags.length>0，后端 /upload 与 /upload/complete 缺失返回 400 TAG_OBJECT_REQUIRED；photos.structured_tags 纳入正式迁移）；顺序审核软约束（/admin/photos/pending 改 created_at ASC 并返回 next_photo_id，PhotosPage 队首卡片标「下一张」不阻断选择）；申诉重审审核员责任（appeals 增 reviewer_fault/reviewer_admin_id，decide 支持 none/mistake/violation 有责强制申诉成立并写 admin_warnings 新表，新增 GET /admin/warnings 仅 super，AppealsPage 责任三选一+处分记录面板+展示 reviewer_name）；审核员编号公开（GET /photos/:id 与 /auth/me/photos 联表返回 reviewer_name 仅 rejected，MyWorksPage/PhotoDetailPage 展示驳回理由+审核员）；热门推荐（新增 GET /photos/hot 按 views+likes*3、首页轮播热门优先、新增 /recommend 页与 Header 入口）；api.md 同步 8 处契约；backend 26 套件 451 用例全通过，oxlint 0 错误，build index-CFdQKSjd.js | src/features/gallery/GalleryPage.tsx、src/features/gallery/PhotoCarousel.tsx、src/features/gallery/RecommendPage.tsx（新增）、src/features/gallery/PhotoDetailPage.tsx、src/features/gallery/types.ts、src/features/upload/UploadPage.tsx、src/features/profile/MyWorksPage.tsx、src/api/photos.ts、src/api/auth.ts、src/admin/api.ts、src/admin/types.ts、src/admin/PhotosPage.tsx、src/admin/AppealsPage.tsx、src/App.tsx、src/shared/Header.tsx、backend/src/db.ts、backend/src/routes/photos.ts、backend/src/routes/admin.ts、backend/src/routes/auth.ts、backend/tests/integration/photos.test.ts、backend/docs/api.md |
| 2026-10-23 23:22 | [fix] 修复飞机注册号必填规则：由全分类强制必填改为仅 aviation 分区必填 (V4.1.2-beta.2) — 前端 UploadPage 新增 isRegistrationRequired（随分类实时切换必填星号/占位符/提示文案），非航空分区留空即通过、非法格式仅提示不阻断提交，canSubmit 与 submit 防御校验同步；后端 /upload 与 /upload/complete 改为 category==='aviation' 才返回 400 REGISTRATION_REQUIRED，其余分区空值/非法归一化为 null 落库（complete 新增可选 category 参数，旧客户端按非航空处理）；api.md 两处契约同步；26 套件 449 用例全绿（新增非航空缺注册号放行用例），oxlint 0 错误，build index-DZxkbuMy.js | src/features/upload/UploadPage.tsx、src/api/photos.ts、backend/src/routes/photos.ts、backend/tests/integration/photos.test.ts、backend/docs/api.md |

| 2026-10-23 23:18 | [docs] 新增标签体系与审核流转优化PRD：三层标签/浏览交互/审核流转/申诉重审/热门图片 (V4.1.2-beta.1) | docs/prd-v4-tag-audit-workflow.md、package.json、package-lock.json、.trae/rules/版本管理规则.md |
| 2026-10-23 18:11 | [docs] 13 项 CVE 批量核验归档（依据 OSV/NVD/CVE.org/nodejs.org 官方记录）— Node.js 四项 CVE-2026-111497（Brotli 越界写 RCE）/105482（DNS NUL 截断）/105483（全角数字 IP 绕过 TLS）/106069（TLS 主机名宽松解析绕过）均由今日 V4.1.2-beta 运行时升级 v24.22.1 修复；sharp CVE-2026-96889（捆绑 librsvg UAF）已由 V4.1.1-beta 升 0.35.5 修复；multer CVE-2026-88932（中断上传孤儿文件 DoS，影响 2.2.0-2.3.0）/CVE-2026-3520（递归 DoS，影响 <2.1.1）均由 multer 2.5.0 覆盖；nodemailer 三项 CVE-2026-82659（raw SSRF，<9.0.1）/100700（addressparser ReDoS，<10.0.6）/92595（resolveContent 沙箱绕过，≤9.1.0）本站 10.0.13 天然免疫且 aliMailService 仅用 sendMail 固定模板、不涉 raw/resolveContent 攻击面；用户清单中标注 Express/jsonwebtoken 的三项编号经核实为组件映射不符——CVE-2026-29112 实为 @dicebear/converter（本站无此依赖）、CVE-2026-31845 实为 Rukovoditel CRM（PHP 应用，本站零 PHP）、CVE-2026-25537 实为 Rust crate jsonwebtoken（本站为 npm JS 包 auth0/node-jsonwebtoken@9.0.3，npm 最新即 9.0.3）；结论：13 项全部已修复或不适用，零代码变更，不升版本号；核验明细见 .trae/documents/cve-batch-verification-2026-10-23.md | .ai/context.md、.trae/documents/cve-batch-verification-2026-10-23.md |
| 2026-10-23 18:01 | [fix] 紧急安全修复（V4.1.2-beta）— node2shell（CVE-2026-111497，Node.js 核心 Brotli 解码器越界写入 RCE）：官方 2026-10-21 安全发布仅覆盖 26.x/24.x/22.x（修复版 26.12.1/24.22.1/22.23.4），20.x EOL 无补丁；生产服务实测跑 v20.20.2（fnm --using 20）命中、构建 shell v24.18.0 低于修复线；fnm 安装 v24.22.1（24.x LTS 最新，完整性三重核验：tarball sha256 对官方 SHASUMS256=6c172a9a…、安装 bin/node 与官方 tarball 逐字节一致、可执行报 v24.22.1），systemd ExecStart 改 --using 24.22.1 钉死精确版本+daemon-reload+restart，fnm default 对齐；四原生模块（sqlite3/better-sqlite3/bcrypt/sharp）N-API 免重建直载 NATIVE_OK，24.22.1 下 26 套件 448/448 全绿；生产 active，/proc exe 铁证运行二进制 v24.22.1，journal 启动正常（MemoryManager/归档作业 OK），冒烟 /api/about/stats、/api/announcements、/api/photos 200、匿名上传 401；同批消除 CVE-2026-105482/105483 等 4 项 High；v20.20.2 保留作回滚通道；纯运行时升级零代码变更 | /etc/systemd/system/tlrphotos-backend.service（服务器侧）、fnm 运行时、package.json、package-lock.json |
| 2026-10-23 17:47 | [fix] 紧急安全修复（V4.1.1-beta）— PHP2Shell（CVE-2026-109618/109619，PHP 核心 RCE）与 React2Shell（CVE-2025-55182/Next.js CVE-2025-66478，RSC 反序列化 RCE）排查确认本站均不适用（零 PHP、无 react-server-dom-*/Next.js，React 19.2.7 纯客户端渲染）；npm audit 实测修复：backend proxy-addr critical（IPv4-mapped IPv6 欺骗）+ multer（DoS/竞态）+ sharp（libheif/librsvg CVE）+ brace-expansion/http-cache-semantics/ip-address，root react-router high（RSC Mode CSRF）；sqlite3@6.0.1 force 升级因预编译二进制需 GLIBC_2.38 环境不满足回滚 5.1.7，残留 7 项（1 critical tar）全部位于 sqlite3→node-gyp→cacache 构建期链（仅 npm install 解压预编译包使用，非运行时数据面），root 残留 4 low katex 链（修复需 katex@0.19 breaking，rehype-sanitize 已兜底）记录为残留风险；原生模块 sqlite3/better-sqlite3/bcrypt 经 install-scripts approve+rebuild 恢复；backend tsc 0 错误 26 套件 448 用例全通过，oxlint 0 错误，build index-DUFTIF0X.js；生产重启冒烟通过（/api/about/stats、/api/announcements、/api/photos 200，匿名上传 401 前置生效） | backend/package.json、backend/package-lock.json、package.json、package-lock.json |
| 2026-10-18 12:58 | [deploy] V4.1.0-beta 部署完成 — 生产库备份 database.db.bak-v4.1-20261018-125630 后 backend rebuild+restart（active）；迁移核验 penalties capabilities/revoked 列与 users 五新列就位、旧处罚数据 0 条未迁移、announcements 表建妥；冒烟通过：/api/announcements 空列表、/api/users/:id/profile（星空联盟 joined_days=96 approved=19）、/api/users/:id/photos 仅 approved、threads、unread-count 401 鉴权、/api/photos/search 回归；线上 HTTPS 引用 index-DtO20r5K.js 与构建一致；spec tasks/checklist 全部勾选 | 全项目 |
| 2026-10-18 12:49 | [release] 版本号升级至 V4.1.0-beta — 处罚分级与公告横幅迭代：三级处罚体系（L1 警告/L2 按项功能封禁 capabilities 快照+30~360 天/L3 永久或限时 banned_until+到期自愈，存量两级数据幂等迁移 旧L1→L2+upload、旧L2→L3）、POST /admin/penalties/:id/revoke（L1 仅 super、L2/L3 super/zone_master）、四项 L2 执法（上传 UPLOAD_BANNED/评论 COMMENT_BANNED/发帖 FORUM_POST_BANNED/下载 DOWNLOAD_BANNED，过期自动失效）、用户权限项扩至 7 项（+can_comment/can_forum_post/can_ban_manage+审计）、管理端封禁管理页 /admin/bans（双重确认+人机验证门+审核/申诉页快捷跳转+UsersPage 入口收敛）、公开用户主页 /users/:id（region 省份离线解析 ip2region 不存明文 IP+处罚公示卡+分区作品+论坛发帖记录）、公告横幅（announcements 表+管理端 CRUD 手动上下线 super/news_editor+TopBanner 关闭本地记忆）、api.md 同步 13 处；后端 tsc 0 错误 26 套件 448 用例全通过，oxlint 0 错误，build index-DtO20r5K.js | 全项目 |
| 2026-10-18 14:55 | [feat] V4.1 Wave 3A 管理端封禁管理页 — 新建 BansPage（三级处罚表单 L2 四能力勾选+L3 永久/限时、双重确认弹窗+人机验证门、处罚历史撤销/解除 L1 仅 super、?userId 预选、管理员目标仅留痕提示）与 AnnouncementsPage（公告 CRUD+上下线 toggle+删除二次确认+错误码映射）、Layout 菜单两项（bans=super/zone_master、announcements=super/news_editor）、UsersPage 移除 V4.0.0 处罚对话框与封禁/解封按钮改「处罚管理」跳转+权限弹窗扩至 7 项+列表展示 region/banned_until、PhotoDetailPage/AppealsPage 加「处罚该用户」跳转；api.ts 新增 revokePenalty/公告 CRUD 并删除 banUser/unbanUser、types.ts Penalty 扩三级+Announcement；后端 users 加 can_comment/can_forum_post 幂等 ALTER（含 legacy 重建表 DDL 同步）、permissions 端点扩 7 项+审计、comments/forum 创建前权限执法（can_comment=0/can_forum_post=0 → 403 PERMISSION_DENIED，独立于处罚执法）、新增 v4-permissions-7items.test.ts 4 用例；tsc 0 错误 26 套件 448 用例全通过；oxlint 0 错误；build 产物 index-DtO20r5K.js [push-deferred] 用户指令暂缓 git 提交（版本号随 Wave 汇总统一升级） | src/admin/BansPage.tsx（新增）、src/admin/AnnouncementsPage.tsx（新增）、src/admin/UsersPage.tsx、src/admin/PhotoDetailPage.tsx、src/admin/AppealsPage.tsx、src/admin/Layout.tsx、src/admin/AdminApp.tsx、src/admin/api.ts、src/admin/types.ts、backend/src/db.ts、backend/src/routes/admin.ts、backend/src/routes/comments.ts、backend/src/routes/forum.ts、backend/tests/integration/v4-permissions-7items.test.ts（新增） |

| 2026-10-18 12:07 | [feat] V4.1 Wave 3B 用户侧 — 公开用户主页 /users/:id（档案+处罚公示+分区分组作品+发帖记录）、TopBanner 公告横幅（关闭按 id 本地记忆/常驻重开按钮）、评论与帖子作者名打通主页链接；oxlint 0 错误；npm run build 被 src/admin 并行改动阻塞 [push-deferred] 用户指令暂缓 git 提交 | src/api/users.ts、src/api/announcements.ts（新增）、src/features/user/PublicProfilePage.tsx（新增）、src/shared/TopBanner.tsx（新增）、src/App.tsx、src/features/comments/components/CommentItem.tsx、src/features/forum/ThreadDetailPage.tsx |

| 2026-10-18 11:38 | [feat] V4.1 处罚分级 Wave 2A：处罚端点三级化（L1 警告/L2 功能封禁 capabilities 快照+days 30~360/L3 账号封禁 banned_until+永久）、新增 POST /admin/penalties/:id/revoke（L1 仅 super 撤销、L2/L3 super/zone_master，PENALTY_ALREADY_REVOKED/404/BAN_MANAGE_DENIED，L3 撤销清 banned_at 并恢复 is_active）、四项 L2 执法点挂接（checkUploadBan 改 checkPenaltyCap('upload')、下载代理 ?download=1 DOWNLOAD_BANNED、评论 COMMENT_BANNED、发帖 FORUM_POST_BANNED）、处罚历史返回 capabilities 数组+revoked 字段；v4.test.ts 两级断言适配三级语义，新增 v4-penalty.test.ts 20 用例；tsc 0 错误，25 套件 444 用例全通过 [push-deferred] 用户指令暂缓 git 提交（版本号随 Wave 汇总统一升级） | backend/src/routes/admin.ts、backend/src/routes/photos.ts、backend/src/routes/comments.ts、backend/src/routes/forum.ts、backend/tests/integration/v4.test.ts、backend/tests/integration/v4-penalty.test.ts（新增） |
| 2026-10-18 11:32 | [docs] 版本号升级至 V4.0.0-beta.5 — 架构图红线可读性重构：核实代码后删除 3 条画错的捷径红线（imageService/commentArchive 实际经 ossService 上传、定时作业实际调 commentArchiveService），进程外调用从 7 条收敛为 4 条真实直连；解散外部服务包，4 个外部服务框下沉至唯一调用者所在业务域列底（灰底【外部】标识），红线变成列内短竖线（SVG 实测跨度 4114/3840/2167/1865 → 266/26/56/10）；ossService 框新增「全站唯一 OSS 出口 · 消费方」标注承载复用关系；应用层大框移除（运行时/启动流程并入中间件链包标题），渲染 PNG 7366×1434 + SVG | docs/architecture-detailed.puml、docs/architecture-detailed.png、docs/architecture-detailed.svg、package.json、package-lock.json、.trae/rules/版本管理规则.md |
| 2026-10-18 10:43 | [docs] 版本号升级至 V4.0.0-beta.4 — 架构图重构为业务域纵列布局：每一纵列=一个业务域（认证/照片·标签/评论/论坛/内容/通知·申诉/验证/AI/管理端/定时任务），列内「路由→服务→数据表」强逻辑纵向调用链；管理端审核路由下沉业务域列（橙色标识），跨列连线收敛为 1 条橙线；46 条边按流向配色（灰主链/蓝/绿/橙/红）与图例一致；SVG 坐标量化验证域内对齐 ≤387px；smetana 渲染 PNG（8560×1689）+ 新增 SVG 矢量版 | docs/architecture-detailed.puml、docs/architecture-detailed.png、docs/architecture-detailed.svg（新增）、package.json、package-lock.json、.trae/rules/版本管理规则.md |
| 2026-10-18 10:23 | [docs] 新增警告及处罚系统优化PRD：三级处罚分级/封禁界面/主页改善/公告横幅 (V4.0.0-beta.3) | docs/prd-v4-penalty-notification.md、package.json、.trae/rules/版本管理规则.md |
| 2026-10-18 10:05 | [docs] 版本号升级至 V4.0.0-beta.2 — 架构图连线可读性重构：30+ 条细粒度交叉线收敛为 9 条按流向配色的包级粗箭头（蓝=用户端调用/橙=管理端/绿=数据读写/红=外部服务/青虚线=定时任务/紫虚线=工具），新增底部颜色图例，smetana 重渲染 PNG（6255×2148） | docs/architecture-detailed.puml、docs/architecture-detailed.png、package.json、package-lock.json、.trae/rules/版本管理规则.md |
| 2026-10-17 22:25 | [docs] 版本号升级至 V4.0.0-beta.1 — 重绘 PlantUML 详细版架构图至 V4 架构：17 组路由挂载/114 端点（用户端 66+管理端 47+health）、17 服务、主库 24 表+标签库 3 表、用户新增论坛/新闻/通知/申诉/关于我们模块与管理端 12 页面，smetana 引擎网格布局渲染 PNG（7496×2256） | docs/architecture-detailed.puml、docs/architecture-detailed.png、package.json、package-lock.json、.trae/rules/版本管理规则.md |
| 2026-10-17 19:20 | [deploy] V4.0.0-beta 生产部署完成并冒烟通过 — 后端 rebuild+restart（127.0.0.1:3001 active）、生产 .env 补 RECALL_WINDOW_MINUTES=3；冒烟：/api/about/stats（site_days=64/approved_count=103）、/api/news（空列表分页正常）、/api/notifications/unread-count（401 鉴权正常）、/api/photos/search 回归正常；提交 f9b91a2 已推送 | backend/.env、tlrphotos-backend.service、dist（index-B0BbVGk_.js） |
| 2026-10-17 19:10 | [release] 版本号升级至 V4.0.0-beta — V4 全模块迭代提交推送（通知召回/处罚申诉/论坛治理/新闻区/关于我们，详见提交 f9b91a2 说明） | 全项目（后端 23 套件 400 用例、前端 oxlint 0 错误） |
| 2026-10-17 18:30 | [push-deferred] [feat] V4迭代Task6.3新闻区前端+Task5.3通知跳转校验 — 新闻管理端（NewsPage 列表+删除确认；NewsEditorPage 新建/编辑复用：图库选图弹窗复用 GET /api/photos/search 关键字检索+弹窗分页24/页+多选去重合并+逐张授权确认勾选未全勾提交禁用+上移/下移排序/移除，PUT 全删全插每次传完整 images 数组，板块固定航空只读；admin/api.ts 增新闻四封装；AdminApp 路由 /admin/news、/admin/news/new、/admin/news/:id/edit 替换占位页）；新闻前台（api/news.ts 公开列表/详情；NewsListPage /news 加载更多；NewsDetailPage /news/:id react-markdown 正文+配图代理 URL 新窗打开+页脚显著版权行渲染后端 copyright_notice；App/Header/Footer 入口）；Task5.3 校验：forum_reply related_type=thread/photo/article 与 NotificationPage 跳转映射一致无需修正；用户指令禁止 git 提交 | src/api/news.ts（新增）、src/admin/{api.ts,NewsPage.tsx（新增）,NewsEditorPage.tsx（新增）,AdminApp.tsx}、src/features/news/{NewsListPage.tsx,NewsDetailPage.tsx}（新增）、src/{App.tsx,shared/Header.tsx,shared/Footer.tsx}；oxlint 0 错误（19 既有 warnings）、vite build 通过（index-B0BbVGk_.js） |
| 2026-10-17 18:20 | [push-deferred] [release] V4迭代Wave1 P0前端全量发布 V4.0.0-beta — 通知中心/用户申诉/管理端审核增强 | src/api/{notifications,appeals,client}.ts、src/features/notifications/NotificationPage.tsx、src/features/{gallery/PhotoDetailPage,profile/MyWorksPage}.tsx、src/admin/{api,types,PhotoDetailPage,UsersPage,Layout,AdminApp}.tsx、src/admin/{MyAuditsPage,AppealsPage}.tsx、src/shared/Header.tsx、src/App.tsx、package.json、.trae/rules/版本管理规则.md |
| 2026-10-17 18:22 | [push-deferred] [feat] V4迭代模块二三（论坛治理+新闻区）后端实现 — 角色扩展 AdminRole 增 forum_moderator/news_editor（adminForum/adminComments 挂三角色门禁禁 zone_auditor，approve/reject 锁定 PHOTO_AUDIT_ROLES 三角色 403）；板块收敛 CANONICAL_FORUM_BOARDS（db seed 按名幂等补 航空/铁路/公路，建板块 400 BOARD_LIMITED 白名单幂等、基础板块 400 BOARD_PROTECTED 保护）；articles 公开列表加 ?board_id= 筛选并透出 type/board_id；comments 二级回复触发 forum_reply 通知（title=回复@回复人、content={回复人}回复了你在《{主题标题}》下的评论、related 指向 thread/photo/article，自回复/无主不发、失败不影响主流程）；新闻区新建 routes/news.ts（管理端 /api/admin/news POST/PUT/GET/DELETE：标题≤200+正文必填+首批仅航空板块 BOARD_NOT_ALLOWED+配图≥1 逐张授权确认 AUTHORIZATION_REQUIRED+photo 须 approved PHOTO_INVALID，PUT 配图事务内全删全插，权限 requireRole super/news_editor；公开端 /api/news 列表分页含封面代理 URL、详情含 images 数组与后端拼接 copyright_notice=@作者 ©TLRphotos 年份 版权所有，120/min 限速）；db 新增 news_images 表（article 级联）+正文落 articles/news/*.md；forum.test.ts 两处旧板块断言同步为新三板块 | backend/src/{db.ts,server.ts,routes/news.ts,routes/adminForum.ts,routes/adminComments.ts,routes/admin.ts,routes/comments.ts,routes/articles.ts,services/adminService.ts}、backend/tests/integration/{v4-forum-news.test.ts（+26 用例）,forum.test.ts}（全套件 400 全绿，tsc 无错误）；api.md 与 .env.example 按用户指令后续统一补 |
| 2026-10-17 18:05 | [push-deferred] [feat] V4迭代后端模块一实现 — 通知中心（notifications 表+服务+/api/notifications 四端点+90天清理）、召回两级机制（PUT /admin/photos/:id/recall，RECALL_WINDOW_MINUTES 窗口内静默/超窗原因必填+photo_recalled 通知）、两级处罚（POST /admin/users/:id/penalty，L1 upload_banned_until 上传禁令四路径拦截 403 UPLOAD_BANNED/L2 banned_at+强制下线）、申诉双向回执（POST /photos/:id/appeal、/api/my-appeals、GET /admin/appeals、PUT /admin/appeals/:id/decide）、热门确认/审核分配/我的审核（/hot、/assign、/my-audits）、点赞与下载通知触达（24h 去重）、about 站点统计（GET /api/about/stats）；photos 加 reviewed_by/reviewed_at/is_hot_confirmed/assigned_to、articles 加 type/board_id、users 加 upload_banned_until；api.md 与 .env.example 按用户指令后续统一补 | backend/src/{db.ts,server.ts,routes/admin.ts,routes/photos.ts,routes/notifications.ts,routes/myAppeals.ts,routes/about.ts,services/notificationService.ts}、backend/tests/integration/v4.test.ts（+47 用例，全套件 374 全绿，tsc 无错误） |
| 2026-10-17 17:40 | [push-deferred] [feat] 新增关于我们页/about：团队角色卡+站点数据（GET /about/stats 契约按后端并行实现）+支持我们占位卡，Header/Footer 增加入口；用户指令暂缓提交推送 | src/api/about.ts、src/features/about/AboutPage.tsx、src/App.tsx、src/shared/{Header,Footer}.tsx |
| 2026-10-17 17:00 | [docs] 新增V4迭代PRD规划稿：通知召回/论坛/新闻区/关于我们 (V3.2.0-beta.2) | docs/prd-v4-iteration.md、package.json、.trae/rules/版本管理规则.md |
| 2026-10-17 09:56 | [fix] 强化论坛帖子点赞按钮可见度：灰字改为淡蓝描边pill/已赞深蓝实底（纯文字无图标）(V3.2.0-beta.1) | src/features/forum/ThreadDetailPage.tsx、dist（index-Du4hPM4O.js） |
| 2026-10-17 08:04 | [deploy] V3.2.0-beta 生产部署完成并冒烟通过 — 服务重启/新列已自动迁移/接口返回正常 | backend/.env（EMAIL_VERIFY_INTERVAL_DAYS=30）、tlrphotos-backend.service |
| 2026-10-17 08:01 | [release] 界面优化八项发布 V3.2.0-beta — 邮件验码周期化/注册号必填+检索/热门意愿/大标签聚合/三色色板/页脚/论坛去AI化 | backend/src/{db.ts,routes/auth.ts,routes/photos.ts,services/authService.ts}、backend/docs/api.md、backend/.env.example、src/index.css、src/shared/{Footer,Header}.tsx、src/features/{auth,gallery,upload,forum,profile,comments}/*、src/admin/*、后端327用例通过 |
| 2026-10-11 17:42 | [release] 正式上线前版本号挂预发布标识 V3.1.0-beta（SemVer §9，GA 时去后缀） | package.json、package-lock.json、.trae/rules/版本管理规则.md（新增 2.4 预发布规范） |
| 2026-10-11 09:55 | [release] 论坛二期板块/帖子/帖子流发布 V3.1.0 | backend/src/{db.ts,routes/forum.ts,routes/adminForum.ts,routes/comments.ts,services/commentService.ts,services/verificationService.ts,server.ts}、src/features/forum/*、src/api/{forum.ts,verification.ts,comments.ts}、src/utils/commentTree.ts、src/shared/Header.tsx、src/App.tsx（后端315/前端19用例，帖子详情复用CommentList subject_type=thread） |
| 2026-10-10 23:28 | [release] 论坛一期三级嵌套评论系统发布 V3.0.0 | 全项目（comments 表重建、归档/回迁/热度三档、照片页与文章页接入、api.md 全量同步） |
| 2026-10-10 23:28 | [fix] 评审退回修复 F-1~F-4：归档删除越权、回迁并发锁、错误码、管理员人机门 | backend/src/services/commentService.ts、commentArchiveService.ts、routes/comments.ts、adminComments.ts、backend/docs/api.md、comment-archive.test.ts（+2 回归用例，后端 313/前端 19 用例，E2E 13/13） |
| 2026-10-10 21:59 | [test] 论坛一期回归全绿与13项E2E实测通过 | 全项目（后端311/前端19用例，E2E覆盖三级发布·归档回迁·平铺·点赞·排序·移动端） |
| 2026-10-10 21:59 | [chore] 清理QA临时代理并配置OSS CORS域名白名单 | vite.config.ts、OSS bucket tlr-main（生产域名GET规则，localhost源已移除） |
| 2026-10-10 21:59 | [fix] L3互回复平铺修正杜绝第四级视觉嵌套 | backend/src/utils/commentTree.ts、src/utils/commentTree.ts（depthOf选项，L3挂L3上移至depth≤2祖先） |
| 2026-10-10 20:55 | [docs] 同步评论API契约与评论环境变量 | backend/docs/api.md、backend/.env.example |
| 2026-10-10 20:51 | [feat] 照片页与文章页接入通用三级评论区 | src/features/gallery/PhotoDetailPage.tsx、src/features/column/ArticleDetailPage.tsx、src/api/articles.ts |
| 2026-10-10 20:44 | [feat] 新增前端评论API/缓存/Hook与六大组件 | src/api/comments.ts、src/features/comments/{commentCache,useComments,useArchivedThread}.ts*、src/features/comments/components/*.tsx、src/utils/commentTree.ts、vitest.config.ts、src/test/setup.ts、src/**/*.test.{ts,tsx}、package.json |
| 2026-10-10 20:27 | [feat] 新增评论路由与管理端点及定时归档作业 | backend/src/routes/comments.ts、adminComments.ts、server.ts、routes/articles.ts、backend/tests/integration/comments-api.test.ts |
| 2026-10-10 20:14 | [feat] 新增评论归档/回迁服务与存储抽象 | backend/src/services/commentArchiveService.ts、commentArchiveStore.ts、ossCommentArchiveStore.ts、ossService.ts、backend/tests/integration/comment-archive.test.ts |
| 2026-10-10 20:04 | [feat] 新增评论领域服务与树算法 | backend/src/services/commentService.ts、backend/src/utils/commentTree.ts、backend/tests/integration/comments.test.ts、backend/tests/unit/commentTree.test.ts |
| 2026-10-10 19:54 | [feat] 新增评论热度评分服务 | backend/src/services/commentHeatService.ts、backend/tests/unit/commentHeatService.test.ts |
| 2026-10-10 19:48 | [refactor] 评论通用化表结构与V3迁移 | backend/src/db.ts、backend/tests/integration/migration-v3*.test.ts |
| 2026-10-07 16:54 | [release] 版本号升级至 V2.0.0 — 全面移除手机验证码收敛为纯邮箱认证 | 全项目 |
| 2026-10-07 16:54 | [refactor] 全面移除手机验证码体系并收敛为纯邮箱认证（破坏性版本）：(1) 数据库 — 新基线 users 删除 phone/phone_verified、新增 email_verified（NOT NULL DEFAULT 0）、email 允许 NULL；admin_users 删除 phone 列；V2 增量迁移：ADD email_verified 幂等 → 删除两个 agent.probe 账号（删前校验 photos/likes/views 关联均 0）→ 清空 channel=sms 验证码 → users/admin_users 表重建（new 表→显式列 INSERT SELECT→行数校验→DROP/RENAME），破坏性操作前生成 .bak-v2-<ts> 备份、事务外 foreign_keys=OFF finally 恢复；(2) 服务层 — 删除 spugService，otpService 收敛单通道（scene=login/register/bind_email、固定 channel=mail、maskTarget 仅邮箱脱敏），authService 重写（findUserByEmail/isValidEmail/register 建号即 email_verified=1/markEmailVerified/bindUserEmail），adminService 删除全部短信票据与手机引导；(3) 路由 — auth.ts 重写：新增 POST /email/code/send（三场景三层限速、login 未注册 404、register 409、bind_email 凭 bind_ticket 或 JWT）、/register 验证码注册即登录、/login 两阶段（otp_required+login_ticket；无邮箱 403 EMAIL_BIND_REQUIRED+bind_ticket；测试旁路仅 NODE_ENV=test）、/login/verify（目标取服务端 user.email，先 markEmailVerified 再签发）、/email/bind（票据路径绑定即登录/JWT 路径返回资料）；admin.ts 全角色单阶段登录、删除 ADMIN_SMS_REQUIRED 与 /login/sms/*，新增 PUT /users/:id/email（仅超管+人机门，404/409，email_verified=0）；(4) 确权门 — 新建 requireVerifiedEmail（匿名 401 AUTH_REQUIRED、未确权 403 EMAIL_VERIFICATION_REQUIRED），挂接照片点赞/上传（认证前置 multer）/删除与文章评论（评论改 JWT、author 取用户名/邮箱）；/me、改密、头像加邮箱确权检查；(5) 前端 — AuthPage 三段（凭证/验证码/强制绑定）、ProfilePage 删除全部手机弹窗改为更换邮箱（已验证绿徽章/未验证琥珀徽章）、管理后台 LoginPage 用户名+密码+Turnstile 单阶段，api/types 同步；(6) 测试 — 全套件 13 files/230 用例通过（含新建 migration-v2 10 用例：旧结构库→列删除/默认值/NULL/probe 清理/sms 清零/数据完整/备份/幂等；生产库真实副本 VACUUM INTO 演练 25→23 数据完整）；(7) 生产部署 — 服务重启迁移成功（users 23/photos 173/likes 9/views 68/admins 15、sms 码 0、phone 列不存在），.env 删除 SPUG_*_TEMPLATE/SUPER_ADMIN_PHONES/ADMIN_SMS_REQUIRED；以真实部署产物+真实阿里云 DirectMail 投递+生产库副本启动隔离实例，21 项断言全部通过（注册/两段登录/JWT 换邮箱/票据强绑/超管单阶段登录/超管改邮箱/篡改票据拒绝/确权门匿名 401），测试后删除临时超管与测试残留（users 恢复 23/admins 15）；旧 JWT 部署后需重新登录（预期）；回滚=恢复 .bak-v2-* + revert 代码 + 还 .env 配置 (V2.0.0) | backend/src/{db.ts,server.ts}, backend/src/services/{otpService,authService,adminService,verificationService}.ts, backend/src/middleware/requireVerifiedEmail.ts, backend/src/routes/{auth,admin,photos,articles}.ts, src/api/auth.ts, src/shared/UserContext.tsx, src/features/{auth/AuthPage,profile/ProfilePage}.tsx, src/admin/{LoginPage,api,types}.tsx, backend/tests/**, backend/docs/api.md, backend/.env.example, package.json, .trae/rules/版本管理规则.md |

| 2026-10-03 21:35 | [fix] 按站长紧急指令撤销超管短信验证码门并保障安全：先轮换 admin 账号公开默认密码（服务器端直接写库，bcrypt 新随机密码、token_version+1 踢旧会话、保留首登强制改密，生产库备份 database.db.bak-smsgate-*），再加 ADMIN_SMS_REQUIRED 紧急开关（逐请求读 env，默认 on 缺省安全；off 时超管与审核员同路径直接签发 JWT，未签发票据使 /login/sms/* 端点失效）；.env 置 off 并重启，进程 dotenv 加载确认；新增 3 用例（off 直发 token、off 票据失效、默认仍两阶段），全套件 218 通过；线上验证 Turnstile 外门 403 正常、公网端口行为不变；api.md/.env.example 同步；回滚方案=改回 on 重启即恢复短信门 | backend/src/routes/admin.ts, backend/tests/integration/admin.test.ts, backend/.env(.example), backend/data/database.db, package.json, backend/docs/api.md |
| 2026-10-02 16:26 | [release] 版本号升级至 V1.13.0 — 超管短信验证码第二因素 + 强制改密闸门上线 | 全项目 |
| 2026-10-02 16:26 | [feat] 超管短信第二因素正式部署：.env 写入站长提供的 3 位超管手机号（admin/y/星空联盟）并置 ADMIN_FORCE_CHANGE_PASSWORD=on，重启服务；启动日志确认 3 号码绑定成功（脱敏显示）+ 默认密码超管 admin 命中暴露检测置 must_change_password=1；生产库核验 phone/phone_verified=1/force_pw 与预期一致；公网验证新端点 /login/sms/send 存在（伪造票据 401 INVALID_LOGIN_TICKET）、公开接口 200；生产库停用残留测试超管 superadmin；真实短信通道测试发现 Spug 返回 403「账户未通过实名认证」——短信验证码整体不可用（含用户侧短信 OTP），待站长完成 push.spug.cc 实名认证后自动恢复，期间超管新登录被短信门暂时拦阻（既有 JWT 不受影响，y/星空联盟 force_pw=0 可正常使用） | backend/.env, backend/data/database.db, package.json, .trae/rules/版本管理规则.md, .ai/context.md |
| 2026-10-02 13:20 | [feat] 超管短信第二因素完成开发并先行部署前端：放弃 CF Zero Trust（需信用卡）改为仅超管（role=super）登录追加手机短信验证码，复用 Spug 短信通道、不引入新工具；admin_users 新增 phone/phone_verified 列与幂等迁移，bootstrapSuperAdminPhones 经 SUPER_ADMIN_PHONES 配置预绑定（格式错拒启、找不到账号告警、走配置通道防抢绑）；signAdminSmsTicket/verifyAdminSmsTicket 5 分钟 HMAC 票据绑定用户名+IP；/login 改两阶段（super 返回 sms_required+票据不发 JWT、未绑手机 403 SUPER_PHONE_NOT_VERIFIED；审核员直发 token 流程零变化），新增 /login/sms/send（三层限速 60s 冷却+5/h+20 IP/h）与 /login/sms/verify（错误计入 5 次锁定）；前端 LoginPage 短信第二阶段 UI（进入自动发码、60s 倒计时、返回重走挑战），api/types 适配；api.md 契约同步；admin.test.ts 新增 9 用例（spugService 全 mock 读码），全套件 215 通过、lint 0 错误；前端 dist 已上线（index-BTSaG2QS.js，与旧后端兼容）；生产库停用残留测试超管 superadmin；后端重启与开关 on 待用户提供 3 位真实超管手机号后执行 [push-deferred] | backend/src/{db.ts,server.ts}, backend/src/services/adminService.ts, backend/src/routes/admin.ts, src/admin/{LoginPage,api,types}.tsx, backend/docs/api.md, backend/.env.example, backend/data/database.db |
| 2026-09-30 21:30 | [feat] 管理后台登录安全加固（阶段0已部署，开关 off）：admin_users 新增 must_change_password/token_version 列与幂等迁移；adminService 重写——JWT 强制 iss/aud/tv、8h 有效期、密钥 ≥32 字符无回退、用户不存在执行 dummy bcrypt compare 消时序、超管初始化按 bcrypt/旧sha256/全新库三分支（仅后两者缺达标密码 fatal）、暴露默认密码检测、改密 tv+1 使旧 JWT 立即失效；新建 adminLoginGuard（5 次失败锁 15 分钟，按用户名+IP）；/login 全链路（no-store、严格入参、Turnstile admin_login、限速 10/min、失败审计），新增 POST /me/password；中间件强制改密门（仅放行 GET /me 与 POST /me/password，否则 403 PASSWORD_CHANGE_REQUIRED）；前端 LoginPage 删除默认密码提示并接入 Turnstile、新建 ForceChangePassword、AdminApp 接入强制改密流程；nginx 新增 CSP 等 6 个安全头；api.md/.env.example/.env 同步；admin.test.ts 新增 10 用例，全套件 206 通过；待 CF Access 闸门验证后再置开关 on [push-deferred] | backend/src/{db.ts,server.ts}, backend/src/services/{adminService,adminLoginGuard,verificationService}.ts, backend/src/routes/admin.ts, backend/src/middleware/adminAuth.ts, src/admin/{LoginPage,ForceChangePassword,AdminApp,api,types}.tsx, /etc/nginx/sites-available/tlrphotos, backend/docs/api.md, backend/.env.example |
| 2026-09-30 20:17 | [release] 版本号升级至 V1.12.0 — 邮件验证码通道由 Spug 切换为阿里云 DirectMail SMTP | backend, 全项目 |
| 2026-09-30 20:17 | [feat] 邮件发送改用阿里云 DirectMail SMTP：新建 aliMailService（nodemailer 连接 smtpdm.aliyun.com:465 SSL，发信地址 main@mail.tlrphotos.com，传输器惰性单例+配置变更自动重建，15s 连接/ greeting/套接字超时，发件人名支持中文 RFC 2047 自动编码，HTML+纯文本双正文 teal 配色，未配置/占位密码 503、认证失败/超时 502 统一脱敏）；auth.ts 改为 sendSmsCode 走 spugService、sendMailCode 走 aliMailService（联合 OtpServiceError 类型），spugService 收敛为短信专用并移除 sendMailCode；.env/.env.example 新增 ALIYUN_SMTP_* 五项、api.md 配置依赖同步；4 个集成测试套件 mock 拆分适配（otp.test 503 用例改指 aliMailService）；196 测试全部通过，SMTP verify 认证成功，服务已重启 (V1.12.0) | backend/src/services/{aliMailService,spugService}.ts, backend/src/routes/auth.ts, backend/.env.example, backend/docs/api.md, backend/tests/integration/{otp,auth,verification,everos}.test.ts, package.json, .trae/rules/版本管理规则.md |
| 2026-09-30 19:15 | [fix] 修复个人资料页更改手机号未绑定账号：提交资料时检测手机号变更，其余字段正常保存、新手机号从直存数据中剥离；立即弹出验证码换绑弹窗，Turnstile 通过后自动向新号发送验证码（60s 重发倒计时、10 分钟有效、冲突/错误提示），输入正确验证码确认后调用换绑接口完成绑定并刷新用户信息，取消则恢复原号码；拒绝直接清空手机号 (V1.11.2) | src/features/profile/ProfilePage.tsx, package.json, .trae/rules/版本管理规则.md |
| 2026-09-30 19:03 | [fix] 修复编辑资料输入框每输入一个字符即失焦：根因是 FieldRow 定义在 ProfilePage 组件体内，每次按键触发渲染都产生新组件类型导致输入框重挂载；将 FieldRow 提取到模块作用域（组件类型稳定），同时按全站浅色规范移除其 dark 分支 (V1.11.1) | src/features/profile/ProfilePage.tsx |
| 2026-09-26 23:35 | [release] 版本号升级至 V1.11.0 — 登录验证码（OTP）体系正式发布（Spug 短信/邮件通道、两段式登录、验证码注册、手机号绑定 + 完整测试套件）[push-deferred] | 全项目 |
| 2026-09-26 23:35 | [test] 登录验证码测试套件（spec Task 6）：新增 tests/unit/otpService.test.ts 14 用例（generateCode 6位/hashCode 确定性/createCodeRecord 作废旧码/verifyCode 通过一次性消费+MISMATCH递增+5次LOCKED+EXPIRED/cleanupExpiredCodes 7天清理/maskTarget 脱敏）与 tests/integration/otp.test.ts 20 用例（otp/send 邮箱+手机号成功、login 未注册 404×2、register 已存在 409、bind_phone 未登录 401、模板未配置 503+死码作废、60s 冷却 429（RATE_LIMIT_ENABLED=1+resetModules 独立限速应用）；两段式 login 返回 otp_required+login_ticket+channels 不签发 JWT、密码错误 401；login/verify 成功签发/MISMATCH/5次LOCKED/EXPIRED/无效 ticket 401；验证码注册邮箱+手机号（email=NULL+phone_verified=1+缺省用户名）、重复注册 409；phone/bind 成功+冲突 409）；Spug 通道 vi.mock 捕获明文码不触网、Turnstile 打桩放行；兼容改造 auth.test.ts（注册携带验证码+响应结构 data.user）、verification.test.ts（注册取码+gate 用例补 code+清理验证状态前置）、everos.test.ts（注册取码）；全套件 196 用例通过 (V1.11.0) [push-deferred] | backend/tests/unit/otpService.test.ts, backend/tests/integration/{otp,auth,verification,everos}.test.ts, package.json, .trae/rules/版本管理规则.md |
| 2026-09-26 23:23 | [feat] 前端登录验证码功能（spec Task 5）：api/auth.ts 新增 sendOtp/verifyLogin/bindPhone，login 改两段式联合返回（LoginOtpResponse \| LoginSuccessResponse）、register 改验证码注册（identifier+code），User 新增 phone/phone_verified；UserContext login 返回 LoginFlowResult（success/otp_required/phone_not_registered）、新增 verifyLogin、注册成功即登录（persistAuth 后异步补全完整资料）；AuthPage 改造：注册表单 identifier+密码+确认密码+可选用户名+验证码+60s 倒计时发送+Turnstile，登录第一段密码校验后 otp_required 进第二段（通道选择仅一个时隐藏、目标未知通道禁选、进入自动发码、60s 重发、返回修改密码）、404 PHONE_NOT_REGISTERED 显示引导文案+去注册预填手机号；ProfilePage 账户安全区新增绑定手机号卡片（已绑定脱敏展示/未绑定输入+验证码+Turnstile+60s 倒计时+绑定成功 refreshUser），账户信息行新增手机号状态；lint 0 错误、build 通过 [override] 用户明确要求不改版本号，V1.11.0 留待功能全部落地后统一发布 [push-deferred] | src/api/auth.ts, src/shared/UserContext.tsx, src/features/auth/AuthPage.tsx, src/features/profile/ProfilePage.tsx |
| 2026-09-26 23:03 | [feat] 登录验证码后端路由改造（spec Task 3）：新增 POST /otp/send（三层限速：target 60s 冷却 + target 每小时 5 次 + IP 每小时 20 次，login/register/bind_phone 三场景，Turnstile 校验，发送失败作废记录）、POST /login/verify（10 次/分/IP，login_ticket HMAC 签名+过期+IP 校验，verifyCode 后签发 JWT+会话）、POST /phone/bind（登录态，查重+验证码后写 phone/phone_verified=1）；/login 改两段式（identifier 自动识别邮箱/手机号，密码通过仅返回 login_ticket+channels 不签发 JWT，测试环境 TEST_BYPASS_TOKEN 兼容旧行为），/register 改验证码注册（手机号注册 email=NULL+phone_verified=1+缺省用户名，成功即签发 JWT）；authService 新增 detectIdentifier/findUserByIdentifier/verifyPasswordOnly/issueLoginResult 并适配 email 可空；tsc 编译通过 [push-deferred] | backend/src/routes/auth.ts, backend/src/services/authService.ts |
| 2026-09-26 22:51 | [feat] 登录验证码服务层（spec Task 2）：新建 spugService（push.spug.cc 短信/邮件模板发送，15s AbortController 超时，未配置模板抛 503 OTP_SERVICE_NOT_CONFIGURED，发送失败/网络异常统一 502 脱敏提示）与 otpService（6 位码生成、HMAC-SHA256 哈希入库 verification_codes 表、timingSafeEqual 恒时校验、5 次错误作废锁定、10 分钟有效、每日清理 7 天前记录、maskTarget 日志脱敏）；server.ts 每日清理任务挂载 cleanupExpiredCodes [push-deferred] | backend/src/services/spugService.ts, backend/src/services/otpService.ts, backend/src/server.ts |
| 2026-09-26 21:45 | [feat] 新增「我的作品」独立页面：新建 /my-works 路由与 MyWorksPage 组件（复用 getMyPhotos 接口展示全状态照片 + 顶部状态筛选 + rejected 卡片驳回理由 + 未登录引导 + 点击跳详情）；修复 Header 头像下拉「我的作品」误跳 /gallery、ProfilePage 仪表盘快捷按钮误跳公开主页，均改为 /my-works (V1.10.3) | src/features/profile/MyWorksPage.tsx, src/App.tsx, src/shared/Header.tsx, src/features/profile/ProfilePage.tsx |
| 2026-09-26 21:28 | [docs] 同步版本管理规则文件：补齐 V1.8.1~V1.10.1 共 7 条缺失版本历史、更新当前版本标识至 V1.10.1 基线，并在 3.2 更新位置中将该文件纳入每次版本发布的强制同步范围 (V1.10.2) | .trae/rules/版本管理规则.md, package.json |
| 2026-09-24 19:58 | [release] 版本号升级至 V1.10.1 — 修复扫描确认的6项安全漏洞（HTTP走私/未授权上传/错误泄露/CORS） | 全项目 |
| 2026-09-24 19:58 | [fix] 安全漏洞修复：(1) ID:2 HTTP Desync — nginx 新增 conf.d/desync.conf map（仅空/精确chunked合法，重复TE逗号合并值判非法）+ snippets/smuggling-guard.conf（非法TE 400、CL+TE共存 400），两个 vhost 引入并 nginx -t reload；双TE探针源站/经CF均400单响应，合法chunked透传正常；(2) ID:4 未授权上传 — 新增 requireAuth 中间件，/upload 路由链改为认证+can_upload前置→multer，匿名 401 不再进入解析缓冲；(3) ID:5 错误泄露 — login/register 严格入口类型校验（string/长度254/200）+ 全局 errorHandler 脱敏（SQLITE_*/errno/SQL片段不落客户端）+ app.disable(x-powered-by) 与 nginx proxy_hide_header；(4) ID:3/6/7 — CORS 由 * 收紧白名单（corsWhitelist，CORS_ALLOWED_ORIGINS env，方法仅GET/POST/PUT/DELETE），公开读取限速120/min、认证口10/min（无依赖内存固定窗口）；新增20个回归用例（类型9+上传3+CORS5+限速3），162项全部通过；修复报告见 backend/docs/security-fix-2026-09-24.md，api.md 新增安全约束章节 (V1.10.1) | backend/src/middleware/*, backend/src/server.ts, backend/src/routes/auth.ts, backend/src/routes/photos.ts, backend/docs/*, /etc/nginx/ |
| 2026-09-18 20:43 | [release] 版本号升级至 V1.10.0 — Hallmark 全站去紫色改 teal 松针青绿 | 全项目 |
| 2026-09-18 20:43 | [refactor] Hallmark 前端配色重设计（仅色值，不动布局/功能）：(1) 全量替换 purple-* Tailwind 类 116 处/17 文件 → teal 同色阶（text/bg/border/ring/from 渐变），全局 CSS 变量 --accent #aa3bff→#0d9488、暗色 #c084fc→#2dd4bf 及 accent-bg/accent-border rgba，审核网格 SVG 描边同步；(2) 对比度 WCAG AA 修正 — teal-600 小字仅 3.78:1 故文字映射升 teal-700（4.7:1），焦点环/边框升 teal-600（3.8:1），按钮白字 5.6:1；(3) 响应式修复 — TurnstileWidget 新增 size 响应（≤360px 自动 compact 130×120 解决 /auth 320px 下 300px widget 溢出 29px，resize rAF 切换重渲染）；(4) Playwright 实测：桌面 1440 四页（首页/auth/admin/gallery）紫色计算样式扫描 0 残留，375/320 无横向滚动 scrollWidth=视口、输入框不溢出；index.css 盖 Hallmark 印章 + .hallmark/log.json；lint 0 error、build 通过 (V1.10.0) | src/index.css, src/components/TurnstileWidget.tsx, src/features/*, src/admin/*, src/shared/*, .hallmark/log.json |
| 2026-09-18 20:03 | [release] 版本号升级至 V1.9.0 — 集成 EverOS AI Agent 持久化记忆层 | 全项目 |
| 2026-09-18 20:03 | [feat] EverOS 记忆层集成：(1) 后端新增 everosService — 基于 EverOS v2 HTTP API（add/search，Bearer 鉴权，15s AbortController 超时，JSON 信封解析，错误状态码透传），EVEROS_API_KEY 动态读取 env（未配置 503），EVEROS_PROJECT_ID 默认 tlrphotos 记忆空间隔离，时间戳 unix 毫秒自动生成，助手轮次固定 sender_id=tlrphotos_assistant；(2) 新增 /api/everos/memory（写入，登录+参数校验 content≤10000/session_id≤128/role 白名单）与 /api/everos/search（检索，method 四种/top_k 1–100/include_profile），JWT 用户隔离，loadAuthUser 统一鉴权含 banned_at 检查；server.ts 挂载；(3) 配置 .env（gitignored）写真实密钥 + .env.example 占位；(4) 新增 everos.test.ts 11 用例（mock fetch：503/401/参数契约/毫秒时间戳/响应映射/错误透传），全套件 142 通过；真实 API 双链路烟测成功（Python HTTP 与 Node 服务均写入→10s 内搜索命中，隔离 project_id=tlrphotos_integration）；(5) api.md 新增 EverOS 章节 (V1.9.0) | backend/src/services/everosService.ts, backend/src/routes/everos.ts, backend/src/server.ts, backend/.env.example, backend/tests/integration/everos.test.ts, backend/docs/api.md |
| 2026-09-12 14:21 | [docs] 新增 PlantUML 详细版架构图：docs/architecture-detailed.puml（扫描全代码库后绘制 — 用户层 16 页面组件、Cloudflare 边缘 3 组件、Nginx 双 vhost、应用层 62 API/7 服务/4 中间件/3 工具/3 定时任务、数据层 13 张表、外部 OSS+Turnstile API）+ architecture-detailed.png 渲染（4096×1685，标注每路由组接口数与关键方法） (V1.8.4) | docs/architecture-detailed.puml, docs/architecture-detailed.png |
| 2026-09-12 13:59 | [docs] 新增 PlantUML 版中文系统架构图：docs/architecture.puml 源文件（package 分组六层架构 — 用户/Cloudflare 边缘/接入 Nginx/应用 REST API+服务层/数据/外部服务，本地 plantuml.jar 渲染，database/cloud 形状在 rectangle 包内嵌套报错改用 rectangle + skinparam 配色）+ architecture-plantuml.png 渲染（1552×1102，headless 模式 + Noto Sans CJK SC），与 drawio/Mermaid 版图例一致 (V1.8.3) | docs/architecture.puml, docs/architecture-plantuml.png |
| 2026-09-12 11:23 | [docs] 新增 Mermaid 版中文系统架构图：docs/architecture.mmd 源文件（flowchart TB 六层 subgraph — 用户/Cloudflare 边缘/接入 Nginx/应用 REST API+服务层/数据/外部服务，复核 server.ts 七组 /api 路由挂载）+ architecture-mermaid.png 渲染（mermaid-cli 11.17.0 + puppeteer --no-sandbox + Noto Sans CJK SC），配色与 drawio 版图例一致 (V1.8.2) | docs/architecture.mmd, docs/architecture-mermaid.png |
| 2026-09-11 21:01 | [docs] 新增系统架构图：docs/architecture.drawio 中文源文件（六层架构 — 用户层/Cloudflare 边缘层/接入层 Nginx/应用层 Express 后端/数据层 SQLite/OSS 与 Turnstile 外部服务，37 节点 15 连线）+ architecture.png 2000px 导出（xvfb-run 虚拟桌面 + Noto Sans CJK SC 字体解决无头环境中文渲染） (V1.8.1) | docs/architecture.drawio, docs/architecture.png |
| 2026-09-05 19:34 | [release] 版本号升级至 V1.8.0 — 全站高危操作接入 Cloudflare Turnstile 人机验证机制 | 全项目 |
| 2026-09-05 19:34 | [feat] 后端人机验证：db.ts 新增 user_verifications 表（subject_type/subject_id/ip/action/verified_at/expires_at，168h TTL + IP 绑定）；verificationService 实现 canonical siteverify（success+action+hostname 白名单，fail-closed）+ 验证状态 CRUD + 登出清除 + 测试绕过（仅 NODE_ENV=test 且 tokens=TEST_BYPASS_TOKEN）；验证门覆盖注册/登录/资料修改/改密/头像/上传三接口/删除照片/管理员封禁+解封+权限变更；新增 /api/verification/verify+status、/api/admin/verification/verify+status；server.ts 挂载路由+每日清理过期记录；.env.example 补 TURNSTILE_SECRET/TURNSTILE_HOSTNAMES (V1.8.0) | backend/src/{db.ts,services/verificationService.ts,routes/{auth,photos,admin,verification}.ts,server.ts}, backend/.env.example |
| 2026-09-05 19:34 | [feat] 前端人机验证集成：TurnstileWidget 显式渲染组件（脚本单例注入、令牌一次性 reset、StrictMode 保护、sitekey 取 VITE_TURNSTILE_SITE_KEY）+ HumanVerificationModal 验证门弹窗（白底黑字、挑战通过自动提交）+ useHumanVerification guard Hook（403 HUMAN_VERIFICATION_REQUIRED → 弹窗 → 验证 → 自动重试原操作）；AuthPage 登录/注册内嵌挑战并随表单提交令牌，ProfilePage（头像/资料/改密）、UploadPage（上传）、PhotoDetailPage（删除）、AdminUsersPage（封禁/解封/权限，走管理员验证接口）接入验证门；client.ts ApiResponse 与 auth.ts/photos.ts 原生 fetch 透传业务 code；.env.example 补 VITE_TURNSTILE_SITE_KEY (V1.8.0) | src/components/{TurnstileWidget,HumanVerificationModal}.tsx, src/shared/useHumanVerification.tsx, src/api/{verification,client,auth,photos}.ts, src/features/auth/AuthPage.tsx, src/features/profile/ProfilePage.tsx, src/features/upload/UploadPage.tsx, src/features/gallery/PhotoDetailPage.tsx, src/admin/{api,UsersPage}.tsx, src/shared/UserContext.tsx, .env.example |
| 2026-09-05 19:34 | [docs] api.md 新增"人机验证 (V1.8.0)"章节：机制说明（fail-closed/168h/IP 绑定/登出失效/测试绕过）+ 12 项高危端点清单 + 4 个验证接口契约 + 403 拦截响应示例；注册/登录小节补充 turnstile_token 参数与验证门说明；新增 verification.test.ts 10 用例（fail-closed 拦截/测试绕过/状态生命周期）+ auth/photos/admin 三套件 tokens 注入改造，131 用例全部通过 (V1.8.0) | backend/docs/api.md, backend/tests/integration/*.test.ts |
| 2026-08-31 22:12 | [fix] 定位登录 405 真正根因：Cloudflare Pages 项目绑定了 tlrphotos.com/www 自定义域，在边缘层接管全部流量（GET 全返 SPA 的 index.html、POST 一律 405 空体），公网请求从未到达源站（nginx access.log 零记录证实）；V1.7.1 的 /etc/hosts 修复仅对源站内部生效 | Cloudflare Dashboard (Pages/DNS) |
| 2026-08-31 22:12 | [fix] 修复执行：移除 Pages 自定义域绑定（DNS A 记录本已正确指向 47.242.194.32）+ 清边缘缓存；关闭 Bot Fight Mode 与 AI Labyrinth（BFM 不在 Ruleset Engine 内、不可被 Skip 自定义规则跳过，且会误拦真实用户 POST）。验证全通过：POST /api/auth/login 返 400/401 业务 JSON、GET /api/photos 返真数据（cf-cache-status: DYNAMIC）、bundle index-BQJ4Zk6S.js 与本地 dist 一致、nginx access.log 恢复公网流量；无仓库代码变更，不升级版本号 | Cloudflare Dashboard (Pages/Security) |
| 2026-08-25 20:24 | [release] 版本号升级至 V1.7.1 — 修复间歇性"服务器未返回响应"登录失败 | 全项目 |
| 2026-08-25 20:24 | [fix] 根因修复：/etc/hosts 错误将 127.0.1.1 映射为 localhost（应为 hostname），导致 Nginx 解析 localhost 偶发返回 127.0.1.1；后端仅监听 127.0.0.1:3001，连 127.0.1.1:3001 时被拒（111 Connection refused）→ Nginx 返 502/空响应 → 前端"服务器未返回响应"；删除该错误行 (V1.7.1) | /etc/hosts |
| 2026-08-25 20:24 | [fix] 防御性修复：tlrphotos + tlrphotos-admin 两站点 5 处 proxy_pass 由 http://localhost:3001 改为 http://127.0.0.1:3001，避免 DNS 歧义（已备份 .bak.202608251940）；nginx -t 通过 + reload 生效 (V1.7.1) | /etc/nginx/sites-available/tlrphotos, /etc/nginx/sites-available/tlrphotos-admin |
| 2026-08-25 20:24 | [fix] 前端登录错误提示增强：auth.ts login/refresh 增加 AbortController 超时控制（登录 30s/刷新 15s）+ 区分 5xx（"服务器暂时不可用"）/ 2xx 空响应（"服务器未返回数据"）/ 网络错误（"请检查网络连接后重试"）/ 超时（"请求超时"），移除笼统的"服务器未返回响应"；client.ts request 同步增强 5xx 与空响应提示 (V1.7.1) | src/api/auth.ts, src/api/client.ts |
| 2026-08-25 22:30 | [release] 版本号升级至 V1.7.0 — 管理后台用户管理增强：账号封禁 + 精细化功能权限控制 | 全项目 |
| 2026-08-25 22:30 | [feat] 账号封禁功能：users 表新增 banned_at 字段；admin 新增 POST /users/:id/ban、POST /users/:id/unban 接口；封禁时 deleteUserSessions 强制下线 + loadAuthUser 在所有需鉴权接口检查 banned_at 使现有 JWT 立即失效（401 USER_BANNED）；被封禁用户重新登录收到"该账号已被封禁"提示无法登录 (V1.7.0) | backend/src/db.ts, backend/src/services/authService.ts, backend/src/routes/admin.ts, backend/src/routes/photos.ts |
| 2026-08-25 22:30 | [feat] 精细化功能权限控制：users 表新增 can_upload/can_view/can_download/can_like 字段（1=允许，0=禁止）；admin 新增 PUT /users/:id/permissions 接口记录每项 from→to 变更审计日志；照片接口注入权限检查 — 上传/预签名/完成上传检查 can_upload、详情/代理检查 can_view、下载检查 can_download、点赞检查 can_like（均返回 403 PERMISSION_DENIED）；匿名访客仍可公开浏览已审核照片与代理图（V1.7.0） | backend/src/db.ts, backend/src/routes/admin.ts, backend/src/routes/photos.ts, src/admin/UsersPage.tsx, src/admin/api.ts, src/admin/types.ts |
| 2026-08-25 22:30 | [fix] 修复 /users/list 路由被 /users/:id 抢先匹配返回"管理员不存在"（与 V1.5.0 /photos/stats 同类路由顺序 bug）；/upload/presigned 和 /upload/complete 从内联 jwt.verify 改为 loadAuthUser 统一认证 + can_upload 权限检查 (V1.7.0) | backend/src/routes/admin.ts, backend/src/routes/photos.ts |
| 2026-08-25 22:30 | [docs] API 文档同步：新增管理后台用户管理接口契约（users/list、toggle、ban、unban、permissions）；登录接口补充封禁检查说明；照片上传/详情/代理/点赞接口补充 V1.7.0 权限检查行为说明 (V1.7.0) | backend/docs/api.md |
| 2026-08-25 22:30 | [test] 新增 10 个集成用例：封禁后 token 调用点赞/详情返回 401 USER_BANNED、解封后可正常访问、禁用 can_upload/can_like/can_view/can_download 返回 403 PERMISSION_DENIED、匿名 download=1 需登录 401、权限全开可正常操作 — 全部 121 用例通过 (V1.7.0) | backend/tests/integration/photos.test.ts |
| 2026-08-25 13:20 | [fix] 下载按钮视觉强化：浅色半透明背景改为实色 bg-blue-600 白字 + py-4 加高 + text-base font-bold 加粗 + shadow-md 阴影 + hover:scale-[1.03]/shadow-lg + active:scale-95 按压反馈 + Download 图标放大至 w-6 h-6/strokeWidth 2.5 (V1.6.1) | src/features/gallery/PhotoDetailPage.tsx |
| 2026-08-25 13:10 | [release] 版本号升级至 V1.6.0 — 照片详情页新增带水印原图下载功能 | 全项目 |
| 2026-08-25 13:10 | [feat] 照片详情页新增独立下载按钮：后端图片代理路由 /api/photos/image/* 支持 ?download=1 参数，设置 Content-Disposition: attachment + RFC 5987 UTF-8 中文文件名（按照片标题命名）；前端 PhotoDetailPage 加 Download 图标按钮，已审核公开照片走浏览器原生导航下载（同源+attachment，流式直存磁盘最快），未审核照片所有者带 token fetch blob 下载；无水印图时回退下载原图并标注；防连点 + 失败提示 | backend/src/routes/photos.ts, src/features/gallery/PhotoDetailPage.tsx |
| 2026-08-25 12:55 | [fix] 修复测试数据污染生产库导致用户量虚高：db.ts dbPath 支持 DB_PATH 环境变量覆盖（原硬编码指向生产 database.db）；auth.test.ts 真正赋值 testDbPath 给环境变量（原只算没用）；admin.test.ts/photos.test.ts 补测试库隔离；seedMockData 标记前 10 张演示照片为 approved（原全 pending 导致切测试库后取不到 approved fixture）；清理生产库 75 条 @example.com 测试垃圾用户（90→15）(V1.5.1) | backend/src/db.ts, backend/tests/integration/*.test.ts, backend/data/database.db (未追踪) |
| 2026-08-25 12:55 | [fix] 部署仪表盘路由顺序修复至运行服务：rebuild backend dist + restart tlrphotos-backend.service（原进程自 8/16 未重启运行旧代码，/photos/stats 被 /photos/:id 抢先匹配返回 404 照片不存在）；验证三个端点 200 + 数据准确（stats total=60=16+34+10，userCount=15，health healthy=true）(V1.5.1) | backend/dist/**, tlrphotos-backend.service |
| 2026-08-25 12:40 | [release] 版本号升级至 V1.5.0 — 匿名数据清理 + 上传强制登录 + 仪表盘修复 + 监控告警 | 全项目 |
| 2026-08-25 12:40 | [fix] 修复审核统计接口 404：`/photos/stats` 路由注册在 `/photos/:id` 之后导致 "stats" 被当作 :id 匹配进详情路由，调整为注册在前并加注释说明顺序约束 | backend/src/routes/admin.ts |
| 2026-08-25 12:40 | [feat] 上传接口强制登录：/upload、/upload/presigned、/upload/complete 三接口前置 JWT 校验，从 token 解析 userId 写入 photos.user_id，杜绝匿名上传落库 NULL；缺少参数返回 400（先认证后参数校验） | backend/src/routes/photos.ts, backend/tests/integration/photos.test.ts |
| 2026-08-25 12:40 | [feat] 仪表盘数据显示修复：统计查询 try/catch 错误隔离替代 Promise.allSettled 类型问题；分区数据过滤（zone_auditor/zone_master 仅本 zone）；total 字段显式 = pending+approved+rejected 修复运算符优先级歧义；GET /api/admin/dashboard/health 健康检查接口检测匿名照片/孤儿记录；前端 DashboardPage 加错误处理 + 重试按钮 + 分区提示 + 告警条 | backend/src/routes/admin.ts, src/admin/DashboardPage.tsx |
| 2026-08-25 12:40 | [chore] 匿名数据清理：删除 50 条 user_id IS NULL 匿名照片记录 + 关联 photo_likes/photo_views 级联清理；新增 check-data-consistency.ts 巡检脚本（孤儿记录/异常状态检查），清理 3 条 photo_views 孤儿记录 | backend/src/scripts/check-data-consistency.ts, backend/data/database.db (未追踪) |
| 2026-08-25 12:40 | [test] 新增 6 个集成用例：stats 路由 total 计算、zone 过滤 zoneName、健康检查 healthy/issues、匿名照片告警、上传未登录 401、缺 key 参数 400（带 token） | backend/tests/integration/admin.test.ts, backend/tests/integration/photos.test.ts |
| 2026-08-25 12:40 | [docs] API 文档同步：上传接口需登录说明、统计接口 zone 过滤与 zoneName 字段、健康检查接口契约 | backend/docs/api.md |
| 2026-08-25 08:50 | [release] 版本号升级至 V1.4.0 — 图片统计系统优化与点赞交互增强 | 全项目 |
| 2026-08-25 08:50 | [feat] 浏览次数 24h 去重统计：登录按 user_id + 未登录按 client IP，新增 photo_views 表 (photo_id, viewer_key, last_viewed_at) + recordViewIfEligible 事务 helper + X-Forwarded-For 首段 IP 提取 + 每小时清理 7 天前旧记录 | backend/src/db.ts, backend/src/routes/photos.ts |
| 2026-08-25 08:50 | [feat] 点赞交互改造：后端强制 JWT 登录（去 req.body.userId anonymous 共用 bug）+ 详情接口返回 is_liked 字段；前端 lucide-react Heart 图标红色填充切换 + 乐观更新 + 失败回滚 + 未登录引导按钮 | backend/src/routes/photos.ts, src/features/gallery/PhotoDetailPage.tsx, src/api/photos.ts, src/features/gallery/types.ts |
| 2026-08-25 08:50 | [fix] API 文档同步契约：is_liked 字段说明、点赞需登录与 401 code:AUTH_REQUIRED、浏览去重机制段落 | backend/docs/api.md |
| 2026-08-25 08:50 | [test] 新增 8 个集成用例：IP/user_id 去重、24h 窗口、强制登录、幂等、100 并发点赞一致性 | backend/tests/integration/photos.test.ts |
| 2026-08-24 21:45 | [fix] 水印尺寸与位置所见即所得：修复上传界面 watermarkSize/watermarkX/Y 与后端 sharp 合成结果比例/坐标不一致 — 新增 measureRenderedImage() 用 naturalWidth*minRatio 推导 object-contain 后图像真实矩形（drawnW/drawnH/drawnLeft/drawnTop），预览 fontSize = watermarkSize * max(drawnW, drawnH)/1200（与后端 scaleFactor 公式 1:1 同源），水印定位相对真实图像矩形百分比而非容器百分比；字号控件显示「基准 1200px → 预览 X px」；描边 WebkitTextStroke 与后端 SVG stroke 对齐。同步更新 api.md 4 个 watermark 字段单位说明 (V1.3.5) | src/features/upload/UploadPage.tsx, backend/docs/api.md |
| 2026-08-24 21:14 | [chore] 插入最高管理员账户 星空联盟 到 backend/data/database.db（role=super zone=default，邮箱 19876113516@163.com，bcrypt cost=10；createAdminUser 唯一性校验通过；adminLogin 闭环验证 token 签发成功、角色正确）；一次性脚本用完即删不留痕 | backend/data/database.db (未追踪的运行时数据) |
| 2026-08-24 20:08 | [chore] 插入最高管理员账户 y 到 backend/data/database.db（role=super zone=default，邮箱 Yang16368@outlook.com，bcrypt cost=10；createAdminUser 唯一性校验通过；adminLogin 闭环验证 token 签发成功、角色正确）；create-admin-y.ts 脚本用完即删不留痕 | backend/data/database.db (未追踪的运行时数据) |
| 2026-08-24 20:00 | [fix] 修复工具面板拖动位置突变漂移：弃用 getBoundingClientRect 含 border-box 的坐标系与 CSS left/top padding-box 参考系混用导致的 (parentRect.left - borderLeft) 恒定偏移；改为纯屏幕 delta 模式 — mousedown 记录 (clientX/Y + panel.offsetLeft/Top DOM 快照)，mousemove 直接 delta 叠加（零坐标换算）；transition 从 className+inline 冲突改为统一 inline 精确配置（拖拽期间 none，释放后仅 box-shadow 150ms，left/top 0s 跳变）；函数式 setState + 每次从起点重算防批处理闭包陈旧 (V1.3.4) | src/admin/audit-tools/components/ToolPanel.tsx |
| 2026-08-24 19:52 | [fix] 工具面板布局重构：从flex兄弟布局改为position:absolute浮动窗口，不占用图片空间避免图片被压缩裁剪；工具面板初始位置放置在图片展示区外围（优先右侧其次左侧）；支持标题栏自由拖动（40px句柄可见边界约束）；拖拽监听改为window级保证拖出面板仍可捕获；root容器改为overflow-visible面板可跨出边界；切换工具时key重挂载重置初始位置；ResizeObserver动态重算位置 (V1.3.3) | src/admin/audit-tools/AuditToolkit.tsx, src/admin/audit-tools/components/ToolPanel.tsx, src/admin/audit-tools/tools/{HistogramTool,ContrastTool,SaturationTool,SharpnessTool,ColorTempTool}.tsx |
| 2026-08-23 22:31 | [fix] 图片滚轮缩放交互优化：原生wheel监听器passive:false确保preventDefault跨浏览器生效（修复React onWheel passive导致页面滚动未被禁止）；鼠标悬停图片区域内滚轮仅缩放不滚页面、离开后恢复默认滚动；deltaMode标准化(Firefox lines→pixels)；基于deltaY指数缩放(exp)适配鼠标/触控板；rAF批处理合并同帧多次滚轮事件(delta累加)防卡顿；缩放中心跟随鼠标指针；缩放指示器徽章(百分比+渐隐)；will-change:transform+0.08s过渡 (V1.3.2) | src/admin/audit-tools/tools/ZoomTool.tsx |
| 2026-08-23 22:22 | [fix] 审核工具集交互体验优化：快捷键常驻显示（工具栏按钮+提示条）；叠加层移入变换层随图片同步移动（修复拖拽时叠加层被置顶）；直方图颜色提亮(alpha 0.4→0.75)+新增黑白曝光直方图(BT.601亮度)；面板改为flex兄弟布局不遮挡图片；拖拽行为修复(draggable=false+onDragStart拦截+select-none+mousedown preventDefault) (V1.3.1) | src/admin/audit-tools/AuditToolkit.tsx, src/admin/audit-tools/tools/ZoomTool.tsx, src/admin/audit-tools/tools/HistogramTool.tsx, src/admin/audit-tools/components/ToolPanel.tsx, src/admin/audit-tools/components/AuditToolbar.tsx, src/admin/audit-tools/components/CanvasOverlay.tsx, src/admin/audit-tools/hooks/useImagePixels.ts, src/admin/audit-tools/types.ts |
| 2026-08-23 22:05 | [release] 版本号升级至 V1.3.0 — 新增审核员图像分析工具集 | 全项目 |
| 2026-08-23 22:05 | [feat] 新增审核员图像分析工具集（9项工具）：曝光度三色直方图、九宫格+对角线辅助线、脏污点智能检测、对比度量化、无极缩放(0.1x-8x)+拖拽平移、饱和度分析、锐度评估(Laplacian方差)、色温分析、高光/暗部溢出警告；快捷键操作(h/g/d/b/c/z/s/r/t/l/~/?/esc/0/+/-)；useImagePixels降采样至800px长边保证<200ms响应；集成至PhotoDetailPage替换原图片渲染 (V1.3.0) | src/admin/audit-tools/**, src/admin/PhotoDetailPage.tsx |
| 2026-08-16 21:45 | [config] 服务器端口安全加固：后端服务从0.0.0.0:3001改为仅监听127.0.0.1:3001（外部经Nginx反代访问，避免API直接暴露公网绕过Cloudflare Zero Trust）；systemd service 启动参数加--expose-gc以激活MemoryManager的GC能力；关闭并mask snapd.socket/snapd.service/snap.lxd.daemon（0容器、纯浪费资源） (V1.2.4) | backend/src/server.ts, /etc/systemd/system/tlrphotos-backend.service |
| 2026-08-16 14:45 | [feat] 服务器内存自动释放机制：新增MemoryManager单例，30s采样RSS，60%/75%/90%触发soft/medium/hard分级清理（registerBuffer+disposeProcessedBuffers、sharp缓存重置+vips.shutdown、5min3次medium或90%触发SIGTERM自重启）；上传路由接入registerBuffer+finally；processImage内部finally destroy所有sharp实例+disposeProcessedBuffers；暴露/api/admin/memory/snapshot与POST /release（管理员鉴权）；启动方式需--expose-gc (V1.2.3) | backend/src/services/memoryManager.ts, backend/src/server.ts, backend/src/routes/photos.ts, backend/src/services/imageService.ts |
| 2026-08-16 13:45 | [fix] 修复管理后台无法查看未审核图片：CachedImage在传入authToken时因useCache=false绕过fetch路径，导致Authorization头未传递；改用shouldFetch=cacheEnabled||!!authToken强制fetch；用户前台PhotoDetailPage和ProfilePage传入用户token使所有者可查看自己的未审核照片 (V1.2.2) | src/components/CachedImage.tsx, src/features/gallery/PhotoDetailPage.tsx, src/features/profile/ProfilePage.tsx |
| 2026-08-16 13:30 | [fix] 移除所有页面中的飞行高度/海拔(altitude)标签：PhotoDetailPage(用户/管理)、types(PhotoDetail/AdminPhotoDetail)、UploadPage(ExifData海拔输入框/解析)、CachedImage、mockData、api.md文档；后端photo返回对象显式delete altitude (V1.2.1) | src/features/gallery/PhotoDetailPage.tsx, src/features/gallery/types.ts, src/features/gallery/mockData.ts, src/features/upload/UploadPage.tsx, src/api/photos.ts, src/admin/PhotoDetailPage.tsx, src/admin/types.ts, backend/src/routes/photos.ts, backend/src/routes/auth.ts, backend/src/routes/admin.ts, backend/docs/api.md |
| 2026-08-16 13:24 | [release] 版本号升级至 V1.2.0 — 分区化作品集与审核权限控制 | 全项目 |
| 2026-08-16 13:24 | [feat] 实现分区化作品集与审核权限控制：上传接口校验category必填；admin路由对zone_master增加分区过滤；新增GET /api/admin/zones分区列表接口；AdminsPage分区下拉选择与zone_master创建zone_auditor权限继承；管理后台非负责分区显示占位提示；画廊页重构为分区标签页+标签选择侧边栏（提取TagSelector可复用组件）；后端搜索/列表接口支持category过滤 (V1.2.0) | backend/src/routes/photos.ts, backend/src/routes/admin.ts, backend/docs/api.md, src/admin/api.ts, src/admin/AdminsPage.tsx, src/admin/AdminApp.tsx, src/admin/PhotosPage.tsx, src/admin/PhotoDetailPage.tsx, src/components/TagSelector.tsx, src/features/upload/UploadPage.tsx, src/features/gallery/GalleryPage.tsx, src/api/photos.ts |
| 2026-08-16 12:31 | [release] 版本号升级至 V1.1.0 — 新增基于用户角色的图片差异化访问控制 | 全项目 |
| 2026-08-16 12:31 | [feat] 图片代理路由识别管理员JWT并绕过审核状态检查；前端CachedImage支持authToken/status属性；用户前台未审核图片显示"审核中"占位符；管理后台图片加载携带管理员token；修复admin待审核列表返回原始OSS URL的Bug (V1.1.0) | backend/src/routes/photos.ts, backend/src/routes/admin.ts, src/components/CachedImage.tsx, src/utils/imageCache.ts, src/features/gallery/types.ts, src/features/gallery/PhotoDetailPage.tsx, src/features/profile/ProfilePage.tsx, src/admin/PhotoDetailPage.tsx, src/admin/PhotosPage.tsx |
| 2026-08-16 12:15 | [release] 版本号升级至 V1.0.3 — 修复管理后台登录卡死问题 | 全项目 |
| 2026-08-16 12:15 | [fix] 修复ADMIN_JWT_SECRET为空导致jwt.sign抛异常、/login路由缺少try/catch导致请求挂起 (V1.0.3) | backend/src/services/adminService.ts, backend/src/routes/admin.ts, backend/.env |
| 2026-08-15 15:00 | [release] 版本号升级至 V1.0.2 — 建立完整测试套件，修复分页和加密边界缺陷 | 全项目 |
| 2026-08-15 15:00 | [fix] 修复照片列表API缺少分页、crypto.ts空明文解密失败 (V1.0.2) | backend/src/routes/photos.ts, backend/src/utils/crypto.ts |
| 2026-08-15 15:00 | [feat] 建立完整测试方案：单元测试(url/crypto/tags)、集成测试(auth/photos/admin)、压力测试脚本，共99个测试用例全部通过 | backend/tests/**, backend/package.json |
| 2026-08-15 14:50 | [config] 服务器配置8GB Swap分区，swappiness=10，vfs_cache_pressure=50，开机自动挂载 | /swapfile, /etc/fstab, /etc/sysctl.conf |
| 2026-08-15 14:34 | [release] 版本号升级至 V1.0.1 — 修复后端内存泄漏与资源未释放问题 | 全项目 |
| 2026-08-15 14:34 | [fix] 修复头像上传临时文件未清理、图片代理fetch未abort、上传ID并发冲突、定时器句柄未释放 (V1.0.1) | backend/src/routes/auth.ts, backend/src/routes/photos.ts, backend/src/server.ts |
| 2026-08-15 11:00 | [release] 版本号升级至 V1.0.0 — 项目首个正式发布版本，包含用户系统、管理后台、照片审核工作流、图片缓存、个人设置等核心功能 | 全项目 |
| 2026-08-15 10:30 | [config] 新增版本管理规则文件，规范主/次/修订版本号更新流程 | .trae/rules/版本管理规则.md, package.json |
| 2026-08-15 10:30 | [fix] 恢复context.md被误删的263行内容：从git历史还原项目概述/技术架构/存储策略/API契约/协作原则/已知约束/目录结构/里程碑/历史Changelog等全部章节 | .ai/context.md |
| 2026-08-05 10:20 | [fix] 移除退出登录时多余的navigate调用，改为状态切换即可自动渲染登录页 | src/admin/AdminApp.tsx |
| 2026-08-05 10:15 | [fix] PhotoDetailPage改用props接收照片ID，彻底移除useParams | src/admin/PhotoDetailPage.tsx, src/admin/AdminApp.tsx |
| 2026-08-05 10:05 | [fix] 修复管理后台路由系统：改用URL路径解析照片ID和侧边栏导航 | src/admin/{AdminApp,Layout}.tsx |
| 2026-08-05 09:50 | [refactor] 重构照片审核流程为详情页审核模式 | src/admin/{PhotosPage,PhotoDetailPage,AdminApp}.tsx, src/admin/{api,types}.ts, backend/src/routes/admin.ts |
| 2026-08-04 22:30 | [feat] 实现未审核照片访问控制与驳回理由展示 | backend/src/{routes/photos.ts,routes/admin.ts,routes/auth.ts,utils/url.ts,db.ts}, src/{api/auth.ts,features/profile/ProfilePage.tsx} |
| 2026-08-04 11:58 | [docs] 为 admin 后台 6 个文件添加中文注释 | src/admin/{DashboardPage,PhotosPage,AdminsPage,UsersPage,LogsPage,api}.tsx/ts |
| 2026-08-04 11:30 | [docs] 为前端 25 个页面/组件添加中文注释 | src/features/**, src/shared/**, src/admin/** |

| 2026-07-18 01:30 | [fix] 项目安全审查修复：JWT_SECRET环境变量、bcrypt密码哈希、getProxyUrl工具函数提取、搜索接口LIKE转义、用户照片审核过滤、图片流式传输 | backend/src/routes/photos.ts, backend/src/routes/auth.ts, backend/src/services/adminService.ts, backend/src/utils/url.ts |
| 2026-07-26 18:30 | [fix] 修复密码表单在非密码Tab上错误显示的安全问题：三元运算符else分支改为独立条件渲染 | src/features/profile/ProfilePage.tsx |
| 2026-07-26 18:00 | [feat] 增强个人设置界面：新增偏好设置Tab（浏览偏好、画廊排序、数据加载）和账户安全Tab（账户信息、安全操作、退出登录） | src/features/profile/ProfilePage.tsx, src/utils/preferences.ts |
| 2026-07-26 17:30 | [fix] 修复KaTeX quirks mode警告：doctype改为大写DOCTYPE，添加X-UA-Compatible meta标签 | index.html |
| 2026-07-26 17:00 | [feat] 实现基于IndexedDB的LRU图片本地缓存系统：核心缓存服务、CachedImage组件、缓存管理UI、照片列表预加载 | src/utils/imageCache.ts, src/components/CachedImage.tsx, src/features/gallery/, src/features/profile/ProfilePage.tsx, src/shared/PhotosContext.tsx |
| 2026-07-26 16:15 | [fix] 修复全局JSON解析错误：client.ts中request函数添加空响应和非JSON响应处理，覆盖所有API请求 | src/api/client.ts |
| 2026-07-26 16:00 | [fix] 修复登录接口JSON解析错误：前端login和refresh函数添加空响应和非JSON响应处理，避免Unexpected end of JSON input错误 | src/api/auth.ts |
| 2026-07-26 15:30 | [config] 重新构建前端项目：执行 npm run build 更新 dist/ 构建产物 | dist/ |
| 2026-07-18 00:50 | [fix] 管理后台页面隐藏主站Header：在AppRouterContent中添加条件渲染 | src/App.tsx |
| 2026-07-18 00:45 | [fix] 修复页面加载失败问题：useLocation()在Router组件外部调用导致React渲染错误，重构App组件结构 | src/App.tsx |
| 2026-07-18 00:30 | [fix] 删除管理后台顶部栏和底部版权栏，保留侧边栏退出登录按钮 | src/admin/Layout.tsx, src/App.tsx |
\| 2026-07-18 00:00 | \[config] 更新照片列表接口仅返回已审核照片(status=approved)，管理后台前端组件优化 | backend/src/routes/photos.ts, src/admin/ |
\| 2026-07-16 23:30 | \[feat] 开发管理后台系统：三级权限体系（最高/分区总审核/分区审核）、照片审核工作流、管理员账户管理、用户管理、操作日志、数据统计 | backend/src/db.ts, backend/src/services/adminService.ts, backend/src/middleware/adminAuth.ts, backend/src/routes/admin.ts, backend/src/server.ts, src/admin/ |
\| 2026-07-16 23:15 | \[fix] 修复上传者显示为"匿名用户"问题：在directUpload函数中添加Authorization header传递用户token，后端正确获取并保存user\_id | src/api/photos.ts, src/features/upload/UploadPage.tsx |
\| 2026-07-16 23:00 | \[fix] 修复水印预览与实际生成不一致问题：添加字体大小缩放因子(基于图片实际尺寸与1200px基准的比例)、设置font-weight为600使字体更粗 | backend/src/services/imageService.ts |
\| 2026-07-16 22:45 | \[fix] 修复上传500错误：INSERT语句VALUES占位符数量与列数不匹配（24个问号→25个问号） | backend/src/routes/photos.ts |
\| 2026-07-16 21:00 | \[fix] 修复三级标签下拉框点击消失问题：在select和input元素上添加stopPropagation阻止事件冒泡到父级标签卡片 | src/features/upload/UploadPage.tsx |
\| 2026-07-16 20:00 | \[feat] 上传页面大改版：添加航空/铁路/汽车三大分类、取消强制描述、采用预设标签选择、实现差异化上传模板、添加安全合规声明 | backend/src/db/tagsDb.ts, backend/src/routes/tags.ts, backend/src/server.ts, backend/src/db.ts, backend/src/routes/photos.ts, src/api/tags.ts, src/features/upload/UploadPage.tsx |
\| 2026-07-16 09:30 | \[fix] 修复标签分隔问题：支持中英文逗号(,和，)分隔标签，添加空标签过滤 | backend/src/routes/photos.ts |
\| 2026-07-15 20:30 | \[feat] 实现用户系统：添加上传者信息框(照片详情页标题上方)、公共用户主页(/users/:userId)、照片删除功能(三重确认+数据库/OSS全量删除)、修复返回作品集导航错误 | backend/src/db.ts, backend/src/routes/photos.ts, backend/src/routes/auth.ts, backend/src/services/ossService.ts, src/features/gallery/PhotoDetailPage.tsx, src/features/profile/UserProfilePage.tsx, src/api/photos.ts, src/shared/UserContext.tsx, src/App.tsx |
\| 2026-07-15 19:40 | \[fix] 修复上传超时和500错误：添加120秒请求超时保护、Nginx代理超时配置(connect 60s/send/read 120s)、优化图片处理并行生成、添加处理时间日志 | backend/src/server.ts, backend/src/services/imageService.ts, /etc/nginx/sites-available/tlrphotos |
\| 2026-07-15 19:35 | \[fix] 修复轮播图点击导航错误和缩略图问题：非激活slide添加pointer-events-none防止点击穿透，添加索引越界保护，修复缩略图URL代理转换 | src/features/gallery/PhotoCarousel.tsx, backend/src/routes/photos.ts |
\| 2026-07-15 19:00 | \[fix] 修复上传500错误：修复sharp水印合成尺寸不匹配、移除OSS ACL参数、添加数据库新列(preview\_url/watermarked\_url/watermark\_config)、SQLite语法兼容 | backend/src/services/imageService.ts, backend/src/services/ossService.ts, backend/src/db.ts |
\| 2026-07-15 18:30 | \[fix] 修复上传413错误：Nginx配置client\_max\_body\_size 50M，与后端multer配置一致 | /etc/nginx/sites-available/tlrphotos |
\| 2026-07-15 18:00 | \[fix] 修复上传接口错误处理：multer错误返回HTML而非JSON，添加handleUploadError中间件统一返回JSON格式错误 | backend/src/routes/photos.ts, src/api/photos.ts |
\| 2026-07-15 17:30 | \[feat] 实现图片优化与水印功能：重构上传流程为multipart方式，使用sharp生成缩略图(800px)和预览图(1200px)，添加水印编辑器(拖拽定位、透明度、大小调整)，详情页优先显示水印图 | backend/src/services/imageService.ts, backend/src/routes/photos.ts, src/features/upload/UploadPage.tsx |
\| 2026-07-15 15:25 | \[feat] 重构上传页面：单选上传+强制填写标题/描述/标签+EXIF自动读取拍摄参数 | src/features/upload/UploadPage.tsx, package.json |
\| 2026-07-15 07:35 | \[fix] 部署到生产环境：修复nginx代理解码%2F导致图片路由404，改用通配符路由匹配，移除fetch的timeout选项，前后端构建并重启服务 | backend/src/routes/photos.ts, dist/ |
\| 2026-07-14 23:30 | \[fix] 统一照片ID格式：修复ID生成逻辑防止NaN，将数据库中所有非标准ID(photo\_xxx、000NaN等)统一转换为纯数字格式 | backend/src/routes/photos.ts |
\| 2026-07-14 23:15 | \[fix] 修复图片显示问题：代理路由支持从OSS预签名URL中提取文件路径，确保旧照片和新照片都能通过代理访问，修复"我的作品"导航到首页的问题 | backend/src/routes/photos.ts, src/shared/Header.tsx |
\| 2026-07-14 22:30 | \[fix] 修复上传图片无法查看：completeUpload返回预签名URL而非文件路径，修复GalleryPage导航路径/photo->/photos | backend/src/routes/photos.ts, src/features/gallery/GalleryPage.tsx |
\| 2026-07-14 19:05 | \[fix] 修复auth.ts语法错误：远程仓库合并冲突导致接口定义缺少闭合花括号，修复LoginData/UploadAvatarData接口 | src/api/auth.ts |
\| 2026-07-14 11:00 | \[feat] 作品集图库页面：6位数字ID、搜索API、标签筛选、时间/热度/浏览排序、响应式网格、GalleryPage组件 | backend/src/db.ts, backend/src/routes/photos.ts, backend/docs/api.md, src/api/photos.ts, src/features/gallery/GalleryPage.tsx, src/shared/Header.tsx, src/App.tsx |
\| 2026-07-14 10:30 | \[fix] 修复顶部栏玻璃效果失效：增强.glass/.glass-sm/.glass-lg背景不透明度和模糊度 | src/index.css |
\| 2026-07-13 21:00 | \[feat] 图片上传页面：PhotoUploader支持多选拖拽上传、UploadPage编辑照片信息、/upload路由、Header下拉菜单添加上传入口 | src/shared/PhotoUploader.tsx, src/features/upload/UploadPage.tsx, src/App.tsx, src/shared/Header.tsx |
\| 2026-07-13 20:30 | \[config] 数据库文件分离存储：.gitignore排除backend/data/*.db和uploads，创建.gitkeep保持目录结构 | .gitignore, backend/data/.gitkeep |
\| 2026-07-13 20:00 | \[fix] Header下拉菜单悬停消失：添加200ms延迟关闭、下拉框独立鼠标事件、clearTimeout取消关闭 | src/shared/Header.tsx |
\| 2026-07-13 19:30 | \[fix] PhotoDetailPage图片容器空白（flex items-start + block max-w-full）、Header下拉菜单悬停消失（onMouseEnter/onMouseLeave移到父容器） | src/features/gallery/PhotoDetailPage.tsx, src/shared/Header.tsx |
\| 2026-07-14 01:00 | \[config] 配置阿里云OSS存储（香港地域），设置AccessKey和Bucket信息 | backend/.env |
\| 2026-07-14 00:30 | \[feat] Cookie登录状态管理：创建cookie表、AES-256-GCM加密、双重过期机制(30天时间+7天活动)、保存登录状态复选框、自动登录接口、定时清理任务 | backend/src/utils/crypto.ts, backend/src/db.ts, backend/src/services/cookieService.ts, backend/src/services/authService.ts, backend/src/routes/auth.ts, backend/src/server.ts, backend/docs/api.md, src/api/auth.ts, src/features/auth/AuthPage.tsx, src/shared/UserContext.tsx |
\| 2026-07-13 23:58 | \[config] 配置GitHub同步安全策略，.gitignore保护本地数据，创建sync.sh同步脚本 | .gitignore, sync.sh |
\| 2026-07-13 23:55 | \[config] 安装SSL证书，配置HTTPS和HTTP重定向，支持Cloudflare DNS挑战获取证书 | nginx.conf |
\| 2026-07-13 23:40 | \[config] 配置前端和后端监听所有网卡地址，允许外部设备通过IP访问，修复API地址硬编码问题，添加nginx生产部署配置，创建systemd服务保证后端持久运行 | vite.config.ts, backend/src/server.ts, src/api/client.ts, nginx.conf, backend/tlrphotos-backend.service |
\| 2026-07-13 15:30 | \[feat] 用户个人页面：头像上传预览、资料编辑表单、自定义字段、密码修改（二次确认）、隐私设置切换、Header下拉菜单、ProfilePage组件 | backend/src/db.ts, backend/src/services/authService.ts, backend/src/routes/auth.ts, backend/docs/api.md, src/api/auth.ts, src/shared/UserContext.tsx, src/shared/Header.tsx, src/features/profile/ProfilePage.tsx, src/App.tsx |
\| 2026-07-13 00:00 | \[fix] 删除背景动画（保留静态渐变）、修复双重顶部栏（PhotoDetailPage/ArticleDetailPage移除重复Header/Footer）、登录页面浅色主题适配、粘性页脚实现 | src/shared/MouseFollowBackground.tsx, src/features/gallery/PhotoDetailPage.tsx, src/features/column/ArticleDetailPage.tsx, src/features/auth/AuthPage.tsx, src/App.tsx |
\| 2026-07-07 19:30 | \[feat] 用户认证系统：users表、bcrypt密码哈希、JWT令牌、登录/注册页面（流畅动画切换）、微信/QQ登录预留、Header登录按钮 \[push-deferred] | backend/src/db.ts, backend/src/services/authService.ts, backend/src/routes/auth.ts, backend/docs/api.md, src/shared/UserContext.tsx, src/api/auth.ts, src/features/auth/AuthPage.tsx, src/shared/Header.tsx, src/App.tsx |
\| 2026-07-07 21:30 | \[feat] 纯代码全栈架构迁移完成：Express后端、SQLite数据库、API路由、前端数据层重写、本地联调通过 | backend/*, src/api/*, src/shared/PhotosContext.tsx |
\| 2026-07-02 01:10 | \[fix] 修复PhotosContext和PhotoDetailPage类型错误：修正setPhotos参数、移除无用getPhotoById、修正日期格式化函数引用 | PhotosContext.tsx, PhotoDetailPage.tsx |
\| 2026-07-02 01:00 | \[refactor] 项目审查修复：XSS防护、URL白名单、PhotosContext、工具函数提取、ApiResponse复用、AbortController、ErrorBoundary、删除WaterfallGallery | src/\*\*/\* |
\| 2026-07-02 00:10 | \[fix] 清理无用代码：删除未使用的getPhotoDetail函数，修复Footer类型定义，更新项目名称 | mockData.ts, Footer.tsx, package.json |
\| 2026-07-02 00:00 | \[config] 忽略SSH密钥文件(id\_ed25519.pub等)防止上传 \[push-deferred] | .gitignore |
\| 2026-07-01 21:00 | \[feat] API服务层：照片接口、文章接口、评论接口、点赞接口，所有组件接入API | src/api/*, src/App.tsx, src/features/gallery/*, src/features/column/\* |
\| 2026-07-01 20:00 | \[fix] 修复文章渲染问题：Vite配置允许访问articles目录、修正文章路径为绝对路径 | vite.config.ts, src/features/column/mockData.ts |
\| 2026-07-01 19:30 | \[feat] 专栏详情页点赞评论功能：点赞状态切换、评论输入与展示、时间格式化 | src/features/column/ArticleDetailPage.tsx |
\| 2026-07-01 19:00 | \[feat] 专栏功能：列表组件、详情页、Markdown/LaTeX 渲染、测试文章 | src/features/column/*, articles/test-markdown-latex.md |
\| 2026-07-01 18:50 | \[refactor] 首页布局重构：轮播图左中位置 + 右侧专栏 + 底部疏松图片 | src/App.tsx |
\| 2026-06-30 21:00 | \[fix] 修复 TypeScript 类型错误：ThemeContext ReactNode 导入、MouseFollowBackground 数组类型注解 | src/shared/ThemeContext.tsx, src/shared/MouseFollowBackground.tsx |
\| 2026-06-30 20:30 | \[feat] 主题切换功能：深色/浅色模式 + 平滑动画、48 条动态线条背景、轮播图固定白色文字 | src/shared/ThemeContext.tsx, src/shared/MouseFollowBackground.tsx, src/features/gallery/PhotoCarousel.tsx |
\| 2026-06-30 19:00 | \[feat] 照片详情页：点击跳转、完整 EXIF 信息展示、标签系统 | src/features/gallery/PhotoDetailPage.tsx, src/features/gallery/types.ts, src/features/gallery/mockData.ts |
\| 2026-06-28 17:25 | \[feat] 新增鼠标跟随动态背景 + 液态玻璃效果，全站改造为深色主题 | src/shared/MouseFollowBackground.tsx, src/index.css, src/App.tsx, src/shared/Header.tsx, src/shared/Footer.tsx, src/features/gallery/\* |
\| 2026-06-28 16:30 | \[refactor] 瀑布流智能分配算法优化 | src/features/gallery/WaterfallGallery.tsx |

***

## 9. 下一步计划

1. **PocketBase 后端搭建**：在服务器部署 PocketBase，创建 `photos` 数据表
2. **真实数据接入**：替换 Mock 数据为 PocketBase API 查询
3. **照片上传功能**：实现上传组件，支持缩略图生成 + R2 存储
4. **详情页开发**：点击照片卡片跳转到详情页，展示原图

***

*文档版本：v0.4*
*创建日期：2026-06-28*
*最后更新：2026-06-30*
