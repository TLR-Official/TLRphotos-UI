# 论坛系统第一阶段：三级嵌套评论 - Implementation Plan

> 每个任务的实现与测试同批完成；TR 均为可独立观察的条件。版本号：本变更移除旧评论端点并重建 comments 表，属 API 破坏性变更，发布时升级 **V3.0.0**。

## Task 1: 数据库通用评论结构与历史迁移
- **Status**: `completed`
- **Evidence**: migration-v3.test.ts（空库基线 3 用例）+ migration-v3-legacy.test.ts（旧评论迁移 5 用例）共 8 用例通过；修复基线索引在旧表上创建失败的问题（探测改名前置到基线 DDL 之前），迁移支持中断恢复。
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 db.ts 基线中以通用 `comments` 表替换旧单层结构：`id, subject_type, subject_id, root_id, parent_id, depth, user_id, author, reply_to_user_id, reply_to_user_name, content, like_count, created_at`；建索引 `(subject_type,subject_id,created_at)`、`(root_id)`、`(parent_id)`。
  - 新增 `comment_likes(comment_id,user_id,created_at)`、`comment_heat(root_id,reply_count,like_count,score,velocity,tier,last_calc_at,retain_until,pinned)`、`comment_archives(root_id,subject_type,subject_id,oss_key,archived_at,root_created_at,reply_count,heat_tier,last_reply_at,rehydrated_at)`。
  - `photos` 表幂等补 `comment_count` 列。
  - 存量迁移：备份后将旧 `comments` 重命名留存，建表后逐条迁移为 article 型 L1（root_id=新 id、depth=1、user_id 空、沿用 author/content/created_at），初始化 heat，回填 articles.comment_count；迁移幂等。
- **Acceptance Criteria Addressed**: AC-9（为 AC-1/AC-2 提供结构基础）
- **Test Requirements**:
  - `rule` TR-1.1: 全新库初始化后，4 张评论表/索引/photos.comment_count 均存在；旧结构 comments 不再出现；证据：db 结构查询测试。
  - `rule` TR-1.2: 含 N 条旧评论的库迁移后产生 N 条 article L1，作者/内容/时间逐条一致、heat 初始化、计数回填；证据：迁移集成测试。
  - `rule` TR-1.3: 迁移生成 .bak 备份且重复启动不重复迁移、不丢数据；证据：二次执行断言。
- **Notes**: 与现有 migration-v2 测试兼容，必要时更新其断言。

## Task 2: 启发式热度评分服务
- **Status**: `completed`
- **Evidence**: commentHeatService.test.ts 14 用例通过 —— 三档确定性划分、retain_until 精确计算（normal/viral 锚发布时间、hot 滚动 +7 天、降档回锚）、纯函数稳定性、env 阈值/天数覆盖与非法值回退、pinned 不归档、DB 聚合 upsert 保留 pinned、pin/unpin 与错误码。
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 新建 commentHeatService：由回复数、全楼点赞数、时间衰减计算热度分；以近 48h 增量算增速并线性外推预测；输出 normal/hot/viral 三档与 retain_until；hot 滚动 +7 天、viral 365 天、pinned 不受期；支持 pin/unpin；阈值/天数/当前时间可注入。
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `rule` TR-2.1: 三组确定性信号分别得到 normal/hot/viral，retain_until 计算与续期规则精确匹配；pinned 线程不归档；证据：单元测试。
  - `rule` TR-2.2: 同输入重算结果稳定（纯函数特性），env 覆盖阈值后档位相应变化；证据：单元测试。

