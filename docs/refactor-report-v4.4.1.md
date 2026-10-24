# 全库系统性重构报告（V4.4.1-beta）

- 版本：V4.4.1-beta（PATCH：纯重构 + 性能优化，零接口变更）
- 日期：2026-10-24
- 范围：`backend/src`（Express + better-sqlite3）+ `src`（React 19 + Vite）
- 原则：**100% 零行为变更**——不改接口路径、请求/响应字段、错误码、边界处理与任何可见文案

## 1. 总览

| 指标 | 重构前 | 重构后 | 变化 |
|---|---|---|---|
| 源码总行数（`backend/src` + `src` 的 `.ts/.tsx`） | 41,777 | 40,673 | **-1,104 行（-2.64%）** |
| 文件数 | 174 | 176 | -2 删除 / +4 新增工具模块 |
| 本次 diff | — | — | **+266 / -1,489 行**（净 -1,223） |
| 后端测试 | 26 套件 / 451 用例 | 26 套件 / 451 用例 | 全绿，零回归 |
| 前端测试 | 3 套件 / 19 用例 | 3 套件 / 19 用例 | 全绿，零回归 |
| oxlint | 0 error / 27 warning | 0 error / 26 warning | 死代码删除带来 -1 warning |
| 首包 gzip | 324.9 KB（index-C1etsqS2.js） | **324.12 KB**（index-CKGeJTHo.js） | -0.78 KB |
| 移动端分包 | 7.56 KB | 7.56 KB | 无变化 |

## 2. 调整点明细

### 2.1 后端：重复纯函数收敛（新增 4 个工具模块）

| 新模块 | 导出 | 替代的重复实现 | 等价性 |
|---|---|---|---|
| `backend/src/utils/photoTags.ts` | `parsePhotoTags(raw)` | `routes/photos.ts` 与 `routes/users.ts` 各一份（**2 → 1**） | 逐字符复刻，兼容 JSON 数组与旧空格分隔两种历史存储 |
| `backend/src/utils/optionalAuth.ts` | `getOptionalUserId(req)` | `routes/photos.ts` 与 `routes/users.ts` 各一份（**2 → 1**） | 逐字符复刻；JWT 密钥读取时机与原模块级常量一致 |
| `backend/src/utils/pagination.ts` | `parsePagination(req, {defaultSize, maxSize, sizeParam})` | 5 处手写钳制公式（users / forum / announcements / news×2）+ photos 的 `limit` 变体（**6 → 1**） | 公式逐项等价：`page=max(1,parseInt‖1)`、`size=min(cap,max(1,parseInt‖default))`；默认值/上限/参数名参数化 |
| `backend/src/utils/datetime.ts` | `formatLocalDateTime(input)` | `routes/photos.ts` 与 `routes/admin.ts` 各一份 `YYYY-MM-DD HH:mm` 拼装（**2 → 1**） | 输出模板与本地时区语义完全一致（处罚禁令文案、处罚通知正文） |

未合并并留档的“表面重复”（合并即行为变更）：

- `getClientIp` 共 4 份（`photos.ts` / `forum.ts` / `adminForum.ts` / `auth.ts`）：兜底顺序不同，且 `auth.ts` 额外读取 `x-real-ip` 且不做 split/trim。
- `parsePagination` 与 `routes/notifications.ts` 的内联解析：后者无 `Math.max(1, …)` 钳制（负页码不归一），语义不同。
- 前端 `NotificationPage.formatRelativeTime` 与共享 `formatRelativeDate`：空格与兜底文案不同。

### 2.2 后端：热点路径优化（行为中性）

`photos` 表原仅有 `idx_photos_registration_number`，画廊/主页/待审列表均为全表扫描 + 临时 B-TREE 排序。新增 3 个索引（`CREATE INDEX IF NOT EXISTS`，纯加法 DDL，不改变任何查询结果）：

```sql
CREATE INDEX IF NOT EXISTS idx_photos_status_created ON photos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_user_status    ON photos(user_id, status);
CREATE INDEX IF NOT EXISTS idx_photos_created_at     ON photos(created_at DESC);
```

**量化结果**（生产库副本，N=200 次取中位数，`EXPLAIN QUERY PLAN` 实测）：

| 热点查询 | 重构前 | 重构后 | 提速 | 查询计划变化 |
|---|---|---|---|---|
| 画廊列表 `status='approved' ORDER BY created_at DESC` | 213.4 µs | 47.1 µs | **4.54×** | `SCAN photos + TEMP B-TREE` → `SEARCH … idx_photos_status_created` |
| 公开主页作品 `user_id=? AND status='approved'` | 28.1 µs | 10.1 µs | **2.79×** | `SCAN + TEMP B-TREE` → `SEARCH … idx_photos_status_created` |
| 管理端待审 `status='pending' ORDER BY created_at ASC` | 33.1 µs | 2.1 µs | **15.86×** | `SCAN + TEMP B-TREE` → `SEARCH … idx_photos_status_created` |
| 作品计数 `COUNT(*) WHERE user_id=? AND status='approved'` | 30.2 µs | 3.1 µs | **9.67×** | `SCAN` → `SEARCH … COVERING INDEX idx_photos_user_status` |

