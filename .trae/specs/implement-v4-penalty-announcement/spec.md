# V4 处罚分级与公告横幅迭代 Spec

## Why
现有处罚仅两级（限制上传/封禁账号），审核员缺少「仅警告」梯度与差异化能力封禁；封禁入口散落在用户管理列表易误操作；站点无公开用户主页与官方公告广播渠道。依据 `docs/prd-v4-penalty-notification.md`（站长 2026-10-18 规划稿）实施。

## 已确认决策（站长 2026-10-18）
1. 2 级功能封禁能力项**按项勾选**（上传/评论/论坛发帖/下载四项，处罚记录存能力集快照）
2. 3 级直接封禁支持**永久 + 限时可选**（30~360 天，到期自动解封）
3. 公告横幅**手动上下线**（定时发布/自动过期留待后续迭代）
4. 用户主页 IP 仅展示**省份地区**（登录时采集 IP→离线解析省份→只存省份不存明文）
5. 「公告」命名保留不变；公告管理权限默认 super + news_editor
6. 处罚公开展示样式：个人主页状态卡，配色沿用三色体系（淡蓝/淡紫/深蓝）

## What Changes

### 模块一：三级处罚体系（后端）
- penalties 表语义升级为三级：**L1 警告**（不限制能力、主页公开展示、可撤销仅超管）、**L2 功能封禁**（按项勾选 2~4 项能力、30~360 天、可解除）、**L3 直接封禁**（账号封禁、永久或限时、登录拦截）
- **BREAKING（数据语义）**：存量记录一次性迁移——旧 L1（限制上传）→ L2 + capabilities=["upload"]；旧 L2（封禁账号）→ L3；迁移以 capabilities IS NULL 为幂等条件，新代码创建记录必写 capabilities
- penalties 表加列：`capabilities TEXT`（JSON 数组快照）、`revoked_at TEXT`、`revoked_by TEXT`
- users 表加列：`banned_until TEXT`（L3 限时解封）、`region TEXT`（省份，登录采集）、`can_ban_manage INTEGER DEFAULT 0`（封禁管理权限项）
- L2 执法点（检查活跃 L2 处罚 capabilities，expires_at 过期自动失效，无需定时任务）：
  - 上传三路径 403（扩展现有 checkUploadBan → checkPenaltyCap('upload')）
  - 发评论/论坛回复 403 COMMENT_BANNED
  - 论坛发帖 403 FORUM_POST_BANNED
  - 下载原图（?download=1）403 DOWNLOAD_BANNED
- L3 执行：写 banned_at + banned_until（限时），deleteUserSessions 强制下线；loadAuthUser 与登录链路检查（banned_until 过期自愈清除后放行）
- 新端点：`POST /api/admin/penalties/:id/revoke`（L1 仅 super；L2/L3 解除并清除 users 表效果 + 通知用户，挂人机验证门）
- 现有 `POST /api/admin/users/:id/penalty` 升级：level 1/2/3、L2 capabilities 必填至少一项、L2 days 必填 30~360、L3 days 可选（空=永久）、reason 必填、人机验证门、处罚产生通知
- 处罚历史端点扩展返回 capabilities/revoked 状态

### 模块二：封禁操作界面（前端）
- 新建管理端「用户封禁管理」页 `/admin/bans`：搜索用户 → 处罚表单（原头像展示、原因必填、L2 能力四项勾选、L2 期限 30~360 天选择、L3 永久/限时切换）→ **多重确认弹窗**（至少二次确认，展示处罚摘要）
- 入口调整：
  - UsersPage 列表行内**移除**直接处罚对话框，改为「处罚管理」按钮跳转 `/admin/bans?userId=xxx`
  - 审核界面（PhotoDetailPage）与申诉界面（AppealsPage）新增「处罚该用户」快捷跳转
  - 封禁管理页挂 `can_ban_manage` 权限门（super/zone_master 默认拥有）
