# Tasks — V4 全模块迭代

## Phase 1：基础设施（后端）

- [x] Task 1: 数据库迁移与角色扩展
  - [x] 1.1 db.ts 新建 `notifications`（id/user_id/type/title/content/related_type/related_id/is_read/created_at + user_id+is_read 索引）、`penalties`（id/user_id/level/reason/days/expires_at/created_by/created_at）、`appeals`（id/photo_id/user_id/reason/status pending|approved|rejected|withdrawn/response/decided_by/decided_at/created_at）、`news_images`（id/article_id/photo_id/authorization_confirmed/created_at）
  - [x] 1.2 photos 幂等迁移加列：`reviewed_by`/`reviewed_at`/`is_hot_confirmed INTEGER DEFAULT 0`/`assigned_to`；articles 幂等迁移加列：`type TEXT DEFAULT 'column'`/`board_id`；全部 try/catch 空捕获沿用既有模式
  - [x] 1.3 adminAuth 角色枚举扩展 `forum_moderator`/`news_editor`；zone_master 创建子账号白名单校验排除新角色；管理端 UsersPage/AdminsPage 角色下拉与权限门同步
  - [x] 1.4 新建 `backend/src/services/notificationService.ts`：createNotification(user_id/type/title/content/related) + unreadCount + markRead/markAllRead；每日清理 90 天前已读通知（挂 server.ts 定时）

- [x] Task 2: P0 通知/召回/处罚/申诉后端端点
  - [x] 2.1 新建 `backend/src/routes/notifications.ts`：GET /api/notifications（分页）、GET /api/notifications/unread-count、PUT /api/notifications/:id/read、PUT /api/notifications/read-all（JWT 用户隔离）；server.ts 挂载
  - [x] 2.2 admin.ts approve/reject 端点写入 reviewed_by/reviewed_at（审计日志沿用）；新增 PUT /api/admin/photos/:id/recall（窗口判断 + 原因必填校验 + 通知模板 + is_hot_confirmed 拒绝 400 HOT_NOT_RECALLABLE + 权限分级：zone_auditor 仅本人 reviewed_by）、PUT /api/admin/photos/:id/hot（确认热门+通知+审计）、PUT /api/admin/photos/:id/assign（指派/转移+审计）、GET /api/admin/my-audits（本人已处理列表）
  - [x] 2.3 处罚端点：POST /api/admin/users/:id/penalty（level 1/2 + reason 必填 + 挂人机验证门；L1 写 upload_banned_until、L2 复用 banned_at + deleteUserSessions 强制下线）+ GET /api/admin/users/:id/penalties（处罚历史）；users 表幂等迁移加 `upload_banned_until`；上传链路（/upload、/upload/presigned、/upload/complete、direct /upload）前置校验 403 UPLOAD_BANNED（含解禁时间）
  - [x] 2.4 申诉端点：用户侧 POST /api/photos/:id/appeal（仅 owner + rejected 状态 + 无进行中申诉 409）、GET /api/my-appeals、DELETE /api/my-appeals/:id（仅本人+pending）；管理侧 GET /api/admin/appeals、PUT /api/admin/appeals/:id/decide（approve→照片回 approved+回执通知；reject→回执含原因；均写 decided_by/at）
  - [x] 2.5 通知触发布点：photos.ts 点赞（首次）/ 下载代理（?download=1）/ auth.ts 处罚通知复用 / forum.ts 二级回复被回复人「回复 @xxx」通知；一次性过审不发通知

## Phase 2：P0 前端

- [x] Task 3: 通知中心前端
  - [x] 3.1 新建 `src/features/notifications/`：NotificationPage（列表/类型图标仅文字样式/点击跳转关联对象并标已读/全部已读按钮）、`src/api/notifications.ts` 封装
  - [x] 3.2 Header 头像下拉加未读角标（unread-count 随路由与下拉展开刷新）+「通知中心」入口；App.tsx 注册 /notifications 路由（登录守卫）