说明：当前生产库 `photos` 仅 188 行，绝对耗时在微秒级；提速比主要来自消除全表扫描与临时排序，数据量增长后收益会进一步放大。索引在生产库启动迁移时自动创建，已用 `sqlite_master` + `EXPLAIN QUERY PLAN` 双重确认命中。

### 2.3 前端：格式化函数下沉（`src/shared/utils.ts` 新增 3 个导出）

| 新函数 | 替代的本地副本 | 兜底语义 |
|---|---|---|
| `formatDateTime(iso, fallback='-')` | 4 处 `formatTime`（`admin/AppealsPage`、`admin/NewsPage`、`features/profile/MyAppealsPage`、`features/notifications/NotificationPage`） | 默认 `'-'`；通知中心保持历史的 `''`（调用处显式传参） |
| `formatLongDate(iso)` | 2 处 `formatDate`（`features/news/NewsListPage`、`features/news/NewsDetailPage`） | 非法值返回 `''` |
| `formatDateOnly(iso)` | `features/user/PublicProfilePage` 的本地 `formatDateOnly` | 非法值原样返回入参，输出固定 `YYYY-MM-DD` |

### 2.4 前端：死代码清理

| 项 | 说明 |
|---|---|
| 删除 `src/shared/PhotoUploader.tsx` | 458 行，全仓库零引用（被 `UploadPage` 的历史实现取代后残留） |
| 删除 `src/features/gallery/mockData.ts` | 345 行，全仓库零引用 |
| 移除 `theme === 'dark'` 死分支 **146 处** | `ThemeContext` 中 `theme` 为 `useState<Theme>('light')` 且**无 setter**，恒等于 `'light'`，`dark` 分支与 `isDark` 常量分支永不执行。仅保留实际渲染的 else 分支（逐字保留），并清理对应的 `useTheme` 引入/解构与 `DetailRow` 的 `theme` 属性。涉及 `UploadPage`(15)、`ArticleDetailPage`(39)、`PhotoDetailPage`(38)、`UserProfilePage`(23)、`ProfilePage`(14)、`ColumnList`(11)、`PhotoCarousel`(6) |

> `ThemeProvider` 与 `ThemeContext.tsx` 予以保留（仍负责 `documentElement` 的 `light` class 同步），避免影响 CSS 主题类行为。

## 3. 验证证据

| 验收项 | 命令 | 结果 |
|---|---|---|
| 后端类型 | `cd backend && npx tsc --noEmit` | 0 error |
| 后端测试 | `cd backend && npx vitest run` | **26 套件 / 451 用例全通过** |
| 前端类型 | `npx tsc -b` | 0 error |
| 前端测试 | `npx vitest run --config vitest.fe.config.ts` | **3 套件 / 19 用例全通过** |
| 前端 lint | `npx oxlint` | 0 error / 26 warning（≤ 基线 27） |
| 生产构建 | `npm run build` | 成功，`index-CKGeJTHo.js`，gzip 324.12 KB |
| 重复度复核 | grep | `parsePhotoTags` 定义 1 处、内联分页副本 0 处、前端 `formatTime` 定义 1 处、内联长日期 0 处 |
| 死代码复核 | grep | `PhotoUploader` / `mockData` 全仓库 0 引用 |
| 索引生效 | `sqlite_master` + `EXPLAIN QUERY PLAN` | 3 个索引已创建，4 条热点查询全部命中 |
| 线上冒烟（重启后） | `127.0.0.1:3001` | `/api/photos` 200、`/api/photos/hot` 200、`/api/users/:id/photos` 200（结构不变）、`/api/news` 200、`/api/forum/threads` 200、`/api/announcements` 200、`/api/admin/photos/stats` 401（未带管理员令牌，符合预期） |

## 4. 已知既存事实（非本次回归）

- `/api/photos/stats` 返回 404 `照片不存在`：该端点在 `HEAD` 版本中**并不存在**（`git show HEAD:backend/src/routes/photos.ts` 无 `/stats` 路由），统计端点在管理域 `/api/admin/photos/stats`。冒烟时已交叉确认，与本次重构无关。

## 5. 未采纳的候选（附理由）

| 候选 | 理由 |
|---|---|
| 合并 `getClientIp` 4 份 | 兜底顺序与 `x-real-ip` 支持不一致，合并会改变部分请求的限速/审计取值 |
| 合并 `notifications.ts` 分页解析 | 缺少页码钳制，合并会改变负页码行为 |
| 合并 `formatRelativeDate` 与通知页/帖子项相对时间 | 空格与兜底文案不同，属可见文案变更 |
| 拆分 `admin.ts`(2143) / `ProfilePage`(1898) 等超大文件 | 纯规模拆分无法用现有测试证明零行为变更，收益/风险不成比 |
| 为 `findPhotoByOssKey` 增加内存缓存 | 会引入陈旧数据窗口（照片删除后仍可命中），违反零行为变更 |
| 移除 `ThemeContext` 与 `ThemeProvider` 挂载 | 仍承担根节点 class 同步，删除收益低且可能影响 CSS 主题类 |

## 6. 回滚

- 代码：`git revert <本次提交 sha>` 即完整恢复（单次提交）。
- 索引：`CREATE INDEX IF NOT EXISTS` 为加法变更，保留亦不影响旧代码运行；如需彻底回退，执行 `DROP INDEX idx_photos_status_created; DROP INDEX idx_photos_user_status; DROP INDEX idx_photos_created_at;`。
