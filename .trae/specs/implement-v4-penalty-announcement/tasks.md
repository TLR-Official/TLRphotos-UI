# Tasks — V4 处罚分级与公告横幅迭代

## Phase 1：后端基础与处罚体系

- [x] Task 1: 数据库迁移与执法基座
  - [x] 1.1 db.ts 幂等迁移：penalties 加列 `capabilities TEXT`/`revoked_at TEXT`/`revoked_by TEXT`；users 加列 `banned_until TEXT`/`region TEXT`/`can_ban_manage INTEGER DEFAULT 0`；新建 `announcements` 表（id/title/content/cover_url/is_active/created_by/created_at/updated_at）
  - [x] 1.2 存量处罚语义迁移（幂等）：`UPDATE penalties SET level=2, capabilities='["upload"]' WHERE level=1 AND capabilities IS NULL`；`UPDATE penalties SET level=3, capabilities='["all"]' WHERE level=2 AND capabilities IS NULL`；对应 users.upload_banned_until 语义由 L2 执法接管（保留列不删）
  - [x] 1.3 新建 penaltyService（或扩展既有 helper）：`getActivePenalties(userId)`（level>0 且 revoked_at IS NULL 且未过期）、`checkPenaltyCap(userId, cap)`（cap ∈ upload|comment|forum_post|download，命中活跃 L2 capabilities 返回处罚信息）、L3 限时自愈 helper（banned_until 过期清除 banned_at/banned_until）
  - [x] 1.4 离线 IP 省份解析：引入 ip2region xdb 系依赖（无外部网络请求），`resolveRegion(ip)` 纯函数 + 失败返回「未知」；auth.ts 登录/注册成功路径写 users.region（X-Forwarded-For 首段）

- [x] Task 2: 处罚端点升级与执法挂接
  - [x] 2.1 `POST /api/admin/users/:id/penalty` 三级化：L1 仅留痕+通知；L2 capabilities 必填（四项白名单子集非空）+ days 30~360；L3 days 可选（空=永久）写 banned_at+banned_until+deleteUserSessions；全部 reason 必填 + 人机验证门 + 处罚通知（L3 注明永久或到期时间）；对管理员账号处罚仅留痕不落效果（沿用现行为）
  - [x] 2.2 新增 `POST /api/admin/penalties/:id/revoke`：写 revoked_at/revoked_by；L1 仅 super（403 BAN_MANAGE_DENIED）；L2/L3 解除需 can_ban_manage + 人机验证门，同时清除对应 users 表效果（L2 无持久效果仅依赖 expires_at，L3 清 banned_at/banned_until）；撤销产生通知；挂载于 admin.ts
  - [x] 2.3 L2 执法点挂接：photos.ts 上传三路径改用 checkPenaltyCap('upload')（403 UPLOAD_BANNED 保留兼容，含解禁时间）；comments.ts 与论坛回复路径 checkPenaltyCap('comment')（403 COMMENT_BANNED）；论坛发帖路径 checkPenaltyCap('forum_post')（403 FORUM_POST_BANNED）；下载代理 ?download=1 checkPenaltyCap('download')（403 DOWNLOAD_BANNED）
  - [x] 2.4 L3 登录拦截自愈：loadAuthUser 与登录链路检查 banned_at + banned_until（未过期 401 USER_BANNED；已过期清除后放行）
  - [x] 2.5 处罚历史 `GET /api/admin/users/:id/penalties` 扩展返回 capabilities/revoked_at/revoked_by；users 列表端点返回 region/banned_until/can_ban_manage

## Phase 2：后端主页与公告

- [x] Task 3: 公开用户主页与公告端点
  - [x] 3.1 新建 routes/users.ts：`GET /api/users/:id/profile`（昵称/头像/region/加入天数/approved 作品统计与总浏览/活跃处罚公开数组[等级/原因/期限]/是否本人标记，120/min 限速）；`GET /api/users/:id/photos`（仅 approved，分页+category 筛选）；`GET /api/users/:id/threads`（公开帖子列表分页）；server.ts 挂载（注意路由顺序：注册于 /api/users 具名端点先于参数化）
  - [x] 3.2 新建 routes/announcements.ts：公开 `GET /api/announcements`（仅 is_active 倒序，120/min）；管理端 `POST/PUT/DELETE /api/admin/announcements` + `PUT /api/admin/announcements/:id/toggle`（super/news_editor，403 BAN_MANAGE_DENIED 之外的 403 ANNOUNCEMENT_DENIED，字段校验 title/content 必填长度上限）
  - [x] 3.3 api.md 同步全部新端点、三级处罚请求体、revoke、错误码（COMMENT_BANNED/FORUM_POST_BANNED/DOWNLOAD_BANNED/UPLOAD_BANNED 更新/BAN_MANAGE_DENIED/ANNOUNCEMENT_DENIED）

