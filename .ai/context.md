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