- [x] Task 4: 审核/申诉/处罚前端
  - [x] 4.1 管理端 PhotoDetailPage：召回按钮（窗口内=静默确认框；超窗=原因必填对话框；is_hot_confirmed 禁用并提示）+「确认热门」按钮 + 分配/转移下拉（super/zone_master 可选任意审核员）
  - [x] 4.2 管理端新增申诉裁决页（列表+通过/驳回+驳回原因）与处罚操作入口（UsersPage 行内处罚按钮：一级天数/二级永久 + 原因必填 + 历史查看）；分配管理入口（待审列表按 assigned_to 筛选）；审核员「我的已处理」页签
  - [x] 4.3 用户侧：PhotoDetailPage rejected 状态 owner 可见「发起申诉」（原因必填）与申诉状态展示；MyWorksPage 未通过卡片加申诉/撤回申诉入口

## Phase 3：P1 论坛

- [x] Task 5: 论坛治理
  - [x] 5.1 seed 保证航空/铁路/公路三板块存在（forum_boards 幂等 seed）；板块管理端约束仅此三类；articles 加 board_id 后专栏文章归入板块展示（前台文章页板块筛选）
  - [x] 5.2 forum_moderator 专属后台视图：仅论坛治理（帖子/评论删除复用现有管理端点挂 requireRole 扩展）；后置审核行为补集成测试锁定（发帖直接 published）
  - [x] 5.3 回复 @通知前端透出（通知中心 type=forum_reply 点击跳转帖子）

## Phase 4：P2 新闻区

- [x] Task 6: 新闻区
  - [x] 6.1 新闻管理端点：POST/PUT /api/admin/news（news_editor 权限门；标题+正文+配图 photo_id 数组+授权勾选必填校验；禁止本地上传无上传端点）、GET /api/admin/news；配图复用 GET /api/photos/search 图库检索
  - [x] 6.2 前台端点：GET /api/news（分页，首批 board 限航空）、GET /api/news/:id（含配图代理 URL 与版权标注字段）
  - [x] 6.3 前端：新闻编辑器页（图库选图弹窗复用检索组件 + 授权确认勾选 + 配图更换）、前台新闻列表/详情页（详情含 `@作者名 ©TLRphotos {年} 版权所有`）、Header/Footer 入口、App.tsx 路由

## Phase 5：P3 关于我们

- [x] Task 7: 关于我们页
  - [x] 7.1 公开端点 GET /api/about/stats：{ site_days（固定开站日 2026-08-15 起算）, approved_count }（复用 /photos/stats 公开数据或独立轻量端点）
  - [x] 7.2 AboutPage：四张团队角色卡（文案占位）、站点数据卡、「支持我们」占位卡；/about 路由 + Header/Footer 链接

## Phase 6：契约、测试与发布

- [x] Task 8: 契约与配置文档
  - [x] 8.1 api.md 全量同步（通知/召回/处罚/申诉/分配/热门确认/新闻/关于我们 端点 + 403 UPLOAD_BANNED / 400 HOT_NOT_RECALLABLE 等错误码）
  - [x] 8.2 .env.example 增加 RECALL_WINDOW_MINUTES=3（含注释）；生产 .env 同步

- [x] Task 9: 全量测试与验证
  - [x] 9.1 新增后端集成测试：notifications（隔离/已读/角标计数）、recall（窗口内静默/超窗通知/热门拒绝/权限分级）、penalty（L1 上传禁令/L2 封禁下线/通知）、appeal（发起/撤回/裁决回执/重复申诉 409）、assign、news（权限隔离/授权必填/图库引用）、forum_moderator 权限边界、回复@通知
  - [x] 9.2 前端 oxlint 0 错误 + vite build 通过；后端全套件通过（327 存量 + 新增全绿）
  - [x] 9.3 版本 V4.0.0-beta 三处同步（package.json/package-lock、context.md、版本管理规则.md）+ Changelog + 提交推送 + 生产部署（backend rebuild + restart）+ 冒烟（notifications/unread-count、recall 端点、/api/news、/api/about/stats）

# Task Dependencies
- Task 2 depends on Task 1（表与通知服务就绪）
- Task 3、Task 4 依赖 Task 2；Task 3 与 Task 4 可并行
- Task 5 依赖 Task 1（角色/迁移）；Task 5.3 依赖 Task 3
- Task 6 依赖 Task 1（articles 迁移/角色）
- Task 7 无依赖，可随时并行
- Task 8 依赖 Task 2~7 全部落地；Task 9 依赖 Task 8