## Task 3: 评论领域服务（三级守卫/树组装/点赞/删除）
- **Status**: `completed`
- **Evidence**: comments.test.ts 17 用例通过（三级封顶连续5次再回复、跨主题/不存在 parent/非法参数拒绝、分页25条、最热排序、单楼101条截断与二次加载、点赞幂等与热度联动、删除权限四种路径、归档网关调用/失败保留、回迁网关一次调用）；commentTree.ts 纯算法 + commentTree.test.ts 6 用例通过。
- **Priority**: high
- **Depends On**: Task 1, Task 2
- **Description**:
  - 新建 commentService：主题存在性校验（photo/article）；创建评论时解析 parent、计算 root/depth/reply_to，depth=3 再回复保持 3 且永不产生 depth=4；创建后增量更新计数与热度。
  - 列表：L1 分页（默认 20，最新/最热排序）+ 单楼回复（上限 100，超出二次加载）；返回树构建所需全部字段。
  - 点赞/取消（幂等）并联动 like_count 与热度；删除：本人或管理员，L1 整楼、L2/L3 单条；归档线程的删除与 OSS 对象联动调用归档服务。
  - 新建树算法工具：buildCommentTree / flattenTree / depth 守卫。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-10, AC-8（领域部分）
- **Test Requirements**:
  - `rule` TR-3.1: L1→L2→L3→连续再回复 5 次，全部节点 depth≤3、root/parent/reply_to 正确；跨主题/不存在 parent/孤儿 parent 拒绝；证据：领域+集成测试。
  - `rule` TR-3.2: 分页、排序、单楼 100 条截断与二次加载结果正确；证据：集成测试。
  - `rule` TR-3.3: 点赞/重复/取消计数正确且热度被触发重算；证据：集成测试。
  - `rule` TR-3.4: 非作者删除被拒；本人删单条/删整楼范围正确；管理员路径可执行；证据：集成测试。

## Task 4: 归档存储抽象与归档/回迁服务
- **Status**: `completed`
- **Evidence**: comment-archive.test.ts 10 用例通过（超期归档对象/索引/计数、hot/viral/pinned 不归档、回迁原样恢复+真实服务追加回复、回迁幂等、上传后中断重跑、上传失败零变更、篡改负载拒绝、并发作业锁、签名 URL、已归档 L1 删除）；新增 ICommentArchiveStore + OSS 实现，ossService 补 getObjectBuffer/objectExists；TR-4.4 证据=故障注入覆盖+结构化日志，待独立评审打分（threshold >=4）。
- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - 定义 ICommentArchiveStore（put/get/delete/exists），OSS 实现复用现有凭证与 `comments-archive/` 前缀；为 ossService 补充对象读取/存在性校验最小能力。
  - 新建 commentArchiveService：每日选出 created_at/ retain_until 超期的非 pinned 线程，先上传 JSON（含版本号）→校验存在与大小→写 comment_archives→删本地行；回迁：拉取 JSON→结构与主题校验→原样写回（保留 id/时间戳）→标记索引；作业锁防重入、全流程幂等。
  - 存储后端与时钟均可注入，测试不触真实 OSS。
- **Acceptance Criteria Addressed**: AC-4, AC-6, AC-12
- **Test Requirements**:
  - `rule` TR-4.1: 超期非热门线程归档后：存储对象内容与线程一致、索引写入、本地行清零；热门/极热/pinned 不归档；证据：生命周期集成测试（注入假存储）。
  - `rule` TR-4.2: 回迁后行数/id/时间戳与归档前一致且新回复可追加，索引标记 rehydrated；证据：集成测试。
  - `rule` TR-4.3: 作业中断（上传成功后失败、删行中途失败）重跑不产生重复/丢失；并发调用被锁拒绝；证据：故障注入测试。
  - `rubric` TR-4.4: 健壮性维度；scale 1-5；anchors 1=失败丢数据/3=异常路径覆盖不足/5=全链路幂等可恢复日志清晰；threshold >=4；证据：测试与日志审查。

