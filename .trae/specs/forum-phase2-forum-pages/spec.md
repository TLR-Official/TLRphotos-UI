# 论坛系统第二阶段：论坛子页面（板块/帖子/帖子流）- 产品需求文档

## Overview

- **Summary**: 论坛系统分阶段研发的第二阶段，交付论坛子页面能力：板块（Board）、帖子（Thread）与帖子流。帖子即 V3.0.0 通用评论体系的 `subject_type='thread'` 主题，帖子正文为 Markdown，挂载于板块之下；帖子详情页直接复用 `CommentList` 组件承载三级嵌套讨论。板块、帖子均有独立列表页与详情页，支持按板块筛选、按最新/最热排序、分页。
- **Purpose**: 在照片与文章评论能力之上，构建面向用户生成内容（UGC）的论坛主入口，让通用评论组件脱离"照片/文章附属"定位，成为可独立承载讨论的帖子主题；复用 V3.0.0 全部评论生命周期（归档/回迁/热度），零改动接入。
- **Target Users**:
  - 已邮箱确权的注册用户：浏览板块、发帖、在帖子下三级回复、点赞、删除自己的帖子/评论。
  - 匿名访客：浏览板块与帖子列表、阅读帖子正文与评论；交互时引导登录确权。
  - 管理员：管理板块（增删改、排序、启用/停用）、置顶/下沉帖子、删除任意帖子与评论、留审计日志。

## Goals

1. **板块体系**: 论坛含若干板块（Board），每个板块有名称、描述、图标、排序权重、启用状态；帖子必须归属于一个启用板块。
2. **帖子发布与展示**: 确权用户可发帖（标题 + Markdown 正文 + 所属板块）；帖子详情页展示正文并直接挂载三级评论区。
3. **帖子流**: 论坛首页展示全部板块与最新/最热帖子流；板块页展示该板块下的帖子列表；支持分页与排序。
4. **评论零改动复用**: 帖子详情页的评论区使用 `subject_type='thread'` + 帖子 id 调用 `CommentList`，复用 V3.0.0 全部能力。
5. **管理能力**: 管理员可增删改板块、置顶/取消置顶帖子、删除任意帖子（级联删除评论与归档）、写入 `admin_logs`。

## Non-Goals

- 帖子富文本编辑器（本期使用 `<textarea>` + Markdown 预览，不引入富文本编辑器依赖）。
- 帖子图片上传（本期正文仅支持 Markdown 文本，外链图片由用户自行粘贴 URL）。
- 私信、@ 提及通知、消息中心（通知体系为后续阶段）。
- 板块订阅、帖子收藏（后续阶段）。
- 帖子标签/话题体系（本期仅板块分类）。
- 论坛搜索（后续阶段，本期依赖浏览器页内查找）。

## Background & Context

- V3.0.0 已交付通用三级评论体系：`comments` 表按 `(subject_type, subject_id)` 组织，归档/回迁/热度三档生命周期已上线生产，前端 `CommentList`、`useComments`、`useArchivedThread`、`commentCache` 均为主题参数化可复用模块。
- 现有 `articles` 表与 `articles.ts` 路由是帖子模块的直接参照：帖子与文章同为"正文 + 评论"结构，差异在于帖子属于板块、正文存数据库（非文件）、作者为注册用户。
- 可复用基础设施：`ossService`、`requireVerifiedEmail` 确权门、Turnstile 人机验证门、`logAdminAction` 审计、`server.ts` 定时任务模式。

## Functional Requirements

### 板块（Board）

- **FR-1 板块表**: `forum_boards(id, name, description, icon, sort_order, is_active, created_at)`；`id` 为短标识。
- **FR-2 板块列表**: `GET /api/forum/boards` 返回所有启用板块，按 `sort_order` 升序；管理员可获取含停用板块的完整列表。
- **FR-3 板块管理（管理员）**: `POST/PUT/DELETE /api/admin/forum/boards`，支持创建、修改、删除（删除前校验该板块下无帖子）；操作写 `admin_logs`。

### 帖子（Thread）

