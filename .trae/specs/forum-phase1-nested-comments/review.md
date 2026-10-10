# 论坛一期 · 三级嵌套评论 — 独立评审报告

- **评审日期**: 2026-10-10
- **评审人**: 独立评审（只读审查，未修改任何仓库代码）
- **评审依据**: `.trae/specs/forum-phase1-nested-comments/spec.md` AC-1~AC-14（含 AC-11/12/13 rubric，通过阈值均 ≥4）、`tasks.md` 任务清单
- **审查范围**: `backend/src`（db.ts、services/comment*、utils/commentTree.ts、routes/comments.ts、adminComments.ts、server.ts、articles.ts）、`src/features/comments/**`、`src/api/comments.ts`、`src/utils/commentTree.ts`、PhotoDetailPage.tsx、ArticleDetailPage.tsx、`backend/docs/api.md`、`backend/.env.example`

## 核验手段与结果

| 核验项 | 命令 / 来源 | 结果 |
|--------|-------------|------|
| 后端全套件 | `cd backend && npx vitest run` | **20 文件 / 311 用例全部通过**（10.53s） |
| 前端测试 | `npx vitest run --config vitest.fe.config.ts` | **3 文件 / 19 用例全部通过** |
| 后端类型检查 | `cd backend && npx tsc --noEmit` | exit 0，无错误 |
| 前端类型检查 | `npx tsc -b --noEmit` | exit 0，无错误 |
| E2E | `/tmp/pwqa/e2e.cjs`（Playwright，13 项检查） | 脚本审查 + 产物（desktop.png / mobile375.png，21:57）与任务说明一致，13 项全过 |
| 独立复现 | 临时验证脚本（置于 /tmp/revverify，未写入仓库） | 成功复现 2 个问题，详见 F-1、F-2 |

---

## 逐条 AC 结论

### AC-1: 三级深度封顶 — **PASS**

