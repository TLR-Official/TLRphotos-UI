# 我的作品独立页面 /my-works 实施计划

## 1. 需求摘要

- 修复 Header 头像下拉「我的作品」错误跳转 `/gallery`（总作品集）的问题，改为跳转独立页面 `/my-works`
- 新建 `/my-works` 独立页面：展示当前登录用户上传的**全部**照片（已通过 / 待审核 / 未通过），顶部状态筛选，未通过照片显示驳回理由
- ProfilePage 仪表盘「我的作品」快捷按钮同步指向 `/my-works`（当前跳 `/users/:userId` 公开主页，仅含已通过照片）

## 2. 现状分析（已核实）

| 项 | 现状 | 位置 |
|---|---|---|
| Header 下拉「我的作品」 | `navigate('/gallery')`，跳错目标 | src/shared/Header.tsx L132-L141 |
| ProfilePage「我的作品」快捷按钮 | `navigate('/users/${user?.id}')` 公开主页 | src/features/profile/ProfilePage.tsx L618-L626 |
| ProfilePage「我的照片」标签页 | 已有完整实现：状态筛选按钮组（all/pending/approved/rejected）、三状态卡片（颜色区分）、驳回理由红框展示 | ProfilePage.tsx L1403-L1495 |
| 前端 API 封装 | `getMyPhotos(status?, page, pageSize)` → `/auth/me/photos` | src/api/auth.ts L367-L377 |
| 后端接口 | `GET /api/auth/me/photos` 支持 status 过滤，返回 `rejection_reason` | backend/src/routes/auth.ts L570-L633 |
| 路由表 | 无 `/my-works` 路由 | src/App.tsx L77-L87 |
| 类型定义 | `MyPhoto`（含 status、rejection_reason、thumbnail_path 等）已导出 | src/api/auth.ts L330-L352 |

**结论**：后端零改动；前端复用 `getMyPhotos` + `MyPhoto` 类型 + 现有卡片 UI 模式，新建页面组件并接线两处入口。api.md 无需更新（接口已存在且已文档化）。

## 3. 变更方案

### 3.1 新建 `src/features/profile/MyWorksPage.tsx`

独立页面组件，从 ProfilePage 提取并复用其「我的照片」标签页的实现模式：

- **鉴权守卫**：未登录（`isAuthenticated === false`）时渲染登录引导（按钮跳 `/auth`），不调用接口
- **顶部筛选栏**：全部 / 待审核 / 已通过 / 未通过 四个按钮，选中态 `bg-teal-600 text-white`（沿用现有样式约定）；切换时重新请求
- **数据加载**：`getMyPhotos(statusParam, 1, 50)`；加载中/空态文案沿用现有（"暂无照片，快去上传一些吧！" / "此状态下没有照片"）
- **照片卡片**：与 ProfilePage L1439-L1495 一致的卡片结构：
  - `CachedImage`（`status` + `authToken={token}` 透传，未审核照片可正常加载；`cacheEnabled={photo.status === 'approved'}`）
  - 状态徽章（pending 黄 / rejected 红 / approved 绿）
  - 标题 + 上传日期
  - `status === 'rejected' && rejection_reason` 时红色驳回理由框
  - 标签（最多 3 个）
  - **点击卡片跳详情页** `navigate('/photos/' + photo.id)`（详情接口已支持所有者查看本人未审核照片，photos.ts L305-L389）
- **页头**：标题「我的作品」+ 副标题说明（共 N 张），白底黑字，teal 强调色（遵循全站配色规范，禁止紫色）
- 网格布局 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`，外层容器与 ProfilePage 一致的 max-w 居中

### 3.2 修改 `src/App.tsx`

- import `MyWorksPage`，在 `/profile` 路由后新增：
  `<Route path="/my-works" element={<MyWorksPage />} />`

### 3.3 修改 `src/shared/Header.tsx`（L132-L141）

- 下拉「我的作品」`navigate('/gallery')` → `navigate('/my-works')`

### 3.4 修改 `src/features/profile/ProfilePage.tsx`（L618-L626）

- 仪表盘「我的作品」快捷按钮 `navigate('/users/...')` → `navigate('/my-works')`
- 设置视图内的「我的照片」标签页**保留不动**（数据管理视角仍可用）

### 3.5 类型复用

- `MyWorksPage` 直接 `import { getMyPhotos, MyPhoto } from '../../api/auth'`，不新增类型

## 4. 假设与决策

- 每页 50 张、暂不做分页 UI（与现有 ProfilePage 行为一致；后端接口本身支持分页，后续需要再加）
-  rejected 卡片仍显示驳回理由在卡片内（不改为弹窗），保持与现有视觉一致
- 公开主页 `/users/:userId` 不受影响，仍只展示已通过照片
- 后端、api.md、数据库均零改动

## 5. 验证步骤

1. `npm run lint` 0 error、`npm run build` 通过
2. 本地/生产验证：
   - 未登录访问 `/my-works` → 显示登录引导，不报错
   - 登录后 Header 头像 hover → 下拉「我的作品」→ 进入 `/my-works`，展示全部状态照片
   - 顶部切换 4 个筛选，列表正确变化
   - rejected 照片显示红色驳回理由框（与 ProfilePage 一致）
   - 点击卡片进入详情页（未审核照片所有者可查看）
   - ProfilePage 仪表盘「我的作品」按钮 → `/my-works`
3. Changelog 顶部追加 + 版本号 PATCH+1 → **V1.10.3**（package.json + 版本管理规则同步）
4. 按 Git 推送协议提交推送
