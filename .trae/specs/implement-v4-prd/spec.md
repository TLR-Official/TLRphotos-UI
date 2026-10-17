# V4 全模块迭代实施 Spec（通知召回/处罚申诉/论坛/新闻区/关于我们）

> 依据 `docs/prd-v4-iteration.md`（V0.1 草案）与站长四项决策制定。
> 已确认决策：① 本次实施全部四模块；② 处罚与申诉系统一并新建完整体系；③ 通知需要未读角标 + 单条已读 + 全部已读；④ 论坛审核新增独立角色。
> PRD 开放问题默认裁决（可在评审时推翻）：3 分钟召回窗口经 env `RECALL_WINDOW_MINUTES` 可配置（默认 3）；新闻编辑为独立 `news_editor` 角色仅含新闻区权限；「支持我们」做静态占位卡；团队文案留占位待站长提供。

## Why

现有审核工作流缺乏通知触达、误审纠错与社区治理能力：用户无法感知点赞/下载/处罚/申诉结果等事件；审核员误操作 3 分钟后无法撤回；论坛缺乏轻量审核角色；站点缺官方新闻渠道与品牌页。V4 补齐通知与纠错闭环、完善论坛生态、开放官方内容发布、完成品牌展示页。

## What Changes

### 模块一：通知与审核纠错（P0）
- **新增** `notifications` 表与通知服务：类型覆盖 作品被点赞 / 作品被下载 / 作品被评为热门 / 处罚通知（一级/二级）/ 申诉回执（通过/驳回）/ 作品召回通知 / 论坛回复 @提示
- **新增** 通知中心前端页 `/notifications` + Header 头像未读角标（轮询或随路由刷新）+ 单条已读 + 全部已读
- **新增** 处罚系统：`penalties` 表（level 1=限制上传 N 天 / 2=永久封禁），管理员处罚端点（挂人机验证门）+ 处罚即通知；一级处罚写 `users.upload_banned_until`、二级复用 `users.banned_at` 并强制下线；用户上传口校验 `upload_banned_until`
- **新增** 申诉系统：`appeals` 表；用户对 rejected 照片发起申诉、查看我的申诉、**撤回未裁决申诉**；管理员裁决（通过→照片回 approved 并通知 / 驳回→通知含驳回原因与详情页跳转）；正常一次性过审**不发通知**；未过审图片统一删除精修图仅保留预览图的既有规则在申诉全流程继续生效
- **新增** 审核召回：photos 表迁移加 `reviewed_by`/`reviewed_at`（存量 approved 回填 NULL 兼容）；approve/reject 端点记录审核人与时间；召回端点——通过后 ≤`RECALL_WINDOW_MINUTES` 分钟静默撤回回 pending 不通知，超窗必须填原因并推送召回通知（模板按 PRD）；权限：super/zone_master 可召回任意审核员图片，zone_auditor 仅本人；**已确认热门（Hot）图片禁止召回**
- **新增** 管理员「确认热门」操作：photos 表加 `is_hot_confirmed`，确认时推送热门通知（与 V3.2.0 用户意愿 `is_hot` 区分，确认热门以 `is_hot_confirmed` 为准）
- **新增** 分配管理：photos 表加 `assigned_to`；管理员指派/转移待审任务；审核员「我的已处理」列表（工作量可视化）

### 模块二：论坛（P1）
- **新增** 独立角色 `forum_moderator`：仅可删除论坛违规帖子/评论，不进图片审核后台；管理端角色下拉与权限门扩展
- **修改** 板块收敛为 **航空/铁路/公路** 三个大标签（seed 保证存在，管理端板块管理同步约束）；文章类内容（专栏文章）归入相应板块：articles 表加 `board_id`
- **确认** 发帖后置审核（直接发布，无前置拦截——V3.1.0 现状即如此，补测试锁定）
- **新增** 回复 @通知：二级回复被回复人收到通知中心提示

### 模块三：新闻区（P2）
- **新增** `news_editor` 管理角色（仅新闻区管理权限）+ 新闻表：复用/扩展 `articles`（加 `type='news'` 区分专栏，新闻配图走 `news_images` 关联表引用图库 photo_id，记录授权勾选）
- **新增** 新闻编辑端点：创建/编辑新闻（标题+正文+配图），配图仅能从站内图库检索选取（复用照片检索），**禁止本地上传**；选图必须勾选授权确认（承诺不改色彩内容且显著署名）
- **新增** 版权标注规范：新闻详情展示 `@作者名 ©TLRphotos {年} 版权所有`
- **新增** 前台新闻列表/详情页（首批仅航空方向）；页面设计保持现有简约风格