- 用户权限项展示扩至 7 项（上传/查看/下载/点赞/封禁管理 + 既有项），AdminsPage 权限矩阵同步
- 撤销/解除操作在「用户封禁管理」页处罚历史中提供（L1 撤销按钮仅 super 可见）

### 模块三：公开用户主页（前后端）
- 新建公开页 `/users/:id`：状态标签（省份地区、加入天数、作品总浏览数、处罚状态标签）、已通过作品按分区（航空/铁路/公路）分组展示（点击跳详情页，原图访问控制由详情页既有逻辑承担）、论坛发帖记录列表
- 处罚公开卡：活跃 L1/L2/L3 处罚展示等级徽章+原因+期限（L2/L3 含到期时间），已撤销不展示；配色三色体系
- 本人访问自己主页：额外展示未通过/待审核计数并链接「我的作品」（未通过作品不对他人公开，符合「未审核照片不得公开」红线）
- 新公开端点（120/min 限速）：`GET /api/users/:id/profile`（昵称/头像/省份/加入天数/活跃处罚公开信息/作品统计）、`GET /api/users/:id/photos`（仅 approved，分页+分区筛选）、`GET /api/users/:id/threads`
- IP 采集：登录/注册成功时取 X-Forwarded-For 首段 → 离线 IP 库解析省份（无外部网络请求，解析失败存「未知」）→ 写 users.region，不落明文 IP

### 模块四：公告横幅（前后端）
- 新表 announcements：id/title/content/cover_url(可空)/is_active/created_by/created_at/updated_at
- 管理端「公告管理」页 `/admin/announcements`：CRUD + 上线/下线切换（手动），super 与 news_editor 可管理；封面图支持填写图片 URL（可留空，OSS 直传后续迭代增强）
- 公开端点：`GET /api/announcements`（仅 is_active，按 created_at 倒序，120/min）
- 前端 TopBanner 组件：站点顶部、Header 上方；展示封面图+标题+正文，多条时列表展开；右上角可关闭/展开，关闭状态按公告 id 记忆于 localStorage

### 工程与发布
- api.md 同步全部新端点与新错误码（PENALTY_BANNED 族/403 BAN_MANAGE_DENIED 等）
- 新增后端集成测试覆盖三级处罚/执法四点/撤销权限/到期自愈/主页公开端点越权/公告 CRUD/省份解析 mock
- 版本 V4.0.0-beta → **V4.1.0-beta**（向后兼容新功能，MINOR+1），三处同步

## Impact
- Affected specs: implement-v4-prd（处罚端点语义被本 spec MODIFIED，通知体系复用）
- Affected code:
  - 后端：backend/src/db.ts（迁移）、routes/admin.ts（penalty/revoke）、routes/photos.ts（执法+下载拦截）、routes/comments.ts、routes/adminForum.ts|forum 路由（发帖执法）、routes/auth.ts（L3 限时自愈+IP 采集）、新建 routes/users.ts|announcements.ts、services/notificationService.ts（处罚通知模板）、server.ts（挂载）
  - 前端：新建 admin/BansPage.tsx、admin/AnnouncementsPage.tsx、features/user/PublicProfilePage.tsx、shared/TopBanner.tsx；修改 admin/{UsersPage,PhotoDetailPage,AppealsPage,AdminsPage,Layout,AdminApp,api,types}、shared/{Header,UserContext}、api/client.ts
  - 依赖：backend 新增离线 IP 解析库（ip2region xdb 系，无外部请求）

## ADDED Requirements

### Requirement: 三级处罚体系
系统 SHALL 提供三级处罚：L1 警告（仅展示与通知）、L2 功能封禁（按项勾选上传/评论/论坛发帖/下载，30~360 天）、L3 直接封禁（永久或限时 30~360 天），均须 reason 必填并通知受罚用户。

