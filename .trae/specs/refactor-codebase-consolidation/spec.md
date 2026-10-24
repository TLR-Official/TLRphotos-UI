# 全库架构审查与系统性重构规范（V4.4.1-beta）

> 目标：在 **100% 零行为变更** 前提下消除重复实现、死代码与冗余抽象，优化热点路径，并输出可量化的重构报告。

## 1. 目标与边界

### 1.1 目标
1. 消除跨模块重复实现（纯函数、路由样板、前端格式化逻辑）。
2. 删除已确认无引用的死代码模块。
3. 对确认的热点路径做**行为中性**优化（新增 SQLite 索引，不改变任何查询结果）。
4. 保持/提升可读性，补齐必要的等价性注释。
5. 全量测试零回归，输出精简统计与性能量化数据。

### 1.2 明确不做（Out of Scope）
| 项 | 原因 |
|---|---|
| 修改任何 HTTP 接口路径、请求/响应字段、错误码 | 破坏接口契约 |
| 修改 `backend/docs/api.md` | 本次零接口变更，无需同步 |
| 合并 `getClientIp`（4 份） | 四份实现语义**不一致**（见 §4.4），合并即行为变更 |
| 合并 `notifications.ts:30` 的分页解析 | 无 `Math.max(1, …)` 钳制，负页码行为不同 |
| 合并 `NotificationPage.formatRelativeTime` 与 `shared/utils.formatRelativeDate` | 输出文案不同（`N 分钟前` 含空格 / 兜底为纯日期 vs 完整日期时间） |
| 合并 `formatBytes` | 已由 `src/utils/imageCache.ts` 单一导出，无重复 |
| 重写大文件（admin.ts 2143 行等） | 纯规模拆分无法证明零行为变更，收益/风险不成比 |
| 引入缓存层（如 `findPhotoByOssKey` 内存缓存） | 会引入陈旧数据窗口，违反零行为变更 |

## 2. 基线（本轮实测）

| 指标 | 数值 |
|---|---|
| 后端测试 | `cd backend && npx vitest run` → 26 files / **451 passed** |
| 前端测试 | `npx vitest run --config vitest.fe.config.ts` → **19 passed** |
| Lint | `npx oxlint` → **0 errors** / 27 warnings（存量 exhaustive-deps） |
| 构建 | `npm run build` → `dist/assets/index-C1etsqS2.js`，首包 gzip **324.9 KB** |
| 代码规模 | `backend/src` + `src` 共 174 个 `.ts/.tsx`，**41,777 行** |
| HEAD | `edb523f`（= origin/main，工作区干净） |

## 3. 发现清单

### 3.1 A 类：可安全合并的重复实现

| # | 位置 | 重复内容 | 等价性证据 |
|---|---|---|---|
| A1 | `backend/src/routes/photos.ts:136-144` ↔ `backend/src/routes/users.ts:58-66` | `parsePhotoTags(raw): string[]` | 逐字符相同；users.ts 注释自述「与 photos.ts 同口径」 |
| A2 | `backend/src/routes/photos.ts:38-48` ↔ `backend/src/routes/users.ts:35-45` | `getCurrentUserId(req)` 可选 JWT 解析 | 逐字符相同，均以模块级 `JWT_SECRET = process.env.JWT_SECRET \|\| ''` 校验 |
| A3 | `users.ts:71-75`、`forum.ts:44-45`、`announcements.ts:99-100`、`news.ts:282-283`、`news.ts:347-348`、`photos.ts:400-402` | 分页参数解析 `page/page_size(+offset)` | 公式一致：`page=max(1, parseInt‖1)`、`size=min(cap, max(1, parseInt‖default))`；仅默认值/上限/参数名不同 → 参数化 |
| A4 | `backend/src/routes/photos.ts:93-96` ↔ `backend/src/routes/admin.ts:1492-1496` | `YYYY-MM-DD HH:mm` 本地时间格式化 | 输出模板相同：`${Y}-${MM}-${DD} ${HH}:${mm}` |
| A5 | `src/admin/AppealsPage.tsx:54-59`、`src/admin/NewsPage.tsx:21-25`、`src/features/notifications/NotificationPage.tsx:45-49`、`src/features/profile/MyAppealsPage.tsx:25-30` | `formatTime(iso)` = `toLocaleString('zh-CN', { hour12:false })` | 日期输出相同；仅「空值/非法值」兜底不同（`'-'` vs `''`）→ 兜底参数化 |
| A6 | `src/features/news/NewsListPage.tsx:22-26` ↔ `src/features/news/NewsDetailPage.tsx:22-29` | `formatDate` = `toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' })` | 逐字符相同（含 `''` 兜底） |
| A7 | `src/features/user/PublicProfilePage.tsx:42-47` | `formatDateOnly` = 本地时区 `YYYY-MM-DD`（非法输入原样返回） | 全仓库唯一实现，需下沉共享以备复用 |