## Phase 3：前端

- [x] Task 4: 封禁管理页与入口收敛
  - [x] 4.1 新建 admin/BansPage.tsx（/admin/bans）：用户搜索（复用 /api/admin/users/list）+ 选中展示头像/账号；处罚表单（等级切换、L2 四项能力勾选、L2 期限 30~360 天下拉、L3 永久/限时切换+天数、原因必填）；提交挂 useHumanVerification；**多重确认弹窗**（摘要二次确认）；处罚历史列表含撤销按钮（L1 仅 super 可见、挂验证门）
  - [x] 4.2 UsersPage：移除行内一二级处罚对话框与直接封禁按钮，改「处罚管理」跳转 `/admin/bans?userId=xxx`；保留封禁/解封历史展示；权限项展示扩至 7 项（新增封禁管理 can_ban_manage 开关，挂验证门）
  - [x] 4.3 PhotoDetailPage（审核态）与 AppealsPage 新增「处罚该用户」跳转按钮（携带 userId 至 /admin/bans）；AdminApp 注册 /admin/bans 路由 + Layout「用户封禁管理」入口（can_ban_manage 角色门：super/zone_master）；AdminsPage 权限矩阵同步 can_ban_manage
  - [x] 4.4 前端 api 封装：admin api.ts 增加 penalty 三级参数/revoke/penalties 类型

- [x] Task 5: 公开用户主页
  - [x] 5.1 新建 features/user/PublicProfilePage.tsx（/users/:id）：状态标签行（region/加入天数/作品总浏览/处罚徽章）、处罚公开卡（活跃 L1/L2/L3 等级徽章+原因+期限，三色配色）、作品按分区（航空/铁路/公路）分组卡片（点击跳详情页）、论坛发帖记录列表；本人视图显示待审/未通过计数+「我的作品」链接
  - [x] 5.2 入口打通：评论区作者名、帖子作者名、照片详情上传者名链接至 /users/:id；新 api/users.ts 封装三端点；App.tsx 注册路由
- [x] Task 6: 公告横幅
  - [x] 6.1 新建 shared/TopBanner.tsx：站点顶部（Header 之上），封面图+标题+正文，多条列表展开，右上角关闭/展开，关闭状态按公告 id 记忆 localStorage；拉取 GET /api/announcements 失败静默隐藏
  - [x] 6.2 新建 admin/AnnouncementsPage.tsx（/admin/announcements）：列表+新建/编辑表单（title/content 必填、cover_url 可空）+ 上线/下线切换 + 删除二次确认；AdminApp 路由 + Layout 入口（super/news_editor 门）；App.tsx 挂 TopBanner

## Phase 4：测试与发布

- [x] Task 7: 集成测试与全量验证
  - [x] 7.1 新增后端集成测试：三级处罚创建校验（L2 capabilities 白名单/days 边界 29|30|360|361、L3 days 可选）、L2 四项执法各自 403 与过期放行、L3 限时到期自愈登录、revoke 权限矩阵（L1 非 super 403）、撤销后执法失效、公开主页端点越权（非 approved 不可见/无明文 IP）、公告 CRUD 权限与上下线、region 解析 mock（成功/失败「未知」）
  - [x] 7.2 存量套件适配（penalties level 语义变更影响 admin/photos/v4 套件断言）；后端全套件通过 + tsc --noEmit；前端 oxlint 0 错误 + vite build 通过
- [ ] Task 8: 版本发布与部署
  - [ ] 8.1 版本 V4.1.0-beta 三处同步（package.json/package-lock、context.md Changelog、版本管理规则.md）+ [release] 提交推送
  - [ ] 8.2 生产部署：backend rebuild + systemctl restart；冒烟（GET /api/announcements、/api/users/:id/profile、处罚三级创建→执法→撤销链路、登录自愈）；部署记录提交推送

# Task Dependencies
- Task 2 depends on Task 1（迁移与服务基座）
- Task 3 depends on Task 1（users 新列/announcements 表）；3.3 依赖 Task 2
- Task 4 depends on Task 2（端点就绪）；Task 5 depends on Task 3；Task 6 depends on Task 3
- Task 7 依赖 Task 2~6；Task 8 依赖 Task 7
- Task 4/5/6 相互可并行
