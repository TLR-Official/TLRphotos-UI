# 重构任务清单（V4.4.1-beta）

> 每批完成后立即运行对应测试；任一批次失败即停止并回报，不得带病推进。

## T0 基线与度量固化
- [x] 记录基线：后端 451 / 前端 19 / oxlint 0 error / build hash + gzip 324.9KB / 总行数 41,777。
- [x] 建立重复度基线：`grep` 统计 A1–A7 各副本当前出现次数（用于验收复核）。

## T1 后端纯函数去重（A1–A4）
- [x] 新增 `backend/src/utils/photoTags.ts`（`parsePhotoTags`，实现逐字复刻）。
- [x] 新增 `backend/src/utils/optionalAuth.ts`（`getOptionalUserId`，实现逐字复刻）。
- [x] 新增 `backend/src/utils/pagination.ts`（`parsePagination(req, { defaultSize, maxSize=50, sizeParam='page_size' })`）。
- [x] 新增 `backend/src/utils/datetime.ts`（`formatLocalDateTime`）。
- [x] 替换 `backend/src/routes/photos.ts`：删除 L136-144 / L38-48 / L93-96，分页改 `{ defaultSize: 50, maxSize: 100, sizeParam: 'limit' }`。
- [x] 替换 `backend/src/routes/users.ts`：删除 L35-45 / L58-66 / L71-75，两处调用传 `12` / `10`。
- [x] 替换 `backend/src/routes/forum.ts:44-45`（默认 20）。
- [x] 替换 `backend/src/routes/announcements.ts:99-100`（默认 20）。
- [x] 替换 `backend/src/routes/news.ts:282-283`（默认 20）与 `:347-348`（默认 10）。
- [x] 替换 `backend/src/routes/admin.ts:1492-1496`（处罚通知文案）。
- [x] 验证：`cd backend && npx tsc --noEmit` + `npx vitest run` → 451 passed。

## T2 后端热点索引（C1）
- [x] `backend/src/db.ts` 新增 3 条 `CREATE INDEX IF NOT EXISTS`（status+created_at / user_id+status / created_at）。
- [x] `EXPLAIN QUERY PLAN` 复核三条热点查询命中索引。
- [x] 临时基准脚本（`backend/src/scripts/` 外置或验证后删除）：N=200 次中位数，记录建索引前后耗时。
- [x] 验证：后端全量测试仍 451 passed（索引不得改变结果集）。

## T3 前端格式化下沉（A5–A7）
- [x] `src/shared/utils.ts` 新增 `formatDateTime(iso, fallback='-')`、`formatLongDate`、`formatDateOnly`（含 JSDoc 与等价性注释）。
- [x] 替换 `src/admin/AppealsPage.tsx`、`src/admin/NewsPage.tsx`、`src/features/profile/MyAppealsPage.tsx`（默认 `'-'`）。
- [x] 替换 `src/features/notifications/NotificationPage.tsx`（显式传 `''`）。
- [x] 替换 `src/features/news/NewsListPage.tsx`、`src/features/news/NewsDetailPage.tsx`（`formatLongDate`）。
- [x] 替换 `src/features/user/PublicProfilePage.tsx`（共享 `formatDateOnly`）。
- [x] 验证：grep 确认 7 处本地副本全部移除；`npx oxlint` 0 error。

## T4 前端死代码清理（B1–B3）
- [x] 删除 `src/shared/PhotoUploader.tsx`（458 行）。
- [x] 删除 `src/features/gallery/mockData.ts`（345 行）。
- [x] 清理 `theme === 'dark'` 死分支：`UploadPage.tsx`、`ColumnList.tsx`、`ArticleDetailPage.tsx`、`ProfilePage.tsx`（仅保留 `light` 分支；保留 `ThemeProvider` 与 `App.tsx` 挂载）。
- [x] 验证：`npx tsc -b` 0 error；`npm run build` 成功并记录 hash/gzip。

## T5 全量验证
- [x] 后端：`cd backend && npx vitest run` → ≥451 passed。
- [x] 前端：`npx vitest run --config vitest.fe.config.ts` → ≥19 passed。
- [x] 静态：`npx oxlint` → 0 error；`npx tsc -b` → 0 error。
- [x] 构建：`npm run build`，记录新 hash 与首包 gzip（≤ 324.9KB）。
- [x] 冒烟：`/api/photos`、`/api/photos/stats`、`/api/users/:id/photos`、`/api/forum/threads`、`/api/news` 均 200 且结构不变。

## T6 交付
- [x] 撰写 `docs/refactor-report-v4.4.1.md`：精简统计（删/增行数、文件数）、性能量化（索引前后耗时、构建体积）、逐项调整点说明、不可合并项留档。
- [x] `.ai/context.md` Changelog **顶部**追加：`| 2026-10-24 HH:mm | [refactor] 全库去重与死代码清理（V4.4.1） | backend/src/utils/*、src/shared/utils.ts、src/db.ts |`。
- [x] 版本同步三处：`package.json` → `4.4.1-beta`、`.ai/context.md`、`.trae/rules/版本管理规则.md`（当前版本 + 历史表新增行）。
- [ ] 逐文件 `git add`（禁止 `git add .` / `-A`），提交 `[refactor] 全库重复实现合并与死代码清理 | V4.4.1-beta | 2026-10-24 HH:mm`，推送 `origin main`。