#### Scenario: L2 按项封禁上传
- **WHEN** 管理员对用户 u1 施加 L2 处罚仅勾选「上传图片」，期限 60 天
- **THEN** u1 上传三路径均 403 且提示解禁时间，u1 点赞/下载/评论不受影响，u1 收到处罚通知，60 天后上传自动恢复

#### Scenario: L3 限时封禁到期自愈
- **WHEN** 用户被 L3 封禁 30 天，第 31 天尝试登录
- **THEN** 登录链路检测 banned_until 已过期，清除封禁状态并正常签发 JWT

#### Scenario: L1 撤销仅超管
- **WHEN** zone_auditor 尝试撤销某 L1 警告
- **THEN** 返回 403；super 撤销成功后该警告不再于用户主页公开展示

### Requirement: 封禁操作界面与多重确认
系统 SHALL 在管理后台提供「用户封禁管理」统一入口（/admin/bans），封禁操作须展示用户头像与账号、原因必填、多重确认弹窗；用户管理列表不得直接执行封禁，审核与申诉界面须提供快捷跳转；未拥有 can_ban_manage 权限的管理员访问须被 403 拒绝。

#### Scenario: 多重确认防误封
- **WHEN** 管理员提交 L3 永久封禁表单
- **THEN** 弹出确认弹窗展示用户昵称/等级/原因/期限摘要，需再次确认方生效，全程不少于两次确认

### Requirement: 公开用户主页
系统 SHALL 提供公开用户主页 /users/:id，展示省份、加入天数、作品总浏览、活跃处罚状态卡（等级/原因/期限）与已通过作品（按分区分组）及论坛发帖记录；未通过作品对非本人不可见。

#### Scenario: 越权与隐私
- **WHEN** 访客请求任一用户的公开主页
- **THEN** 仅返回 approved 作品与公开档案字段，响应不含明文 IP；本人额外可见自己待审/未通过计数链接

### Requirement: 省份采集
系统 SHALL 在用户登录/注册成功时解析来源 IP 为省份（离线库，无外部请求）并写 users.region，仅存省份不存明文 IP，解析失败存「未知」。

#### Scenario: 解析失败兜底
- **WHEN** 登录来源 IP 无法解析省份（内网/库未命中）
- **THEN** users.region 写「未知」，登录流程不受影响

### Requirement: 公告横幅
系统 SHALL 提供站点公告：管理端 CRUD 与手动上下线（super/news_editor），公开端点仅返回已上线公告，前端 TopBanner 位于站点顶部支持关闭/展开且关闭状态本地记忆。

#### Scenario: 下线即隐藏
- **WHEN** 管理员将公告 A 下线
- **THEN** GET /api/announcements 不再返回 A，前台横幅下次拉取后消失

## MODIFIED Requirements

### Requirement: 处罚端点（原 implement-v4-prd 两级处罚）
`POST /api/admin/users/:id/penalty` 升级为三级语义：level 1=警告（不落 users 表效果）、level 2=功能封禁（capabilities 必填 JSON 快照 + days 30~360 → 拦截对应能力）、level 3=账号封禁（banned_at+banned_until，days 可空=永久）。原「L1 写 upload_banned_until」行为废弃，由 L2 capabilities=["upload"] 取代；旧数据一次性迁移（旧 L1→L2+capabilities、旧 L2→L3）。新增 POST /api/admin/penalties/:id/revoke。执法校验由 checkUploadBan 扩展为通用 checkPenaltyCap(cap)。

### Requirement: 用户管理列表交互（原 UsersPage 处罚对话框）
UsersPage 移除行内直接处罚对话框，改为跳转「用户封禁管理」；处罚历史查看保留于封禁管理页。

## REMOVED Requirements

### Requirement: 用户管理列表直接封禁
**Reason**: PRD 2.3 明确封禁仅可在审核界面内执行、列表直接封禁易误操作。
**Migration**: UsersPage 处罚按钮改为跳转 /admin/bans?userId=xxx，功能不丢失仅收敛入口。
