# Tasks

- [x] Task 1: 后端 — 上传接口校验 category 必填
  - [x] 1.1: 在 `backend/src/routes/photos.ts` 上传路由中增加 category 非空校验，为空时返回 400
  - [x] 1.2: 在 `backend/docs/api.md` 中更新上传接口文档标注 category 必填

- [x] Task 2: 后端 — admin 路由增加 zone_master 分区过滤
  - [x] 2.1: 在 `backend/src/routes/admin.ts` 待审核照片列表查询中，对 zone_master 角色也增加 `p.category = ?` 过滤条件
  - [x] 2.2: 在照片详情查询中，对 zone_master 角色也增加分区权限校验（非负责分区返回 403）
  - [x] 2.3: 在审核操作（通过/拒绝）中，对 zone_master 角色也增加分区权限校验

- [x] Task 3: 后端 — 新增分区列表接口
  - [x] 3.1: 在 `backend/src/routes/admin.ts` 中新增 GET /zones 接口返回分区列表（复用 tag_categories 表数据）
  - [x] 3.2: 更新 `backend/docs/api.md` 添加新接口文档

- [x] Task 4: 前端 — AdminsPage 分区下拉选择
  - [x] 4.1: 在 `src/admin/api.ts` 新增获取分区列表（tag_categories）的 API 函数
  - [x] 4.2: 修改 `src/admin/AdminsPage.tsx` 创建/编辑表单，将 zone 文本输入改为 select 下拉框，选项从 API 动态加载
  - [x] 4.3: 当 zone_master 创建 zone_auditor 时，分区字段自动填充 zone_master 的 zone 且禁用修改
  - [x] 4.4: 确保当前登录管理员信息（含 role 和 zone）可被 AdminsPage 获取，用于判断是否为 zone_master

- [x] Task 5: 前端 — 管理后台非负责分区占位提示
  - [x] 5.1: 修改 `src/admin/PhotosPage.tsx`，当照片列表请求返回 403 分区错误时显示提示信息
  - [x] 5.2: 修改 `src/admin/PhotoDetailPage.tsx`，当照片详情请求返回 403 分区错误时显示"该图片不是你所负责的分区"占位提示，不展示照片内容和审核按钮

- [x] Task 6: 前端 — 画廊页分区标签页导航
  - [x] 6.1: 在 `src/features/gallery/GalleryPage.tsx` 顶部新增分区标签页导航栏，从 tag_categories API 加载分区列表
  - [x] 6.2: 实现分区切换逻辑：切换标签页时按 category 过滤照片列表
  - [x] 6.3: 后端搜索/列表接口支持按 category 过滤参数

- [x] Task 7: 前端 — 画廊页标签选择侧边栏
  - [x] 7.1: 将上传页标签选择组件（分类对象卡片 + 属性输入）提取为可复用组件 `TagSelector`
  - [x] 7.2: 在画廊页左侧区域集成 `TagSelector`，根据当前选中的分区加载对应标签对象
  - [x] 7.3: 实现标签选择与照片列表联动筛选：选中标签后过滤匹配的照片
  - [x] 7.4: 移除原有顶部扁平标签筛选条

- [x] Task 8: 构建验证与版本更新
  - [x] 8.1: 运行 `npx tsc --noEmit` 和 `npm run build` 确保无编译错误
  - [x] 8.2: 更新 package.json 版本号（MINOR 版本升级）
  - [x] 8.3: 更新 `.ai/context.md` Changelog 和版本管理规则
  - [x] 8.4: Git 提交并推送

# Task Dependencies
- Task 2 depends on Task 1 (category 必填校验确保数据一致性)
- Task 4 depends on Task 3 (分区列表接口供前端下拉选择)
- Task 5 depends on Task 2 (后端分区过滤返回 403 后前端才能做占位提示)
- Task 6 depends on Task 3 (分区列表接口供前端标签页加载)
- Task 7 depends on Task 6 (标签侧边栏依赖分区标签页切换逻辑)
- Task 8 depends on all other tasks
- Task 1, Task 2, Task 3 可并行执行
- Task 4, Task 5, Task 6, Task 7 在后端任务完成后可并行执行
