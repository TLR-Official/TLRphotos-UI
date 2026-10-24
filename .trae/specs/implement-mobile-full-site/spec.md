# 移动端全站适配 Spec

| 项 | 内容 |
|----|------|
| change-id | implement-mobile-full-site |
| 依据文档 | `docs/prd-mobile-full-site.md` V1.0（待评审草案） |
| 目标版本 | V4.4.0-beta（MINOR：新增移动端适配能力，向后兼容） |

## Why

现有 Web 端以桌面浏览器为设计基准，而目标用户（航空/铁路/公路摄影爱好者）的主要场景是拍摄现场手机浏览与即时投稿。站长手稿已明确要求手机端适配。当前全站 19 个页面在小视口下无系统性的移动体验保障。

## What Changes

- **架构**：响应式为主干 + `/m/*` 独立移动页为补充；Nginx 不分流，客户端 `matchMedia('(max-width: 768px)')` + 触摸能力探测分流；`/m/*` 组件动态 `import()` 分包
- **导航**：新增移动端底部主导航（首页/画廊/＋上传/论坛/我的，56px + 安全区），顶部仅 Logo + 通知铃铛；二级页返回栏
- **独立移动页（首期 2 个）**：`/m/upload`（分步表单 4 步：选图→填信息→水印简化版→确认提交）、`/m/photo/:id/edit`（照片编辑移动版，若桌面编辑功能不存在则本期只做上传）
- **响应式改造**：首页、画廊、照片详情、搜索、标签聚合、论坛四页、通知中心、我的作品、申诉、公开主页、个人中心、登录注册、新闻、关于我们、推荐页，全部在 ≤430px 视口无横滑、热区 ≥44×44px
- **交互**：照片详情手势缩放（双击 1x↔2.5x、pinch 1x~4x）、底部固定高对比下载按钮、评论区三级平铺+「回复 @xxx」、下拉刷新（首页/画廊/通知/帖子流）、Bottom Sheet 标签抽屉
- **设计红线延续**：白底黑字无暗色、三色体系（accent=blue-700）、论坛纯文本统计无图标 emoji、上传单文件、注册号仅航空分类必填、水印文案固定 TLRphotos
- **PWA 基础**：manifest.json + 图标 + Service Worker 仅静态资源缓存；无 Web Push（二期）
- **零新增后端接口**：复用 `backend/docs/api.md` 全部契约

### 待确认事项默认采纳（PRD 第十二节，用户可在评审时推翻）

1. 首页热门轮播**不自动播放**（PRD 默认）
2. 不做收藏功能
3. 管理端移动端**首期只读**，复杂操作引导桌面端
4. 移动端水印简化版（九宫格+三档字号+透明度）**采纳**
5. Web Push 确认放二期
6. 审核员展示沿用现状（审核员昵称，V4.2.0 已落地）
7. 底部导航第 5 项命名「我的」

## Impact

- **Affected specs**：本 spec 为新增能力，不修改既有 spec
- **Affected code（前端为主，后端零改动）**：
  - `src/App.tsx`（新增 `/m/*` 路由与移动端分流）
  - `src/shared/Header.tsx`、`src/shared/Footer.tsx`（移动端顶部条/底部导航）
  - `src/features/` 下 gallery、upload、forum、profile、notifications、auth、news、about、user、column 各页面组件
  - `src/index.css`（安全区、视口锁定、移动端排版变量）
  - `index.html`（viewport meta、manifest 链接）
  - `public/`（manifest.json、PWA 图标、sw.js）
  - `backend/docs/api.md`（仅备注移动端 page_size 差异，无契约变更）

## ADDED Requirements

### Requirement: 移动端底部主导航

系统 SHALL 在视口 ≤768px 时显示固定底部主导航（首页/画廊/＋上传/论坛/我的），高 56px + `env(safe-area-inset-bottom)`；「上传」为中央凸起主按钮（直径 52px、深蓝实底），未登录点击引导至 /auth。

#### Scenario: 未登录点击上传

- **WHEN** 未登录用户在移动端点击底部导航中央「上传」按钮
- **THEN** 跳转 /auth 并记忆返回地址，登录成功后回到 /m/upload

#### Scenario: 桌面视口不显示

- **WHEN** 视口 >768px
- **THEN** 不渲染底部主导航，沿用现有 Header

### Requirement: 独立移动上传页

系统 SHALL 提供 `/m/upload` 四步分步表单（选图→填信息→水印简化→确认提交），移动端命中 `/upload` 时重定向至 `/m/upload`；注册号仅在航空分类必填（沿用 V4.1.2-beta.2 规则）；提交走 OSS 预签名直传并显示进度；草稿元数据存 localStorage（不存图）。

#### Scenario: 分步提交流程

- **WHEN** 用户在移动端完成 4 步并提交
- **THEN** 上传成功进入「我的作品-待审核」，过程中断网显示自动重试提示，指数退避 3 次后转人工重试

#### Scenario: 注册号缺失拦截

- **WHEN** 航空分类下注册号为空提交
- **THEN** 跳回第 2 步并定位注册号输入框，红字提示

### Requirement: 照片详情手势与固定下载

系统 SHALL 在照片详情页支持图片双击缩放（1x↔2.5x）与 pinch（1x~4x，缩放时禁页面滚动），下载按钮固定于底部安全栏上方（通栏 bg-blue-600 白字加粗 48px）；评论区三级嵌套移动端平铺为「回复 @xxx」前缀。

#### Scenario: 手势缩放

- **WHEN** 用户在详情页双击图片
- **THEN** 图片在 1x 与 2.5x 间切换，页面其他位置双击不触发缩放

### Requirement: 页面级响应式验收

系统 SHALL 使全部 19 个页面在 360/390/430px 三档视口下无横向滚动条（详情缩放态除外），热区抽查 ≥44×44px，无紫色残留，论坛统计区无图标 emoji。

### Requirement: PWA 基础能力

系统 SHALL 提供 manifest.json 与图标支持「添加到主屏幕」，Service Worker 仅缓存静态资源，不做 API 离线缓存与后台同步。

## MODIFIED Requirements

### Requirement: 全局导航结构

桌面端 Header 保持现状；移动端顶部条收敛为 Logo + 通知铃铛（未读角标 blue-700）；管理端入口不在移动端顶部出现（延续管理后台隔离原则）。

## REMOVED Requirements

无（纯新增能力，桌面端功能零删减）。