## Task 5: 评论 API 路由、管理端点与定时作业挂接
- **Status**: `completed`
- **Evidence**: comments-api.test.ts 24 用例通过（参数校验 400、匿名 401、未确权 403、主题/parent/评论 404、三级封顶 HTTP 全链路、点赞幂等、非作者/人机门/本人删除、归档 URL 404/200、管理员 pin/unpin+审计、管理员删除+审计、旧端点 404）；TR-5.3 证据=server.ts scheduleArchiveJob（启动延迟 30s 一次 + 24h interval、timer 优雅退出清理）+ 作业锁测试，待独立评审核验；后端 build 通过。
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**:
  - 通用路由：`GET /api/comments`（subject_type/subject_id/page/sort）、`POST /api/comments`、`GET /api/comments/:rootId/replies`、`POST|DELETE /api/comments/:id/like`、`DELETE /api/comments/:id`（本人或管理员，删除统一下发 Turnstile 门，测试 tokens 旁路同现网口径）、`GET /api/comments/archives/:rootId/url`（签名 URL）。
  - 管理端点：管理员删除任意评论（admin_logs 留痕）、`PUT /api/admin/comments/:rootId/pin` 与 unpin。
  - server.ts 挂接路由，并按现有定时模式挂载每日归档作业（启动即跑一次 + 24h 间隔）。
  - 移除 articles.ts 中旧 GET/POST /:id/comments 端点。
- **Acceptance Criteria Addressed**: AC-2, AC-4, AC-5, AC-8, AC-10
- **Test Requirements**:
  - `rule` TR-5.1: 全部新端点鉴权、参数校验、状态码/错误码（AUTH_REQUIRED/EMAIL_VERIFICATION_REQUIRED/400/404/409）符合契约；旧评论端点已移除；证据：集成测试与路由清单。
  - `rule` TR-5.2: 签名 URL 端点对存在归档返回可读取 URL、不存在返回 404；管理员 pin/unpin 与删除留审计；证据：集成测试。
  - `rule` TR-5.3: 每日作业由服务启动调度且单实例执行；证据：启动日志与定时调度测试。

## Task 6: 前端评论数据层与可复用模块
- **Status**: `completed`
- **Evidence**: src/api/comments.ts（主题参数化 7 端点）、src/utils/commentTree.ts（同构树算法，8 单测）、commentCache.ts（IndexedDB，4 单测）、useComments.tsx（18 项中 6 Hook 测试）、useArchivedThread.ts、六大组件全部落地；vitest.config.ts + test script，18 前端测试通过，tsc/lint 0 error。
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - 新建 src/api/comments.ts（主题参数化全部端点）与类型；树算法迁移为前端共享 util。
  - 新建 IndexedDB 缓存模块（版本化 key、TTL、失效重取）；hooks：useComments（分页/排序/发表/回复/点赞/删除统一状态）、useArchivedThread（索引→签名 URL→云读→缓存）。
  - 组件：CommentComposer、CommentReplyBox、CommentItem、CommentThread（折叠展开）、CommentList（分页/加载/空态/重试）、ArchiveBanner；视觉白底 teal 无 purple 无 dark。
- **Acceptance Criteria Addressed**: AC-3, AC-5, AC-11, AC-13
- **Test Requirements**:
  - `rule` TR-6.1: 建树/平铺输出层级正确，L3 互回平铺并带"回复@用户"；证据：util 单测。
  - `rule` TR-6.2: IndexedDB 命中、云读取、签名失效重取三条路径通过；useComments 的发表/删除/点赞状态流转正确；证据：模块测试。
  - `rubric` TR-6.3: 可复用性维度；scale 1-5；anchors 1=与页面耦合/3=组件可复用但状态层分叉/5=全部主题参数化新场景仅传参；threshold >=4；证据：模块结构审查。