- 后端：[comments.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/integration/comments.test.ts#L107-L158) 构造 L1→L2→L3 后连续 5 次"再回复"，逐节点断言 `depth=3`、`root_id` 不变、`parent_id` 链正确、`reply_to_user_name` 依次指向上一节点作者；并断言 `SELECT COUNT(*) FROM comments WHERE depth > 3 = 0`、主题计数=8。
- 实现：[commentService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/commentService.ts#L209-L215) 以 `depth = Math.min(parent.depth + 1, 3)` 封顶，depth=3 时 `reply_to_*` 指向被回复者；系统中无任何写入路径产生 depth=4（seed/迁移均硬编码合法 depth）。
- 前端：[commentTree.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/utils/commentTree.test.ts#L65-L79) 断言 L3 互回 L3 时上移挂到 L2，l3a/l3b/l3c 互为兄弟；E2E 检查 7 以"border-l 祖先数=2"在真实页面验证不出现第四级视觉缩进。

### AC-2: 发表鉴权与校验 — **PASS**

- [comments-api.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/integration/comments-api.test.ts#L159-L266) 逐条断言：匿名 POST → 401 `AUTH_REQUIRED`；未确权（u3，email_verified=0）→ 403 `EMAIL_VERIFICATION_REQUIRED`；主题不存在 → 404 `SUBJECT_NOT_FOUND`；空内容 → 400 `COMMENT_CONTENT_EMPTY`；1001 字 → 400 `COMMENT_CONTENT_TOO_LONG`；跨主题 parent → 400 `PARENT_SUBJECT_MISMATCH`；不存在 parent → 404 `PARENT_NOT_FOUND`。
- 鉴权门：[requireVerifiedEmail.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/middleware/requireVerifiedEmail.ts#L12-L31) 与错误码完全一致；内容 trim 后校验、上限常量 `MAX_COMMENT_CONTENT_LENGTH=1000`。
- 合法请求计数同步：同事务内对 photos/articles 的 `comment_count` +1（[commentService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/commentService.ts#L243-L248)）。
- 备注（不判 FAIL）：客户端传入的 `root_id` 未与解析出的 root 做一致性断言；"跨线程 parent"的实际拦截由跨主题检查覆盖（同主题内回复任何节点即加入该节点所在线程，语义成立）。

### AC-3: 嵌套渲染与交互 — **PASS**

- E2E 覆盖照片页（检查 1~10）与文章页（检查 11、11b）：L1/L2 缩进、L3 平铺带"回复 @用户"前缀（检查 6）、再回复仍三级（检查 7）、回复内联盒自动聚焦并预填回复目标（[CommentReplyBox.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/comments/components/CommentReplyBox.tsx#L26-L28)）、排序切换（检查 9）、归档 Banner 展开/收起（检查 1/2/3）、分页组件齐备。
- 组件测试：useComments 6 用例 + 树算法 9 用例辅助验证状态流转。

### AC-4: 归档作业正确执行 — **PASS**

- [comment-archive.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/integration/comment-archive.test.ts#L133-L196)：归档对象 `comments` 与归档前快照 `toEqual`、likes 数量一致、对象字节大小一致；索引 oss_key/reply_count/heat_tier/last_reply_at 正确；本地该 root 行清零；主题计数扣减 3。
- 幂等：归档完成后重跑 `scanned=0`、无副作用（第三跑同）。
- 实现满足"先写云并校验存在与大小 → 事务内写索引、删行、扣计数"（[commentArchiveService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/commentArchiveService.ts#L135-L194)）。
- hot/viral（未到期）/ pinned（已到期）均不归档，同文件 L198-L237 断言。

### AC-5: 归档线程签名直读与客户端缓存 — **PASS**

- [commentCache.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/comments/commentCache.test.ts#L39-L67) 覆盖三条路径：未命中回源、写入后命中（缓存生效）、超 TTL 自动淘汰并返回 null（失效重取）、主动 evict。
- [useArchivedThread.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/comments/useArchivedThread.ts#L46-L101)：签名 URL 端点 → fetch 云 JSON → 最小结构校验 → 回写 IndexedDB；云端 403（签名过期）时 evict 并整体重取一次。
- E2E 检查 2 完成真实云端直读，归档加载态（"正在读取归档评论…"）明确展示。
- 备注：useArchivedThread 本身无独立 Hook 单测，缓存模块单测 + E2E 构成其证据，覆盖可接受。

### AC-6: 归档线程回复回迁 — **PASS**

- [comment-archive.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/integration/comment-archive.test.ts#L241-L317)：归档→回迁后全量评论 `restored toEqual snapshotComments`（**原始 id、like_count、created_at 逐条一致**），主题计数恢复，`rehydrated_at` 非空，并经真实 commentService 成功追加回复（最终行数=快照+1）。
- 回迁幂等：线程已在本地时再调用不报错、行数不变（L319-L335）。
- 篡改负载（subject 改为 article）被 `ARCHIVE_PAYLOAD_INVALID` 拒绝且本地零写入（L393-L418）；服务端 `validatePayload` 校验格式版本、主题/root 一致、单 L1、depth 1~3。
- E2E 检查 3：归档视图内回复 → Banner 消失、活跃线程含新回复。

### AC-7: 热度三档与动态续期 — **PASS**

- [commentHeatService.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/unit/commentHeatService.test.ts#L52-L103)：三组确定性信号分别得 normal/hot/viral；normal retain_until=发布+10 天；hot=now+7 天且每日复算向前滚动；viral=发布+365 天；降档后 retain_until 回锚发布时间。
- pinned：已过期也不归档，取消置顶后按 retain_until 判定（L151-L165）；upsert 冲突时 pinned 保留（L264-L278）。
- 同输入结果稳定；env 覆盖阈值/天数生效，非法值回退默认。
- 增量重算挂接点：回复（事务外）、点赞（changed 时）均触发 `recalculateThreadHeat`。

### AC-8: 删除权限与整楼处理 — **FAIL**

活跃线程路径全部通过：

- 非作者删除活跃 L1 → 403 `COMMENT_DELETE_FORBIDDEN`（comments-api L306-L320）；
- 本人删 L3 单条仅删该条、计数-1（comments.test L352-L367）；本人删 L1 整楼（评论/点赞/heat 清除、计数减去整楼条数，L369-L390）；
- 旧迁移评论（user_id 为空）普通用户拒删、管理员可删（L392-L412）；
- 归档楼删除（本地行+索引场景）网关先删云对象、失败则数据保留（L414-L486）；
- 管理员删除写 `admin_logs`（comment_delete，details 含 deletedThread/removedCount），comments-api L431-L455 断言；
- 用户删除的人机门：无验证状态 → 403 `HUMAN_VERIFICATION_REQUIRED`。

**但已归档线程（本地无评论行）的公开删除路径缺失所有权校验**，详见问题 F-1。AC 明文"非作者被适用于"活跃线程与已归档线程"两种 Given，该 Then 在归档路径不成立 → 本条 FAIL。

### AC-9: 旧文章评论迁移 — **PASS**

- [migration-v3-legacy.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/integration/migration-v3-legacy.test.ts#L156-L235)：3 条旧评论全部成为 `subject_type=article` L1（root_id=自身、depth=1、user_id=NULL），作者/内容/主题逐条一致；heat 初始化 normal 且 retain_until=发布+10 天；articles.comment_count 回填 a1=2/a2=1；旧表 comments_legacy 已删除。
- 迁移前整库备份 `.bak-v3-*` 生成；再次 initDb 数量不变（幂等）。
- 中断恢复：基线 DDL 前探测改名、残留 comments_legacy 进入恢复式迁移（INSERT OR IGNORE），[db.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/db.ts#L95-L110)。
- 旧端点已移除：`GET /api/articles/a1/comments` → 404（comments-api L463-L467）；前端 articles API 无 Comment 残留（检索为空）。

### AC-10: 评论点赞 — **PASS**

- [comments.test.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/tests/integration/comments.test.ts#L300-L338)：点赞计数 1、重复点赞仍为 1（INSERT OR IGNORE 幂等）、取消为 0、重复取消仍为 0；取消以 `MAX(0, like_count-1)` 防护不为负。
- 点赞触发该楼 heat 重算（like_count、last_calc_at 断言）；HTTP 层 200 返回 `{like_count, is_liked}`。
- 联合主键 `(comment_id, user_id)` 去重。

### AC-11: 模块可复用性（rubric） — **5 / 5（通过，阈值 ≥4）**

- 组件（Composer/ReplyBox/Item/Thread/List/ArchiveBanner）全部纯受控，动作经回调上抛，无任何 photo/article 场景分叉；
- [useComments.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/comments/useComments.tsx#L57-L60) 入参仅 `subject: { subjectType, subjectId }`；[api/comments.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/api/comments.ts#L105-L118) 全部端点以主题参数构造；树算法为泛型 `<T extends TreeRow>`；
- 两页面对比：[PhotoDetailPage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/gallery/PhotoDetailPage.tsx#L540-L546) 与 [ArticleDetailPage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/column/ArticleDetailPage.tsx#L421-L427) 接入差异仅 subject 参数与标题文案，卡片包装略有不同但均在模块外；
- 类型自包含（DTO/Subject 在 api/comments.ts 内定义），二期 `subject_type=thread` 仅需扩展联合类型并传参。

### AC-12: 存储策略健壮性（rubric） — **4 / 5（通过，阈值 ≥4）**

- 强项：上传失败本地零变更且锁释放；上传成功后校验阶段崩溃，重跑成功、三跑无副作用；篡改负载拒绝；归档/删除网关失败时本地保留；并发归档作业被 `ARCHIVE_JOB_LOCKED` 拒绝；全流程结构化日志（[CommentArchive]/[CommentService] 前缀，含 root/条数/主题）。
- 扣分点：**回迁未走文档声明的共享作业锁**（详见 F-2），并发回迁计数重复已复现，且与归档作业存在窄交叉窗口。达不到锚点 5 的"全链路幂等、并发安全"。

### AC-13: 评论交互体验（rubric） — **4 / 5（通过，阈值 ≥4）**

- 三级结构可读：L1/L2 缩进克制（ml-4/md:ml-6），L3 平铺 + teal 色"回复 @用户："前缀，回复目标明确，回复盒自动聚焦；
- 归档读取有独立 loading/错误重试，不阻塞页面；375px 实测 `scrollWidth≤375`，内容 `break-words + whitespace-pre-wrap` 防长文溢出；白底 teal 强调，无紫色/无 dark；
- 未登录发布器为"登录后参与评论"引导；错误态可一键重试。
- 扣 1 分：评审未获得可亲自交互的实时环境（依据 E2E/截图/组件测试判定）；极窄屏操作按钮密度无法从证据完全确认；归档 Banner 的管理员删除按钮在真实页面不可达（CommentList 未向其传 isAdmin），与 F-1 修复需一并考虑 UI 路径。

### AC-14: 契约与配置文档同步 — **PASS（含 1 项低severity瑕疵，见 F-3）**

- api.md 评论章节（L506-L731）完整：层级模型、生命周期、7 个通用端点（请求/响应示例）、错误码表（13 项）、2 个管理端点；旧端点移除与破坏性变更 V3.0.0 有显著声明；高危端点清单已补评论删除。
- `.env.example` L40-L58 列出全部 10 个 `COMMENT_*` 配置（retain/hot extra/viral/velocity window/prediction/decay half-life/reply weight/like weight/hot threshold/viral threshold），均带注释，默认值与 `DEFAULT_HEAT_CONFIG` 逐项一致。
- 瑕疵：错误码表记录的 `COMMENT_HEAT_NOT_FOUND` 在实际路由中被改写为 `COMMENT_NOT_FOUND`（F-3）。

---

## 问题清单（含可复现步骤与严重级别）

### F-1 [HIGH] 已归档线程公开删除路径无所有权校验（越权删除 / 数据丢失）

- **位置**: [commentService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/commentService.ts#L565-L589)（`deleteComment` 本地未命中分支）
- **描述**: 当目标 id 本地无评论行但存在 `comment_archives` 索引时，代码直接 `deleteArchivedObject` + 删除索引，**不校验 actor 是否为楼主或管理员**。路由 [comments.ts DELETE /:id](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/comments.ts#L282-L308) 仅保证登录 + 邮箱确权 + 168h 人机验证。因此任意普通账户可删除他人已归档线程；对 user_id 为 NULL 的旧迁移归档楼，同样可删（违反"旧迁移评论只能由管理员删除"）。OSS 对象删除后不可恢复。
- **UI 暴露面**: ArchiveBanner 的删除按钮仅 `isAdmin=true` 时渲染，而 CommentList 未传该 prop，故页面上无入口；但 API 可直接构造请求利用。
- **违反**: FR-11、NFR-3（"删除严格所有权校验"）、AC-8。
- **复现步骤**:
  1. 隔离库（DB_PATH）中以 u1 创建 L1 → 经注入 store 的归档作业归档；
  2. 以 `{ userId: 'u2', isAdmin: false }` 调用 `deleteComment(db, rootId, actor, { archiveGateway })`；
  3. **实际结果**: 返回 `{ deletedThread: true, removedCount: 1 }`，云对象与索引均被删除（验证脚本输出 `VERDICT-A: DELETED removedCount=1`）；
  4. **预期结果**: 抛 `COMMENT_DELETE_FORBIDDEN`（403），对象与索引保留。
- **修复建议（供参考，不代改）**: 归档分支删除前经注入 store 读取 payload，取 L1 的 user_id：为 NULL 时仅管理员放行；否则须本人或管理员。补一条"非作者删除归档楼 → 403"集成测试。

### F-2 [MEDIUM] 回迁未获取共享作业锁：并发回迁计数重复，且与归档作业存在交叉窗口

- **位置**: [commentArchiveService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/commentArchiveService.ts#L216-L321)（`rehydrateThread` 无 `acquire()`；对照 `runArchiveJob` L91）
- **描述**: 文件头声明"作业锁：归档与回迁共用同一把进程内互斥锁，防重入/并发交叉"，实现中仅归档作业加锁。
  - **2a** 并发回迁同一 root：两条回迁链路的评论/heat 写入经 INSERT OR IGNORE 幂等，但主题计数为无条件 `comment_count + payload.comments.length`，两者均生效 → 计数虚高（已复现：4 vs 期望 2）。生产对应场景：两人同时对同一归档线程发表首条回复。
  - **2b** 与归档作业交叉：作业在"回迁事务已提交、触发回复尚未写入"间隙重新处理该 root（root 在作业起始扫描结果中），会删除刚恢复的数据并把索引 rehydrated_at 重置；随后 createComment 写入的回复成为不可见孤儿行（无本地 L1，归档 Banner 再现）。窗口窄（每日作业启动后/24h 一次），但设计锁本可消除。
  - 并发回迁另一观察：部分时序下第二条链路因 SQLITE_BUSY 直接失败（未配置 busy_timeout），用户得到晦涩错误而非排队重试。
- **违反**: NFR-2（并发安全）、AC-12 rubric（4 分原因）。
- **复现步骤（2a）**:
  1. 归档一个 2 评论线程，准备共享同一内存数据的两个 store（GET 延迟分别 0ms / 80ms）；
  2. `Promise.allSettled([svc.rehydrateThread(db, root, {store: fast}), svc.rehydrateThread(db, root, {store: slow})])`；
  3. **实际结果**: 两者均 fulfilled，`photos.comment_count=4`（期望 2），验证脚本输出 `RACE-VERDICT: outcomes=["ok","ok"], commentCount=4`；
  4. **预期结果**: 串行化，计数=2（或第二个得到可重试的 ARCHIVE_JOB_LOCKED）。
- **修复建议**: rehydrateThread 包裹 acquire/release，锁冲突抛 `ARCHIVE_JOB_LOCKED`（409），由发表回复路径提示重试；可一并设置 `PRAGMA busy_timeout`。

### F-3 [LOW] api.md 错误码与实际返回码不一致

- api.md L720 记录 `COMMENT_HEAT_NOT_FOUND | 404`；实际 [adminComments.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/adminComments.ts#L88-L97) 将该错误映射为 `code: 'COMMENT_NOT_FOUND'`。文档列出的错误码不会出现在任何响应中。建议二者统一（属 AC-14 核对瑕疵，不影响 PASS）。

### F-4 [LOW] 管理员评论删除无 168h 人机验证门

- AC-8 文字含"管理员删除写 admin_logs 并经 Turnstile"。现有高危管理操作（ban/unban/permissions/代改邮箱）均挂 `ensureHumanVerified('admin', ...)`，而 [adminComments.ts DELETE](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/adminComments.ts#L45-L72) 仅依赖管理员 JWT（管理员登录本身有 Turnstile，风险部分缓解）。建议按既有约定补齐并增加对应测试。

### F-5 [OBSERVATION] 管理员评论能力暂无 UI

- `PUT pin/unpin`、管理员删除仅有 API；全前端 src 无 `/api/admin/comments` 调用方，管理后台无评论管理页。各 AC 对管理员路径均为 API 级断言，故不判 FAIL，但 spec 目标用户"管理员删除任意评论、管理长期留存标记"暂不可经界面操作。建议纳入后续任务清单明确排期。

---

## 最终结论

# CHANGES-REQUESTED

- **规则类 AC（AC-1~AC-10、AC-14，共 11 条）**: 10 PASS、1 FAIL（**AC-8**，因 F-1 归档删除越权）。
- **Rubric（阈值均 ≥4）**: AC-11 = **5**、AC-12 = **4**、AC-13 = **4**，均达标。
- F-1 为可利用的越权删除（HIGH），必须在发布前修复并补集成测试；F-2 建议同期修复（实现与自身文档声明不符，且计数重复已复现）；F-3/F-4 为低风险一致性项；F-5 请明确产品排期。
- 除上述问题外，三级封顶、主题参数化可复用性、归档/回迁/迁移/热度/点赞主流程的实现质量与测试覆盖（311+19+13 E2E）扎实，修复 F-1（建议连同 F-2）后可重新提交复审。