### 模块四：关于我们（P3）
- **新增** `/about` 页面：团队介绍角色卡（创始人/技术/审核/航空审核，文案占位待站长提供）、站点数据（已开站天数按固定开站日常量计算、已入库作品数取 `/photos/stats`）、「支持我们」占位卡（形式待定）
- **修改** Header/Footer 增加关于我们与新闻区入口

### 版本与交付
- 发布 **V4.0.0-beta**（新功能模块群按 PRD 代际命名 V4；预发布标识沿用 `-beta` 规范）；版本三处同步 + api.md 全量同步 + .env.example（`RECALL_WINDOW_MINUTES`）

**BREAKING**：无破坏性 API 变更；但存量 approved 照片 `reviewed_by` 为 NULL，召回权限判断对其降级为「仅 super/zone_master 可召回」。

## Impact

- Affected specs: 无既有 spec 直接冲突；关联 `forum-phase1-nested-comments`（评论体系复用）、`upload-page-redesign`（上传禁令入口）、`zone-gallery-permissions`（角色体系扩展）
- Affected code:
  - 后端：`backend/src/db.ts`（4 张新表 + photos/articles 迁移列）、`backend/src/services/notificationService.ts`（新建）、`backend/src/routes/notifications.ts`（新建）、`backend/src/routes/admin.ts`（召回/热门确认/分配/处罚/申诉裁决/新闻管理）、`backend/src/routes/photos.ts`（点赞/下载触发通知、用户申诉端点、上传禁令校验）、`backend/src/routes/auth.ts`（loadAuthUser 上传禁令）、`backend/src/middleware/adminAuth.ts`（新角色）、`backend/src/routes/forum.ts`（回复通知、板块约束）
  - 前端：`src/shared/Header.tsx`（未读角标）、`src/features/notifications/`（新建）、`src/features/gallery/PhotoDetailPage.tsx`（申诉入口）、`src/features/profile/MyWorksPage.tsx`（申诉/撤回）、`src/admin/`（召回按钮、热门确认、分配管理、处罚/申诉页、新闻编辑器、角色扩展）、`src/features/news/`（新建）、`src/features/about/`（新建）、`src/App.tsx`（路由）、`src/shared/Footer.tsx`
  - 文档：`backend/docs/api.md`、`backend/.env.example`

## ADDED Requirements

### Requirement: 通知中心
系统 SHALL 为每用户提供聚合通知中心，覆盖：作品被点赞、作品被下载、作品被评为热门、处罚通知、申诉回执、作品召回通知、论坛回复 @提示；通知记录触发者、关联对象与时间。

#### Scenario: 点赞触发通知
- **WHEN** 已登录用户点赞他人照片（首次点赞，非取消）
- **THEN** 照片所有者通知中心新增一条「作品被点赞」通知，关联该照片；取消点赞不产生通知

#### Scenario: 未读角标与已读
- **WHEN** 用户存在未读通知
- **THEN** Header 头像下拉显示未读数角标；进入通知中心点击单条标已读；提供「全部已读」按钮一键清零

#### Scenario: 一次性过审静默
- **WHEN** 照片首次审核直接通过
- **THEN** 不发送任何通知（刻意降噪设计）

### Requirement: 处罚系统
系统 SHALL 支持管理员对用户实施一级/二级处罚：一级=限制上传 N 天（可填天数），二级=永久封禁；处罚必须附原因并自动推送处罚通知；二级处罚强制下线现有会话。

#### Scenario: 一级处罚生效
- **WHEN** 管理员对用户实施一级处罚 7 天并填写原因
- **THEN** `users.upload_banned_until` 写入 7 天后时间，处罚记录入库，用户收到处罚通知；期间该用户上传接口返回 403 并提示解禁时间

#### Scenario: 二级处罚封禁
- **WHEN** 管理员实施二级处罚
- **THEN** 复用 `banned_at` 永久封禁语义，强制下线，登录被拒并提示已被封禁

### Requirement: 申诉系统
系统 SHALL 允许用户对被驳回照片发起申诉（附申诉理由），支持查看本人申诉列表与**撤回未裁决申诉**；管理员可裁决申诉：通过则照片回到 approved 并推送通过回执，驳回则推送驳回回执（含原因、可跳转详情页）；申诉全流程沿用「未过审图片删除精修图仅保留预览图」规则。

#### Scenario: 申诉通过回执
- **WHEN** 管理员裁决某申诉为通过
- **THEN** 照片状态回 approved、申诉记录关闭，用户收到通过回执通知

#### Scenario: 撤回申诉
- **WHEN** 用户撤回尚未裁决的申诉
- **THEN** 申诉记录置为 withdrawn，可对同一照片重新发起申诉

