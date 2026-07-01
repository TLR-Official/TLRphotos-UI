# 航空摄影工作室 - 项目上下文文档

## 1. 项目概述

**项目名称**：航空摄影工作室网站

**团队定位**：极微型工作室，由非技术人员主导

**核心目标**：搭建一个极致轻量、低成本、零运维的航空摄影作品展示与管理平台

**核心理念**：
- 服务器仅承担数据存储与后端运行，所有前端开发在本地完成
- 避免引入复杂基础设施（Docker/Redis 等）
- 降低运维成本和技术门槛

---

## 2. 技术架构

### 2.1 前端
- **框架**：React + TypeScript
- **样式**：TailwindCSS
- **构建工具**：Vite
- **开发环境**：本地开发，本地调试，构建产物上传至服务器静态目录

### 2.2 后端
- **框架**：PocketBase（Go 语言编写，单二进制文件）
- **数据库**：SQLite（单文件数据库）
- **部署环境**：服务器端运行
- **访问方式**：通过 RESTful API 提供服务

### 2.3 存储
- **混合存储模式**：
  - 高清缩略图：以 WebP Blob 形式存储在服务器本地数据盘 `/mnt/data/pb_data`
  - 原图：存储在 Cloudflare R2 对象存储

---

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

---

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

---

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

---

## 6. 已知约束

### 6.1 技术约束
- ❌ **禁止引入 Docker**
- ❌ **禁止引入 Redis 或其他缓存服务**
- ❌ **禁止将缩略图存为 Base64 字符串**
- ❌ **禁止在服务器上执行前端构建、Vite 开发或 UI 调试**
- ✅ **必须按需查询指定字段**（列表页 API）

### 6.2 开发约束
- 所有 UI 开发必须在本地完成
- 服务器仅用于运行 PocketBase 和存储数据
- 前端构建产物部署到服务器静态目录

### 6.3 存储约束
- 缩略图存储路径固定为 `/mnt/data/pb_data/thumbnails/`
- 原图必须存储到 Cloudflare R2
- 数据库与缩略图存储在同一数据盘

---

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

---

## 8. 项目进度

### 里程碑记录

| 日期 | 里程碑 | 状态 |
|------|--------|------|
| 2026-06-28 | 项目冷启动，初始化 React + TypeScript + TailwindCSS 项目 | ✅ 完成 |
| 2026-06-28 | 首页轮播组件 + 照片网格列表 Mock 版本 | ✅ 完成 |
| 2026-06-28 | 配置 Favicon 和网站图标 | ✅ 完成 |
| 2026-06-28 | GitHub 仓库初始化并完成首次推送 | ✅ 完成 |
| 2026-06-28 | GitHub Actions 自动化：dev 分支每周一自动合并到 main | ✅ 完成 |
| 2026-06-30 | 主题切换功能：深色/浅色模式 + 平滑动画过渡 | ✅ 完成 |
| 2026-06-30 | 动态背景线条效果：48 条流动线条 + 鼠标干扰效果 | ✅ 完成 |
| 2026-06-30 | 照片详情页：点击跳转 + 完整 EXIF 信息展示 | ✅ 完成 |
| 2026-06-30 | 轮播图优化：固定白色标题文字，适应深浅主题 | ✅ 完成 |
| 2026-06-30 | TypeScript 类型修复：ThemeContext 和 MouseFollowBackground | ✅ 完成 |
| 2026-07-01 | 首页布局重构：轮播图左中位置 + 右侧专栏 + 底部疏松图片 | ✅ 完成 |
| 2026-07-01 | 专栏功能：列表组件 + 详情页 + Markdown/LaTeX 渲染 | ✅ 完成 |

### Git 仓库信息

- **仓库地址**：https://github.com/TLR-Official/TLRphotos-UI
- **默认分支**：main
- **远程仓库**：origin (git@github.com:TLR-Official/TLRphotos-UI.git)

---

## Changelog

| 2026-07-01 19:30 | [feat] 专栏详情页点赞评论功能：点赞状态切换、评论输入与展示、时间格式化 | src/features/column/ArticleDetailPage.tsx |
| 2026-07-01 19:00 | [feat] 专栏功能：列表组件、详情页、Markdown/LaTeX 渲染、测试文章 | src/features/column/*, articles/test-markdown-latex.md |
| 2026-07-01 18:50 | [refactor] 首页布局重构：轮播图左中位置 + 右侧专栏 + 底部疏松图片 | src/App.tsx |
| 2026-06-30 21:00 | [fix] 修复 TypeScript 类型错误：ThemeContext ReactNode 导入、MouseFollowBackground 数组类型注解 | src/shared/ThemeContext.tsx, src/shared/MouseFollowBackground.tsx |
| 2026-06-30 20:30 | [feat] 主题切换功能：深色/浅色模式 + 平滑动画、48 条动态线条背景、轮播图固定白色文字 | src/shared/ThemeContext.tsx, src/shared/MouseFollowBackground.tsx, src/features/gallery/PhotoCarousel.tsx |
| 2026-06-30 19:00 | [feat] 照片详情页：点击跳转、完整 EXIF 信息展示、标签系统 | src/features/gallery/PhotoDetailPage.tsx, src/features/gallery/types.ts, src/features/gallery/mockData.ts |
| 2026-06-28 17:25 | [feat] 新增鼠标跟随动态背景 + 液态玻璃效果，全站改造为深色主题 | src/shared/MouseFollowBackground.tsx, src/index.css, src/App.tsx, src/shared/Header.tsx, src/shared/Footer.tsx, src/features/gallery/* |
| 2026-06-28 16:30 | [refactor] 瀑布流智能分配算法优化 | src/features/gallery/WaterfallGallery.tsx |

---

## 9. 下一步计划

1. **PocketBase 后端搭建**：在服务器部署 PocketBase，创建 `photos` 数据表
2. **真实数据接入**：替换 Mock 数据为 PocketBase API 查询
3. **照片上传功能**：实现上传组件，支持缩略图生成 + R2 存储
4. **详情页开发**：点击照片卡片跳转到详情页，展示原图

---

*文档版本：v0.4*
*创建日期：2026-06-28*
*最后更新：2026-06-30*