## Task 7: 照片详情页接入评论模块
- **Status**: `completed`
- **Evidence**: PhotoDetailPage 以 subject_type=photo 全宽卡片接入 CommentList（含发布器/归档 Banner/人机门/登录引导）；待 Task 10 浏览器 375px 实测。
- **Priority**: high
- **Depends On**: Task 6
- **Description**: 照片详情页以 subject_type=photo 接入 CommentList + CommentComposer；删除走现有 HumanVerificationModal；未登录交互给出登录引导；移动端无横向溢出。
- **Acceptance Criteria Addressed**: AC-3, AC-13
- **Test Requirements**:
  - `rule` TR-7.1: 照片页可发表三级评论、点赞、删除并看到归档 Banner 流程；证据：浏览器实测。
  - `rubric` TR-7.2: 体验维度；scale 1-5；anchors 1=层级混乱/3=功能完整平庸/5=层级清晰移动端良好；threshold >=4；证据：桌面+375px 宽度实测。

## Task 8: 文章详情页迁移至通用评论模块
- **Status**: `completed`
- **Evidence**: ArticleDetailPage 旧单层评论 UI 与调用全部移除，以 subject_type=article 接入 CommentList；src/api/articles.ts 删除 Comment 类型与 getComments/createComment；代码检索无旧端点残留。
- **Priority**: high
- **Depends On**: Task 6
- **Description**: ArticleDetailPage 移除旧单层评论 UI 与旧 API 调用，以 subject_type=article 接入同一套模块；旧评论以新结构正常展示；清理 src/api/articles.ts 中评论相关导出与类型分叉。
- **Acceptance Criteria Addressed**: AC-3, AC-9, AC-13
- **Test Requirements**:
  - `rule` TR-8.1: 旧迁移评论完整展示且可被回复/管理员删除；新三级交互全部正常；代码中无旧评论端点残留；证据：浏览器实测 + 代码检索。
  - `rubric` TR-8.2: 体验维度；scale 1-5；threshold >=4；证据：桌面+移动端实测。

## Task 9: 契约与配置文档同步
- **Status**: `completed`
- **Evidence**: api.md 评论章节全量重写（层级模型/生命周期/7+2 端点/错误码/管理端点），高危清单补评论删除；.env.example 补 10 个 COMMENT_* 变量均带注释。
- **Priority**: medium
- **Depends On**: Task 5
- **Description**: 更新 backend/docs/api.md：通用评论端点、错误码、归档索引与签名 URL 读取流程、回迁语义、管理端点；更新 .env.example：COMMENT_RETAIN_DAYS、热度阈值/窗口、续期天数、viral 天数等。
- **Acceptance Criteria Addressed**: AC-14
- **Test Requirements**:
  - `rule` TR-9.1: 文档逐路由与代码一致，每个新增 env 均出现在 .env.example 且有注释；证据：文档 diff 与路由/env 清单核对。

## Task 10: 全量回归与端到端实测
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 7, Task 8, Task 9
- **Description**: 后端全套件回归 + build；前端 lint + build；浏览器对照片页/文章页跑通三级评论发布、嵌套渲染、点赞、删除、归档签名读取全流程（含桌面与 375px）。
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5, AC-13
- **Test Requirements**:
  - `rule` TR-10.1: 后端全套件通过、前端 lint 0 error、两端 build 成功；证据：命令输出。
  - `rule` TR-10.2: 两页面端到端流程实测通过并留存记录；证据：浏览器实测记录/截图。

## Task 11: 独立评审通过后生产发布
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 10（且独立评审 R1 结果为 pass）
- **Description**:
  - 生产部署：确认迁移备份已生成 → build → restart tlrphotos-backend → 核对 users/photos/评论计数/归档索引/服务健康。
  - 版本三处同步 V3.0.0（package.json、.ai/context.md、版本管理规则.md），按规范暂存具体文件、提交并推送 main。
- **Acceptance Criteria Addressed**: 覆盖全部 AC 的上线交付
- **Test Requirements**:
  - `rule` TR-11.1: 生产服务 active、新旧接口行为符合契约、页面 HTTPS 200、迁移计数核对一致；证据：部署后核验记录。
  - `rule` TR-11.2: 版本三处一致，commit/push 成功且不含敏感/生成文件；证据：git 与文件核对。