### 3.2 B 类：死代码（零引用，已交叉核对）

| # | 文件 | 行数 | 证据 |
|---|---|---|---|
| B1 | `src/shared/PhotoUploader.tsx` | 458 | 全仓库 grep `PhotoUploader` 除自身文件外 **0 处**引用 |
| B2 | `src/features/gallery/mockData.ts` | 345 | 全仓库 grep `mockData` **0 处**引用 |
| B3 | `theme === 'dark'` 条件分支（`UploadPage.tsx` 12 处、`ColumnList.tsx`、`ArticleDetailPage.tsx`、`ProfilePage.tsx` 等） | — | `ThemeContext.tsx:30` 为 `useState<Theme>('light')` 且**无 setter**，`theme` 恒为 `'light'`，`dark` 分支永不执行 |

### 3.3 C 类：热点路径（行为中性优化）

| # | 位置 | 现状 | 措施 |
|---|---|---|---|
| C1 | `photos` 表查询 | `db.ts` 仅有 `idx_photos_registration_number`；画廊列表 `WHERE status='approved' ORDER BY created_at DESC`、用户主页 `WHERE user_id=? AND status='approved'`、管理端待审 `ORDER BY created_at ASC` 均无可用索引 | 新增 3 个 `CREATE INDEX IF NOT EXISTS`（与 db.ts 现有迁移风格一致），**不改变任何查询结果** |

### 3.4 D 类：表面重复但不可合并（防误伤，留档）

| 项 | 差异 |
|---|---|
| `getClientIp` ×4（`photos.ts:150`、`forum.ts:18`、`adminForum.ts:20`、`auth.ts:84`） | photos 兜底顺序 `socket → ip` 且处理数组头；forum 兜底 `ip → socket`；adminForum 无 socket 兜底；auth **额外读取 `x-real-ip`** 且不 split/trim。任意合并都会改变某些请求的取值 |
| `parsePagination` ↔ `notifications.ts:30` | 后者无钳制，负页码 → 负 offset |
| `formatRelativeDate` ↔ `NotificationPage:55` / `ThreadListItem:12` | 文案（空格）、兜底、分隔符均不同 |
| `formatBytes` | 单一导出，无重复 |

## 4. 变更设计（决策完备）

### 4.1 后端新增 `backend/src/utils/photoTags.ts`
```ts
export function parsePhotoTags(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return raw.split(' ').filter(Boolean);
  }
}
```
替换：`photos.ts`（删除 L136-144，改为 import；使用点 L381 等）、`users.ts`（删除 L58-66，改为 import；使用点 L181）。

### 4.2 后端新增 `backend/src/utils/optionalAuth.ts`
```ts
export function getOptionalUserId(req: express.Request): string | null
```
实现 = A2 原文（模块级 `JWT_SECRET` 读取时机与两处原实现一致，均在进程启动加载期）。
替换：`photos.ts:38-48`、`users.ts:35-45`。

### 4.3 后端新增 `backend/src/utils/pagination.ts`
```ts
export interface PaginationOptions { defaultSize: number; maxSize?: number; sizeParam?: string; }
export function parsePagination(req: express.Request, opts: PaginationOptions):
  { page: number; pageSize: number; offset: number }
```
公式严格复刻 A3，`maxSize` 默认 50，`sizeParam` 默认 `'page_size'`。替换 6 处：
- `users.ts:161` → `{ defaultSize: 12 }`；`users.ts:208` → `{ defaultSize: 10 }`
- `forum.ts:44-45` → `{ defaultSize: 20 }`
- `announcements.ts:99-100` → `{ defaultSize: 20 }`
- `news.ts:282-283` → `{ defaultSize: 20 }`；`news.ts:347-348` → `{ defaultSize: 10 }`
- `photos.ts:400-402` → `{ defaultSize: 50, maxSize: 100, sizeParam: 'limit' }`

### 4.4 后端新增 `backend/src/utils/datetime.ts`
```ts
export function formatLocalDateTime(input: Date | number): string // YYYY-MM-DD HH:mm
```
替换：`photos.ts:93-96`（传 `new Date(untilMs)`）、`admin.ts:1492-1496`（传 `new Date(iso)`）。