### Requirement: 审核召回
系统 SHALL 提供误审召回：召回窗口 `RECALL_WINDOW_MINUTES`（默认 3 分钟，env 可配）内静默撤回（照片回 pending，不通知）；超窗召回必须填写原因并推送召回通知（模板按 PRD）；权限：super/zone_master 可召回任意人审核的图片，zone_auditor 仅限本人审核记录；**已确认热门（is_hot_confirmed=1）图片一律拒绝召回**。

#### Scenario: 窗口内静默召回
- **WHEN** 审核员在通过后 2 分钟内点击召回
- **THEN** 照片立即回 pending、清空 reviewed_by/reviewed_at，无任何通知

#### Scenario: 超窗召回通知
- **WHEN** 通过后 10 分钟召回且填写原因「误判」
- **THEN** 照片回 pending，所有者收到通知：「xxx 您好，您的作品《xxx》于 x 年 x 月 x 日 x 时 x 分被召回重新审核，原因：误判。详情请见『待审核』页面。」

#### Scenario: 热门图片拒绝召回
- **WHEN** 对 is_hot_confirmed=1 的照片调用召回
- **THEN** 返回 400 HOT_NOT_RECALLABLE

### Requirement: 热门确认与分配管理
系统 SHALL 提供管理员「确认热门」操作（记录操作人，推送热门通知，确认后该图禁止召回）；提供「分配管理」：指派/转移待审照片至指定审核员（`assigned_to`），并提供审核员「我的已处理」列表视图。

#### Scenario: 确认热门
- **WHEN** 管理员将某 approved 照片确认热门
- **THEN** `is_hot_confirmed=1` 并通知所有者「作品被评为热门」

#### Scenario: 转移审核任务
- **WHEN** 管理员将待审照片 A 从审核员 X 转移给审核员 Y
- **THEN** `assigned_to` 更新为 Y，操作记录审计日志

### Requirement: 论坛治理
系统 SHALL 收敛论坛板块为航空/铁路/公路三个大标签，文章类内容归入相应板块；发帖保持后置审核直接发布；新增 `forum_moderator` 独立角色，仅可删除论坛违规帖子/评论，不参与图片审核；二级回复产生「回复 @xxx」通知。

#### Scenario: 论坛小审删除评论
- **WHEN** forum_moderator 角色登录管理后台
- **THEN** 仅可见论坛治理入口（帖子/评论删除），图片审核与用户管理等入口不可见；删除操作写入审计日志

#### Scenario: 板块约束
- **WHEN** 访客浏览论坛板块列表
- **THEN** 仅出现航空、铁路、公路三个板块；专栏文章按 board_id 归入对应板块展示

### Requirement: 新闻区
系统 SHALL 提供 news_editor 专用角色的新闻发布能力：新闻=标题+正文+配图（图库选图，禁止本地上传，支持随时更换）；选图必须勾选授权确认（作者承诺允许在不改变图片色彩与内容前提下使用且显著署名）；新闻详情显著标注 `@作者名 ©TLRphotos {年} 版权所有`；首批仅开放航空方向。

#### Scenario: 编辑发布新闻
- **WHEN** news_editor 创建新闻，从图库检索选图 2 张并勾选授权
- **THEN** 新闻入库并引用 photo_id 关联；前台新闻列表/详情可见，详情页展示版权标注行

#### Scenario: 权限隔离
- **WHEN** news_editor 登录管理后台
- **THEN** 仅可见新闻管理入口，图片审核/用户管理/论坛治理均不可见

### Requirement: 关于我们
系统 SHALL 提供 `/about` 页面：团队介绍角色卡（创始人/技术/审核/航空审核，文案占位待站长填充）、站点数据（已开站天数、已入库作品数）、「支持我们」占位卡；Header/Footer 增加入口。

#### Scenario: 站点数据展示
- **WHEN** 访客打开关于我们页
- **THEN** 展示开站天数（固定开站日起算）与已入库作品数（approved 总数，公开接口获取）

## MODIFIED Requirements

### Requirement: 照片审核端点（V3.x 既有）
approve/reject 端点 MUST 记录 `reviewed_by`（管理员 ID）与 `reviewed_at`（ISO 时间）；approve 后的召回行为由「审核召回」需求接管。

### Requirement: 管理员角色体系（V1.x 既有）
角色枚举扩展为 `super` / `zone_master` / `zone_auditor` / `forum_moderator` / `news_editor`；新增角色的权限边界：forum_moderator 仅论坛治理、news_editor 仅新闻管理；二者均不进入照片审核与用户管理；zone_master 创建子账号时不得创建 super/forum_moderator/news_editor。

## REMOVED Requirements

（无移除需求；V3.2.0 `is_hot` 用户意愿字段保留，仅作审核参考）