- **FR-4 帖子表**: `forum_threads(id, board_id, title, content_md, author_id, author_name, status, is_pinned, view_count, like_count, reply_count, last_reply_at, created_at, updated_at)`；`status ∈ {published, hidden}`。
- **FR-5 发帖**: `POST /api/forum/threads`，须邮箱确权 + Turnstile；`title` 1–120 字、`content_md` 1–20000 字；`board_id` 必须为启用板块。
- **FR-6 帖子详情**: `GET /api/forum/threads/:id` 返回完整信息；浏览数按 IP/user_id 24h 去重自增。
- **FR-7 帖子流**: `GET /api/forum/threads?board_id=&sort=&page=&page_size=`；`sort ∈ {latest, hot}`；分页默认 20/页。
- **FR-8 帖子点赞**: `POST/DELETE /api/forum/threads/:id/like`，确权用户幂等点赞/取消。
- **FR-9 帖子删除**: 本人/管理员可删；级联删除评论行、`comment_heat`、`comment_archives` 索引与 OSS 对象；高危删除经 Turnstile。
- **FR-10 帖子置顶（管理员）**: `PUT /api/admin/forum/threads/:id/pin` 切换 `is_pinned`；置顶帖始终排前。

### 前端页面

- **FR-11 论坛首页** `/forum`: 板块横向导航 + 左侧帖子流（最新/最热、分页）+ 右侧板块卡片。
- **FR-12 板块页** `/forum/b/:boardId`: 板块帖子列表 + "发帖"按钮。
- **FR-13 帖子详情页** `/forum/t/:threadId`: 标题/作者/正文（Markdown）+ `<CommentList subjectType="thread" subjectId={threadId} />`。
- **FR-14 发帖页** `/forum/new`: 板块下拉 + 标题 + Markdown 正文 + 实时预览 + Turnstile。

### 评论复用

- **FR-15**: 帖子详情页评论区**必须**直接复用 `src/features/comments/` 组件，仅传入 `subjectType="thread"` 与 `subjectId`；不得另行实现评论逻辑。

## Non-Functional Requirements

- **NFR-1 性能**: 帖子列表查询命中索引；单页 < 50ms。
- **NFR-2 安全**: 发帖/删帖经 Turnstile；Markdown 渲染 HTML 过滤；板块删除校验无关联帖子。
- **NFR-3 兼容性**: 帖子详情页评论区与照片/文章页评论区行为完全一致。
- **NFR-4 可维护性**: 论坛模块独立于 `features/forum/`，类型集中于 `features/forum/types.ts`。


## 技术选型与数据细节

- **Markdown 渲染**: 前端使用 marked + DOMPurify（marked 解析 → DOMPurify 消毒 → dangerouslySetInnerHTML）；后端不渲染正文，仅存原始 Markdown 文本。
- **浏览去重**: 新增 thread_views(thread_id, viewer_key, last_viewed_at) 表，逻辑与 photo_views 完全一致（登录按 user_id，匿名按 X-Forwarded-For 首段 IP，24h 窗口）；每小时清理 7 天前旧记录。
- **帖子与内容关联**: forum_threads 可选字段 ref_type（photo/article/null）与 ref_id，用于从照片/文章详情页跳转发帖时自动关联；不强制。
- **点赞表**: 新增 thread_likes(thread_id, user_id, created_at) 联合主键，与 photo_likes 同构。
- **计数同步**: 发帖时 forum_boards.thread_count+1；删帖时 thread_count-1；评论发表/删除时 forum_threads.reply_count 与 last_reply_at 同步（由评论路由在 subject_type='thread' 时回调更新）。

## Constraints & Assumptions

- 复用 V3.0.0 评论体系，不修改评论核心逻辑。
- 帖子正文存 SQLite TEXT（最大 20000 字）。
- 板块初始数据由迁移脚本 seed（至少 3 个默认板块）。
- 路由前缀 `/api/forum` 与 `/api/admin/forum`。

## Acceptance Criteria

- **AC-1 (rule)**: 板块列表 API 返回启用板块按 sort_order 升序；管理员可管理板块并留审计。
- **AC-2 (rule)**: 确权用户可发帖（标题/正文/板块校验）；帖子详情返回完整信息；浏览数 24h 去重自增。
- **AC-3 (rule)**: 帖子流支持按板块筛选、最新/最热排序、分页；置顶帖始终排前。
- **AC-4 (rule)**: 帖子详情页直接挂载 CommentList(subjectType="thread")，可发表三级嵌套评论并经 E2E 验证。
- **AC-5 (rule)**: 删除帖子级联删除评论行/热度/归档索引/OSS 对象；管理员置顶生效。
- **AC-6 (rubric)**: 论坛页面视觉与站点一致（白底/teal/无紫色/无 dark），375px 无横向溢出。0–2，阈值 ≥1。
- **AC-7 (rule)**: 后端全套件 + 前端测试 + 构建通过；E2E 覆盖发帖→列表→详情→三级评论→删除。