### 4.5 前端 `src/shared/utils.ts` 新增 3 个格式化函数
```ts
export function formatDateTime(iso: string | null | undefined, fallback = '-'): string
export function formatLongDate(iso: string): string      // 2026年1月1日（非法 → ''）
export function formatDateOnly(iso: string): string      // YYYY-MM-DD（非法 → 原样返回）
```
替换点与兜底映射：
| 文件 | 原函数 | 替换 |
|---|---|---|
| `admin/AppealsPage.tsx:54` | `formatTime`（`'-'`） | `formatDateTime`（默认 `'-'`） |
| `admin/NewsPage.tsx:21` | `formatTime`（`'-'`） | `formatDateTime` |
| `features/profile/MyAppealsPage.tsx:25` | `formatTime`（`'-'`） | `formatDateTime` |
| `features/notifications/NotificationPage.tsx:45` | `formatTime`（`''`） | `formatDateTime(iso, '')` |
| `features/news/NewsListPage.tsx:22` | `formatDate` | `formatLongDate` |
| `features/news/NewsDetailPage.tsx:22` | `formatDate` | `formatLongDate` |
| `features/user/PublicProfilePage.tsx:42` | `formatDateOnly` | `formatDateOnly`（共享） |

### 4.6 死代码删除
- 删除 `src/shared/PhotoUploader.tsx`（458 行）。
- 删除 `src/features/gallery/mockData.ts`（345 行）。
- 清理 B3 死分支：仅移除可静态证明永不执行的 `theme === 'dark' ? X : Y` → `Y`，并移除对应 `useTheme` import；**保留** `ThemeProvider`/`ThemeContext` 文件与 `App.tsx` 挂载（避免影响 `document.documentElement` 的 class 同步行为）。

### 4.7 热点索引（`backend/src/db.ts`）
```sql
CREATE INDEX IF NOT EXISTS idx_photos_status_created ON photos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_user_status    ON photos(user_id, status);
CREATE INDEX IF NOT EXISTS idx_photos_created_at     ON photos(created_at DESC);
```
放置于 photos 表初始化后、与 L530 现有索引语句同区域。

## 5. 风险与红线

| 风险 | 控制 |
|---|---|
| 重命名/抽取改变导入路径导致启动失败 | 每批后跑 `tsc` + 全量测试 |
| 兜底文案被无意改变 | §4.5 表格逐项映射，`NotificationPage` 显式传 `''` |
| 死分支清理引入样式变化 | `theme` 恒定 `light`，只保留 `Y` 分支；逐文件 `npm run build` 验证 |
| 索引引入写放大 | 仅 3 个索引，photos 为读多写少；DDL 为 `IF NOT EXISTS` |
| 项目红线 | 不动白底黑字/blue-700/禁 violet/纯文本统计/热区≥44px/安全区；不改 `watermark` 逻辑；不改 `api.md` |

## 6. 验收标准（全部需实测证据）

1. 后端 `npx vitest run` → **≥451 passed，0 failed**。
2. 前端 `npx vitest run --config vitest.fe.config.ts` → **≥19 passed，0 failed**。
3. `npx oxlint` → **0 errors**（warnings 不超过基线 27）。
4. `npx tsc -b` → 0 error；`npm run build` 成功，记录新 hash 与首包 gzip ≤ 324.9 KB。
5. 重复实现计数：A1–A7 全部消除（grep 复核 0 处残留本地副本）。
6. 死代码：B1/B2 文件不存在且 grep 无残留引用。
7. 索引生效：`EXPLAIN QUERY PLAN` 显示画廊列表/用户主页/待审列表查询命中新索引（`USING INDEX`），且返回行数与非索引版本一致。
8. 线上冒烟（`127.0.0.1:3001`）：`/api/photos`、`/api/photos/stats`、`/api/users/:id/photos`、`/api/forum/threads`、`/api/news` 返回 200 且响应结构不变。
9. 交付物：`docs/refactor-report-v4.4.1.md`（精简统计 + 量化数据 + 调整点清单）、`.ai/context.md` Changelog 顶部条目、版本号三处同步 `V4.4.1-beta`、逐文件 `git add` 后提交推送。

## 7. 度量方法
- 代码精简：`git diff --stat` 前后 `wc -l` 差值 + 删除/新增行数。
- 性能：新增 `backend/src/scripts/bench-queries.ts`（临时脚本，验证后移出工作区）对 C1 三条查询各执行 N=200 次取中位数，对比建索引前后。
- 前端体积：`npm run build` 输出的 gzip 数值对比基线。

## 8. 回滚方案
单次提交（或按批次 3 次提交），回滚 `git revert <sha>` 即恢复；索引为 `IF NOT EXISTS` 加法变更，保留亦不影响旧代码运行。
