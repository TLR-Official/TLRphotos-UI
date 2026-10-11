# 论坛第二阶段：实施任务队列

## Task 1: 板块与帖子数据表结构 + 索引 + 默认板块 seed
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-1, AC-2, AC-3
- **Files**: backend/src/db.ts
- **Test Requirements**:
  - (rule) `forum_boards` 与 `forum_threads` 表存在且列结构符合 spec FR-1/FR-4
  - (rule) 索引 `forum_threads(board_id, last_reply_at)` 与 `forum_threads(is_pinned, last_reply_at)` 存在
  - (rule) seed 至少 3 个启用板块且 `sort_order` 升序
- **Notes**: 复用现有 initSchema/seedMockData 模式；表名前缀 `forum_`

## Task 2: 板块路由（公开列表 + 管理员 CRUD）
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-1
- **Files**: backend/src/routes/forum.ts, backend/src/routes/adminForum.ts, backend/src/server.ts
- **Depends on**: Task 1
- **Test Requirements**:
  - (rule) `GET /api/forum/boards` 返回启用板块按 sort_order 升序
  - (rule) `POST/PUT/DELETE /api/admin/forum/boards` 需管理员鉴权，操作写 admin_logs
  - (rule) 删除有帖子的板块返回 409 拒绝

## Task 3: 帖子路由（列表/详情/发帖/点赞）
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-2, AC-3, AC-8
- **Files**: backend/src/routes/forum.ts
- **Depends on**: Task 1
- **Test Requirements**:
  - (rule) `POST /api/forum/threads` 需确权 + Turnstile；title/content/board 校验；写 author_id/author_name
  - (rule) `GET /api/forum/threads?board_id=&sort=&page=` 支持筛选/排序/分页；置顶帖排前
  - (rule) `GET /api/forum/threads/:id` 返回完整信息，浏览数 24h 去重自增（登录按 user_id，匿名按 IP）
  - (rule) `POST/DELETE /api/forum/threads/:id/like` 幂等，维护 like_count

## Task 4: 帖子删除（级联评论/归档/OSS）+ 管理员置顶
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-5, AC-10
- **Files**: backend/src/routes/forum.ts, backend/src/routes/adminForum.ts
- **Depends on**: Task 3
- **Test Requirements**:
  - (rule) `DELETE /api/forum/threads/:id` 本人/管理员可删；级联 DELETE comments/comment_heat/comment_archives + OSS 对象
  - (rule) 高危删除经 Turnstile；管理员操作写 admin_logs
  - (rule) `PUT /api/admin/forum/threads/:id/pin` 切换 is_pinned，列表中置顶帖排前

## Task 5: 前端 forum 类型与 API 封装
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-2, AC-3
- **Files**: src/features/forum/types.ts, src/api/forum.ts
- **Depends on**: Task 2, Task 3
- **Test Requirements**:
  - (rule) Board/Thread 类型与后端契约一致；API 函数覆盖 boards/threads 全端点

## Task 6: 论坛首页 + 板块页
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-11, AC-12, AC-6
- **Files**: src/features/forum/ForumHomePage.tsx, src/features/forum/BoardPage.tsx, src/features/forum/components/*
- **Depends on**: Task 5
- **Test Requirements**:
  - (rule) 首页展示板块导航 + 帖子流（最新/最热切换、分页）+ 板块卡片
  - (rule) 板块页展示该板块帖子列表 + "发帖"按钮（确权可见）
  - (rubric) 视觉一致，375px 无横向溢出。0–2，阈值 ≥1

## Task 7: 帖子详情页（复用 CommentList）
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-4, AC-13
- **Files**: src/features/forum/ThreadDetailPage.tsx
- **Depends on**: Task 5
- **Test Requirements**:
  - (rule) 帖子正文 Markdown 渲染（HTML 过滤）
  - (rule) 下方挂载 `<CommentList subjectType="thread" subjectId={threadId} />`，可发表三级评论
  - (rule) 点赞/浏览计数展示

## Task 8: 发帖页
- **Priority**: medium
- **Status**: pending
- **AC Coverage**: AC-14, AC-2
- **Files**: src/features/forum/NewThreadPage.tsx
- **Depends on**: Task 5
- **Test Requirements**:
  - (rule) 板块下拉 + 标题 + Markdown 正文 + 实时预览
  - (rule) Turnstile 验证门；提交成功跳转详情页
  - (rule) 未确权用户访问跳转 /auth

## Task 9: 路由挂载 + 导航入口
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-11, AC-12, AC-13, AC-14
- **Files**: src/App.tsx, src/components/Header.tsx (or nav)
- **Depends on**: Task 6, Task 7, Task 8
- **Test Requirements**:
  - (rule) 路由 `/forum`, `/forum/b/:boardId`, `/forum/t/:threadId`, `/forum/new` 全部可达
  - (rule) Header 含"论坛"入口

## Task 10: 后端测试 + 前端测试 + 构建 + E2E
- **Priority**: high
- **Status**: pending
- **AC Coverage**: AC-7
- **Files**: backend/tests/integration/forum.test.ts, src/features/forum/*.test.tsx
- **Depends on**: Task 2, Task 3, Task 4, Task 6, Task 7, Task 8, Task 9
- **Test Requirements**:
  - (rule) 后端 vitest 全绿；前端测试全绿；tsc/oxlint/vite build 通过
  - (rule) E2E：登录→发帖→列表可见→详情→L1→L2→L3 平铺→删帖→列表消失
