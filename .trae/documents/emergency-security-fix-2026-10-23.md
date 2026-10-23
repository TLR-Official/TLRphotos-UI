# 紧急安全修复计划：PHP2Shell / React2Shell 排查 + 依赖漏洞修复

## 结论摘要（已完成只读排查）

用户点名的三组漏洞**本站均不受影响**（证据见下）；但 npm audit 在生产依赖中发现 **2 critical + 多处 high** 可修复漏洞，需立即修复。修复路径全部为 `npm audit fix`（非破坏性），全程以最快为准。

## 一、点名漏洞排查结果（不受影响，附证据）

| 漏洞                                                                                            | 影响面                                                                  | 本站证据                                                                                         | 结论                                                                               | <br />  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | :------ |
| **PHP2Shell**（CVE-2026-109618/109619，PHP 核心 RCE，2026-10-21 官方修复，波及 WordPress/Drupal 等 PHP 生态） | PHP 运行时                                                              | 服务器 `which php` 无、\`dpkg -l                                                                  | grep -ci php\` = 0、nginx 配置无 php 处理、无 9000 端口监听；项目为纯 Node.js + Express + React 栈 | **不适用** |
| **React2Shell**（CVE-2025-55182 + Next.js 跟进 CVE-2025-66478 等，RSC Flight 协议反序列化 RCE）           | react-server-dom-webpack/parcel/turbopack ≤19.2.0、Next.js App Router | package.json 无 react-server-dom-\*、无 next；React 19.2.7 经 Vite 纯客户端渲染，无 RSC/Server Components | **不受影响**                                                                         | <br />  |
| PHP 生态连带漏洞（WordPress/Drupal/Composer 包）                                                       | PHP 包                                                                | 同上，全站零 PHP                                                                                   | **不受影响**                                                                         | <br />  |

## 二、npm audit 实测发现（需要修复）

### 后端（16 项：2 critical / 9 high / 3 moderate / 2 low，全部 `npm audit fix` 可修）

* **critical**：`proxy-addr`（IPv4-mapped IPv6 信任子网 IP 欺骗——本站限速/地区解析依赖 XFF 首段，直接相关）

* **high**：`multer ≤2.3.0`（上传 DoS×4 + fileFilter 竞态绕过大小限制——本站上传链路核心）、`sharp ≤0.35.5-rc.1`（libheif/librsvg CVE——本站水印/缩略图核心）、`http-cache-semantics`（跨用户缓存泄露）、`ip-address`（SSRF 分类绕过×8）、`brace-expansion`（DoS×6）、`tar`

* moderate/low：qs 等

### 前端（6 项：2 high / 4 low，`npm audit fix` 可修）

* `react-router 7.12.0–7.18.1`（RSC Mode CSRF 绕过——本站虽非 RSC 模式，升级到修复版零成本）

## 三、修复步骤（按序执行，最快速度）

1. `cd backend && npm audit fix --omit=dev`；`cd .. && npm audit fix --omit=dev`
2. 复跑 `npm audit --omit=dev` 确认 critical/high 清零（若个别无修复版则记录并评估临时缓解）
3. 回归验证（一次性跑完）：

   * 后端 `cd backend && npx tsc --noEmit && npm test`（26 套件须全绿）

   * 前端 `npx oxlint src`（0 错误）+ `npm run build`
4. 部署：`cd backend && npm run build && sudo -n systemctl restart tlrphotos-backend.service`；冒烟 `/api/about/stats`、`/api/announcements`、上传链路前置 401 检查
5. 版本 PATCH 升级 V4.1.0-beta → **V4.1.1-beta**（安全修复），三处同步（package.json/package-lock、context.md Changelog、版本管理规则.md）
6. git 提交推送：`[fix] 安全依赖修复（proxy-addr/multer/sharp 等） | V4.1.1-beta | 时间`

## 四、不做的事（避免延误）

* 不安装 PHP 相关任何组件（本来就没有）

* 不做 React 大版本升级、不重构上传链路（multer 由官方补丁修复）

* 不引入额外 WAF/安全组件（项目红线）

## 五、风险与回滚

* `npm audit fix` 仅 semver 范围内升级，无破坏性；若回归测试失败则 `git checkout backend/package-lock.json package-lock.json` 回滚后逐项定点升级

* 回滚备份：部署前依赖变更不涉及数据库；生产库无需备份（本次无迁移）

