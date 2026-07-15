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

```json
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
- ❌ **禁止在服务器上执行前端构建、Vite 开发或 UI 调试**
- ✅ **必须按需查询指定字段**（列表页 API）
- ✅ 文件存储必须通过 `IStorageAdapter` 接口访问，禁止业务代码直接依赖任何特定对象存储 SDK；SQLite 仅存元数据，严禁存储二进制文件。

### 6.2 开发约束

- 所有 UI 开发必须在本地完成
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

| 2026-07-15 20:30 | [feat] 实现用户系统：添加上传者信息框(照片详情页标题上方)、公共用户主页(/users/:userId)、照片删除功能(三重确认+数据库/OSS全量删除)、修复返回作品集导航错误 | backend/src/db.ts, backend/src/routes/photos.ts, backend/src/routes/auth.ts, backend/src/services/ossService.ts, src/features/gallery/PhotoDetailPage.tsx, src/features/profile/UserProfilePage.tsx, src/api/photos.ts, src/shared/UserContext.tsx, src/App.tsx |
| 2026-07-15 19:40 | [fix] 修复上传超时和500错误：添加120秒请求超时保护、Nginx代理超时配置(connect 60s/send/read 120s)、优化图片处理并行生成、添加处理时间日志 | backend/src/server.ts, backend/src/services/imageService.ts, /etc/nginx/sites-available/tlrphotos |
| 2026-07-15 19:35 | [fix] 修复轮播图点击导航错误和缩略图问题：非激活slide添加pointer-events-none防止点击穿透，添加索引越界保护，修复缩略图URL代理转换 | src/features/gallery/PhotoCarousel.tsx, backend/src/routes/photos.ts |
| 2026-07-15 19:00 | [fix] 修复上传500错误：修复sharp水印合成尺寸不匹配、移除OSS ACL参数、添加数据库新列(preview_url/watermarked_url/watermark_config)、SQLite语法兼容 | backend/src/services/imageService.ts, backend/src/services/ossService.ts, backend/src/db.ts |
| 2026-07-15 18:30 | [fix] 修复上传413错误：Nginx配置client_max_body_size 50M，与后端multer配置一致 | /etc/nginx/sites-available/tlrphotos |
| 2026-07-15 18:00 | [fix] 修复上传接口错误处理：multer错误返回HTML而非JSON，添加handleUploadError中间件统一返回JSON格式错误 | backend/src/routes/photos.ts, src/api/photos.ts |
| 2026-07-15 17:30 | [feat] 实现图片优化与水印功能：重构上传流程为multipart方式，使用sharp生成缩略图(800px)和预览图(1200px)，添加水印编辑器(拖拽定位、透明度、大小调整)，详情页优先显示水印图 | backend/src/services/imageService.ts, backend/src/routes/photos.ts, src/features/upload/UploadPage.tsx |
| 2026-07-15 15:25 | [feat] 重构上传页面：单选上传+强制填写标题/描述/标签+EXIF自动读取拍摄参数 | src/features/upload/UploadPage.tsx, package.json |
| 2026-07-15 07:35 | [fix] 部署到生产环境：修复nginx代理解码%2F导致图片路由404，改用通配符路由匹配，移除fetch的timeout选项，前后端构建并重启服务 | backend/src/routes/photos.ts, dist/ |
| 2026-07-14 23:30 | [fix] 统一照片ID格式：修复ID生成逻辑防止NaN，将数据库中所有非标准ID(photo_xxx、000NaN等)统一转换为纯数字格式 | backend/src/routes/photos.ts |
| 2026-07-14 23:15 | [fix] 修复图片显示问题：代理路由支持从OSS预签名URL中提取文件路径，确保旧照片和新照片都能通过代理访问，修复"我的作品"导航到首页的问题 | backend/src/routes/photos.ts, src/shared/Header.tsx |
| 2026-07-14 22:30 | [fix] 修复上传图片无法查看：completeUpload返回预签名URL而非文件路径，修复GalleryPage导航路径/photo->/photos | backend/src/routes/photos.ts, src/features/gallery/GalleryPage.tsx |
| 2026-07-14 19:05 | [fix] 修复auth.ts语法错误：远程仓库合并冲突导致接口定义缺少闭合花括号，修复LoginData/UploadAvatarData接口 | src/api/auth.ts |
| 2026-07-14 11:00 | [feat] 作品集图库页面：6位数字ID、搜索API、标签筛选、时间/热度/浏览排序、响应式网格、GalleryPage组件 | backend/src/db.ts, backend/src/routes/photos.ts, backend/docs/api.md, src/api/photos.ts, src/features/gallery/GalleryPage.tsx, src/shared/Header.tsx, src/App.tsx |
| 2026-07-14 10:30 | [fix] 修复顶部栏玻璃效果失效：增强.glass/.glass-sm/.glass-lg背景不透明度和模糊度 | src/index.css |
| 2026-07-13 21:00 | [feat] 图片上传页面：PhotoUploader支持多选拖拽上传、UploadPage编辑照片信息、/upload路由、Header下拉菜单添加上传入口 | src/shared/PhotoUploader.tsx, src/features/upload/UploadPage.tsx, src/App.tsx, src/shared/Header.tsx |
| 2026-07-13 20:30 | [config] 数据库文件分离存储：.gitignore排除backend/data/*.db和uploads，创建.gitkeep保持目录结构 | .gitignore, backend/data/.gitkeep |
| 2026-07-13 20:00 | [fix] Header下拉菜单悬停消失：添加200ms延迟关闭、下拉框独立鼠标事件、clearTimeout取消关闭 | src/shared/Header.tsx |
| 2026-07-13 19:30 | [fix] PhotoDetailPage图片容器空白（flex items-start + block max-w-full）、Header下拉菜单悬停消失（onMouseEnter/onMouseLeave移到父容器） | src/features/gallery/PhotoDetailPage.tsx, src/shared/Header.tsx |
| 2026-07-14 01:00 | [config] 配置阿里云OSS存储（香港地域），设置AccessKey和Bucket信息 | backend/.env |
| 2026-07-14 00:30 | [feat] Cookie登录状态管理：创建cookie表、AES-256-GCM加密、双重过期机制(30天时间+7天活动)、保存登录状态复选框、自动登录接口、定时清理任务 | backend/src/utils/crypto.ts, backend/src/db.ts, backend/src/services/cookieService.ts, backend/src/services/authService.ts, backend/src/routes/auth.ts, backend/src/server.ts, backend/docs/api.md, src/api/auth.ts, src/features/auth/AuthPage.tsx, src/shared/UserContext.tsx |
| 2026-07-13 23:58 | [config] 配置GitHub同步安全策略，.gitignore保护本地数据，创建sync.sh同步脚本 | .gitignore, sync.sh |
| 2026-07-13 23:55 | [config] 安装SSL证书，配置HTTPS和HTTP重定向，支持Cloudflare DNS挑战获取证书 | nginx.conf |
| 2026-07-13 23:40 | [config] 配置前端和后端监听所有网卡地址，允许外部设备通过IP访问，修复API地址硬编码问题，添加nginx生产部署配置，创建systemd服务保证后端持久运行 | vite.config.ts, backend/src/server.ts, src/api/client.ts, nginx.conf, backend/tlrphotos-backend.service |
| 2026-07-13 15:30 | [feat] 用户个人页面：头像上传预览、资料编辑表单、自定义字段、密码修改（二次确认）、隐私设置切换、Header下拉菜单、ProfilePage组件 | backend/src/db.ts, backend/src/services/authService.ts, backend/src/routes/auth.ts, backend/docs/api.md, src/api/auth.ts, src/shared/UserContext.tsx, src/shared/Header.tsx, src/features/profile/ProfilePage.tsx, src/App.tsx |
| 2026-07-13 00:00 | [fix] 删除背景动画（保留静态渐变）、修复双重顶部栏（PhotoDetailPage/ArticleDetailPage移除重复Header/Footer）、登录页面浅色主题适配、粘性页脚实现 | src/shared/MouseFollowBackground.tsx, src/features/gallery/PhotoDetailPage.tsx, src/features/column/ArticleDetailPage.tsx, src/features/auth/AuthPage.tsx, src/App.tsx |
| 2026-07-07 19:30 | [feat] 用户认证系统：users表、bcrypt密码哈希、JWT令牌、登录/注册页面（流畅动画切换）、微信/QQ登录预留、Header登录按钮 [push-deferred] | backend/src/db.ts, backend/src/services/authService.ts, backend/src/routes/auth.ts, backend/docs/api.md, src/shared/UserContext.tsx, src/api/auth.ts, src/features/auth/AuthPage.tsx, src/shared/Header.tsx, src/App.tsx |
| 2026-07-07 21:30 | [feat] 纯代码全栈架构迁移完成：Express后端、SQLite数据库、API路由、前端数据层重写、本地联调通过 | backend/*, src/api/*, src/shared/PhotosContext.tsx |
| 2026-07-02 01:10 | [fix] 修复PhotosContext和PhotoDetailPage类型错误：修正setPhotos参数、移除无用getPhotoById、修正日期格式化函数引用 | PhotosContext.tsx, PhotoDetailPage.tsx |
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
\| 2026-06-28 17:25 | \[feat] 新增鼠标跟随动态背景 + 液态玻璃效果，全站改造为深色主题 | src/shared/MouseFollowBackground.tsx, src/index.css, src/App.tsx, src/shared/Header.tsx, src/shared/Footer.tsx, src/features/gallery/* |
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
