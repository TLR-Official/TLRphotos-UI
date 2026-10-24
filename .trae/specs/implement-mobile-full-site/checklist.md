# Checklist（移动端全站适配）

## 基础设施
- [x] index.html viewport 含 `viewport-fit=cover`，锁 `user-scalable=no`
- [x] `useIsMobile` / `useIsTouch` Hook 可用，App.tsx 移动端 `/upload` → `/m/upload` 重定向生效
- [x] `/m/*` 路由 React.lazy 分包，桌面端不下载移动页 chunk（MobileUploadPage-sAgRF2Ep.js 7.56KB gzip 独立产物）
- [x] MobileTabBar ≤768px 显示、>768px 隐藏（md:hidden）；中央上传按钮 52px 深蓝实底；未登录点击引导 /auth（带 from）
- [x] 移动端顶部仅 Logo + 通知铃铛（未读角标 blue-700），管理端入口不出现

## 核心页面
- [x] 首页：轮播横滑 Snap 无自动播放（isMobile 短路自动播放 effect）、公告横幅可关闭并记忆、最新入库双列、下拉刷新阈值 70px
- [x] 画廊：分区 Tab 吸顶、标签 Bottom Sheet 70vh 下滑关闭（deltaY>80）、瀑布流双列 aspect-ratio 占位防 CLS、POP 返回还原筛选与滚动（sessionStorage）
- [x] 照片详情：双击 1x↔2.5x、pinch 1x~4x 且 scale>1 时 touch-action:none 锁页面滚动；下载按钮固定底部 bg-blue-600 48px（位于 MobileTabBar 上方）；评论三级平铺「回复 @xxx」+「…」菜单；输入框聚焦 scrollIntoView 防键盘遮挡
- [x] /m/upload 四步全部走通：单文件限制、注册号仅航空必填（自动大写+非法字符过滤）、水印九宫格+三档字号（20/32/48）+透明度滑杆、草稿 localStorage 可恢复、REGISTRATION_REQUIRED 跳回第 2 步定位
- [x] 论坛：帖子流纯文本「x 回复 · x 点赞 · x 浏览」（ThreadListItem 组件化）、无图标 emoji、发帖 Aa 折叠工具条、人机验证内联（Turnstile ≤360px compact 既有）
- [x] 通知中心：未读加粗 + 蓝点、全部已读、related_type 跳转正确（扩展 appeal/penalty/announcement）、处罚类深蓝左边框浅蓝底无大面积红色
- [x] 我的作品：三状态分段控件（h-11 等宽）、驳回理由两行截断 + 审核员展示、申诉 409 置灰「申诉处理中」
- [x] 公开主页：处罚公示卡、省份/加入天数、分区作品、发帖记录（单列无横滑）
- [x] 管理端移动端只读可看（汉堡抽屉导航 + 表格 overflow-x-auto），复杂操作页顶部 MobileReadOnlyNotice 桌面端引导提示

## 设计红线
- [x] 白底黑字、无暗色模式、无紫色残留（全站扫描 violet-/purple- 清零：GalleryPage 热门 chips、PublicProfilePage 处罚徽章、admin 热门徽章共 4 处修复）
- [x] accent=blue-700 统一；下载按钮高对比规范一致（bg-blue-600 白字加粗 48px）
- [x] 热区 ≥44×44px（TabBar 项 64×48、图标按钮 44px、chip min-h-44px、分段控件 h-11）；底部安全区 `env(safe-area-inset-bottom)` 生效（pb-safe / TabBar / 下载栏 / 提交按钮）
- [x] 360/390/430px 三档视口无横向滚动条改造（全部适配以 max-md: 断点落地；待真机抽查复核）

## 工程与回归
- [x] 零新增后端接口；api.md 备注移动端 page_size 差异（V4.4.0-beta 备注块）
- [x] PWA：manifest.json + icon.svg + sw.js 仅静态资源 cache-first（/api/ 放行），https 注册
- [x] 后端 26 套件 451 用例全绿；前端 oxlint 0 错误；build 通过且首包 gzip 324.9KB ≤350KB
- [ ] chrome-devtools 移动仿真实测 A1/A2/A3/A6 路径通过（留待部署后线上实测）
- [ ] 版本三处同步 V4.4.0-beta，Changelog 顶部追加，提交推送并部署验证（进行中）
