# Tasks（移动端全站适配）

> 依据 `docs/prd-mobile-full-site.md` 与本目录 spec.md。执行顺序按依赖排列；标注 [P] 的任务可并行。

## Wave 0：基础设施

- [x] Task 0.1: viewport 与全局 CSS 基座
  - `index.html`：viewport `width=device-width, initial-scale=1, viewport-fit=cover`；锁 `maximum-scale=1, user-scalable=no`（配合手势白名单）
  - `src/index.css`：安全区变量、`100dvh` 工具类、移动端排版阶梯（20/16/14/12/11px）、8px 间距体系工具类
- [x] Task 0.2: 移动端探测 Hook 与分流
  - 新建 `src/shared/useIsMobile.ts`：`matchMedia('(max-width: 768px)')` + 变更监听；`useIsTouch.ts`：`'ontouchstart' in window` / `pointer: coarse`
  - `src/App.tsx`：`/upload` 命中移动端时 `<Navigate to="/m/upload">`；新增 `/m/*` 路由（React.lazy + Suspense 分包）
- [x] Task 0.3: 移动端导航骨架
  - 新建 `src/shared/MobileTabBar.tsx`：底部 5 项主导航（中央凸起上传按钮、未登录跳 /auth、安全区 padding、激活态深蓝）
  - 改造 `src/shared/Header.tsx`：≤768px 收敛为 Logo + 通知铃铛（未读角标保留）；管理端入口移动端隐藏
  - 新建 `src/shared/MobileBackHeader.tsx`：二级页返回栏（左箭头 + 标题 + 至多 1 个动作位）

## Wave 1：核心浏览链路 [P 依赖 Wave 0]

- [x] Task 1.1 [P]: 首页响应式（`src/features/column` 或首页组件）：公告横幅 48px 可关闭、热门轮播横滑 Snap（卡宽 85%、无自动播放）、分区入口三卡、最新入库双列网格、下拉刷新
- [x] Task 1.2 [P]: 画廊响应式（`src/features/gallery/GalleryPage.tsx`）：分区 Tab 吸顶（44px 下划线选中）、热门标签 chips 横滑 + 「全部标签」Bottom Sheet 抽屉（70vh 下滑关闭）、双列瀑布流按宽高比占位防 CLS、筛选/滚动位置记忆
- [x] Task 1.3 [P]: 照片详情响应式（`src/features/gallery/PhotoDetailPage.tsx`）：图片双击/pinch 缩放（缩放时锁页面滚动）、底部固定下载按钮（bg-blue-600 48px + 安全区）、数据行纯灰文本、评论区三级平铺 + 长按/「…」操作、评论输入框键盘顶起处理、左右滑切上/下一张（列表语境内）
- [x] Task 1.4 [P]: 搜索/标签聚合/推荐页响应式：三态搜索切换、`/tags` 计数 chips 双列网格

## Wave 2：独立移动上传页（依赖 Wave 0）

- [x] Task 2.1: `/m/upload` 分步表单骨架（新建 `src/features/upload/mobile/`）：步进条（4 圆点）+ 每步通栏「上一步/下一步」+ localStorage 草稿（仅存元数据）
- [x] Task 2.2: 第 1 步选图（相册/拍照 `<input type="file" accept="image/*">` 单文件）+ 第 2 步填信息（标题/描述必填、分区三选一卡、标签 chips、注册号仅航空必填自动大写、热门意愿勾选）
- [x] Task 2.3: 第 3 步水印简化版（九宫格位置 + 小/中/大三档字号 + 透明度滑杆，预览复用 scaleFactor 同源逻辑，文案固定 TLRphotos）+ 第 4 步确认提交（摘要卡 + OSS 直传进度遮罩 + 断网指数退避 3 次）
- [x] Task 2.4: 异常链路：400 REGISTRATION_REQUIRED 跳回第 2 步定位；403 HUMAN_VERIFICATION_REQUIRED 复用人机验证弹窗；文件超限前端拦截

## Wave 3：互动与个人链路 [P 依赖 Wave 0]

- [x] Task 3.1 [P]: 论坛四页响应式（`src/features/forum/`）：板块卡单列、帖子流纯文本统计、详情楼主卡 3px 深蓝左边框 + 三级平铺、发帖页 Markdown 工具条折叠 + 内联人机验证
- [x] Task 3.2 [P]: 通知中心（`src/features/notifications/`）：未读加粗 + 蓝点、全部已读、滚动加载、related_type 跳转、处罚类深蓝左边框浅蓝底
- [x] Task 3.3 [P]: 我的链路（`src/features/profile/`、`src/features/user/`）：/profile 聚合页、/my-works 三状态分段控件 + 驳回理由 + 申诉按钮置灰态、/users/:id 处罚公示卡与分区作品、/my/appeals 状态卡
- [x] Task 3.4 [P]: 认证/新闻/关于我们（`src/features/auth/`、`news/`、`about/`）：Turnstile compact ≤360px、新闻封面 16:9 + 版权标注、关于我们团队卡
- [x] Task 3.5: 管理端只读适配（`src/admin/`）：列表/详情移动端可查看，复杂操作显示「请使用桌面端处理」提示条

## Wave 4：PWA 与收尾

- [ ] Task 4.1: PWA 基础：`public/manifest.json` + 图标（192/512）+ Service Worker 仅静态资源缓存 + index.html 注册
- [ ] Task 4.2: 新手引导与功能提示（localStorage `tip_` 前缀、每条最多 3 次）：首页单屏浮层、上传页提示条、注册号常驻灰字提示
- [ ] Task 4.3: 全量回归与验收
  - 后端：26 套件 451 用例全绿（零后端改动，防回归）
  - 前端：oxlint 0 错误、`npm run build` 通过、确认 `/m/*` chunk 独立分包且首包 gzip ≤350KB
  - 视口验收：360/390/430px 三档 19 页无横向滚动条；热区抽查 ≥44×44px；无紫色残留、论坛无 emoji
  - 浏览器实测（chrome-devtools 移动仿真）：A1 未登录浏览、A2 注册登录、A3 上传全链路、A6 下载
- [ ] Task 4.4: 版本发布：三处同步升级 V4.4.0-beta（package.json / .ai/context.md Changelog / 版本管理规则.md）+ api.md 备注移动端 page_size 差异 + 提交推送 + 部署验证

## Task Dependencies

- Wave 1/2/3 全部依赖 Wave 0（0.1~0.3）
- Task 2.2/2.3/2.4 依赖 2.1；Task 4.x 依赖对应 Wave 完成
- Task 4.4 依赖全部前置任务
