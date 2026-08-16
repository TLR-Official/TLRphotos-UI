# 分区化作品集与审核权限控制 Spec

## Why

当前系统的图片"分区"（category）字段已存在但未在作品集前端充分使用：画廊页仅有扁平标签筛选，无分区导航；管理后台的分区（zone）为自由文本输入，与管理员审核权限脱节；zone_master 角色无分区过滤，可越权查看所有分区照片。需要将分区作为一等概念贯穿上传、浏览、审核全链路，实现严格的分区隔离审核权限。

## What Changes

### 图片分区参数
- 上传界面分区选择保留现有分类按钮（航空/铁路/汽车），确保 `category` 字段永久写入照片记录
- 后端上传接口校验 `category` 必填，拒绝无分区上传

### 作品集筛选重构
- 画廊页顶部导航栏新增三个分区标签页（对应 tag_categories），点击切换分区
- 画廊页左侧新增标签选择侧边栏，复用上传页的标签选择组件 UI（分类对象卡片 + 属性输入）
- 移除原有顶部扁平标签筛选条（"全部" + 前5个标签按钮）
- 标签选择与分区标签页联动：切换分区时自动加载该分区的标签对象列表
- 选中标签后筛选当前分区下匹配的照片

### 分区管理与审核权限
- AdminsPage 分区字段从自由文本改为下拉选择框，选项来自 tag_categories 列表
- super 创建 zone_master 时：必须选择分区（zone_master 负责管理的分区）
- super 创建 zone_auditor 时：必须选择分区（每位审核员仅负责一个分区）
- zone_master 创建 zone_auditor 时：分区自动继承 zone_master 的分区，前端不可修改
- zone_master 可访问 AdminsPage 但仅能创建本分区 zone_auditor（后端已支持，需前端开放入口）

### 审核权限控制
- 后端 admin 路由对 zone_master 也增加分区过滤（当前仅 zone_auditor 有过滤）
- zone_master 和 zone_auditor 仅能查看/审核本分区照片
- 访问非负责分区照片详情时，返回特定错误码，前端显示"该图片不是你所负责的分区"占位提示
- 管理后台照片列表、照片详情、审核操作均受分区权限控制

## Impact

- Affected code:
  - `backend/src/routes/admin.ts` — 增加 zone_master 分区过滤、分区权限校验
  - `backend/src/routes/photos.ts` — 上传接口校验 category 必填
  - `backend/src/routes/tags.ts` — 新增按分区获取标签对象的接口（如需）
  - `src/features/gallery/GalleryPage.tsx` — 重构为分区标签页 + 标签侧边栏布局
  - `src/features/upload/UploadPage.tsx` — 确保 category 必填校验
  - `src/admin/AdminsPage.tsx` — 分区下拉选择、zone_master 创建入口
  - `src/admin/PhotosPage.tsx` — 非负责分区占位提示
  - `src/admin/PhotoDetailPage.tsx` — 非负责分区占位提示
  - `src/admin/api.ts` — 新增获取分区列表的 API 函数
  - `src/api/tags.ts` — 可能新增按分区+标签筛选照片的接口

## ADDED Requirements

### Requirement: 画廊分区标签页导航
系统 SHALL 在画廊页顶部提供分区标签页导航，每个标签页对应一个 tag_category（航空/铁路/汽车），点击切换当前浏览的分区。

#### Scenario: 用户切换分区标签页
- **WHEN** 用户点击"航空"标签页
- **THEN** 画廊仅显示 category 为"航空"的已审核照片
- **WHEN** 用户点击"铁路"标签页
- **THEN** 画廊仅显示 category 为"铁路"的已审核照片

### Requirement: 画廊标签选择侧边栏
系统 SHALL 在画廊页左侧区域提供标签选择侧边栏，其 UI 结构、交互逻辑与上传页面的标签选择组件完全一致。

#### Scenario: 用户在侧边栏选择标签
- **WHEN** 用户在"航空"分区下选择"波音737"标签
- **THEN** 画廊仅显示航空分区下包含"波音737"标签的照片
- **WHEN** 用户取消选择"波音737"标签
- **THEN** 画廊恢复显示航空分区下所有照片

### Requirement: 分区下拉选择
系统 SHALL 在管理员创建/编辑表单中将分区字段从自由文本输入改为下拉选择框，选项从 tag_categories 表动态加载。

#### Scenario: super 创建 zone_master
- **WHEN** super 创建 zone_master 账户
- **THEN** 表单显示分区下拉选择框，super 必须选择一个分区
- **AND** 提交后 zone_master 的 zone 字段设为所选分区

#### Scenario: zone_master 创建 zone_auditor
- **WHEN** zone_master 创建 zone_auditor 账户
- **THEN** 分区字段自动填充为 zone_master 的分区且不可修改
- **AND** 提交后 zone_auditor 的 zone 字段继承 zone_master 的分区

### Requirement: zone_master 分区过滤
系统 SHALL 对 zone_master 角色也实施分区过滤，确保 zone_master 仅能查看和审核其负责分区的照片。

#### Scenario: zone_master 查看照片列表
- **WHEN** zone_master 访问待审核照片列表
- **THEN** 仅返回该 zone_master 负责分区的待审核照片

#### Scenario: zone_master 访问非负责分区照片
- **WHEN** zone_master 尝试查看非其负责分区的照片详情
- **THEN** 后端返回 403 错误
- **AND** 前端显示"该图片不是你所负责的分区"占位提示

## MODIFIED Requirements

### Requirement: 管理员照片审核权限
zone_master 和 zone_auditor 仅能查看、审核其负责分区（zone 字段对应的 category）的照片。super 角色不受分区限制，可查看所有照片。

#### Scenario: zone_auditor 审核照片
- **WHEN** zone_auditor 访问其负责分区的待审核照片
- **THEN** 正常展示照片详情和审核操作按钮

#### Scenario: zone_auditor 访问非负责分区照片
- **WHEN** zone_auditor 尝试访问非其负责分区的照片
- **THEN** 系统显示"该图片不是你所负责的分区"占位提示
- **AND** 不展示照片内容和审核操作按钮

### Requirement: 上传分区必填
照片上传时 `category` 字段为必填项，后端校验不通过时返回 400 错误。

#### Scenario: 用户未选择分区上传
- **WHEN** 用户未选择分区就提交上传
- **THEN** 后端返回错误"请选择照片分区"
