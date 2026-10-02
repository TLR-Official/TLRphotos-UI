# 管理后台登录页安全加固实施计划

## 一、仓库调研结论

### 1. 已确认的缺陷与风险

| # | 风险 | 证据 |
|---|------|------|
| 1 | **登录页公开默认密码** | [LoginPage.tsx L104-106](file:///opt/tlr-photos-ui/TLRphotos-UI/src/admin/LoginPage.tsx#L104-L106) 明文显示「默认账户: admin / TLRadmin2026!」 |
| 2 | **默认密码硬编码于源码 3 处** | [adminService.ts initSuperAdmin](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/adminService.ts#L223-L244)：新建种子、旧 sha256 升级、console 明文打印 |
| 3 | **登录接口零限速、零人机验证** | [admin.ts POST /login](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/admin.ts#L45-L77)：可无限爆破/撞库（实测公网可达） |
| 4 | **输入校验薄弱** | 仅 truthy 判断，无类型/长度校验；超长串直达 bcrypt；存在类型混淆与资源消耗面 |
| 5 | **用户名可时序枚举** | 用户不存在立即返回；存在用户才走 bcrypt.compare，响应耗时差异可探测 |
| 6 | **JWT 密钥有弱默认回退** | [adminService.ts L30](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/adminService.ts#L30)：env 缺失时回退硬编码串；且无 iss/aud 声明、24h 有效期偏长 |
| 7 | **改密无法作废旧会话** | JWT 无版本声明，即使密码泄露后改密，已签发的旧 token 在到期前仍有效 |
| 8 | **无安全响应头** | 全站无 CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、HSTS；登录页可被 iframe 嵌套（点击劫持），XSS 可直接窃取 localStorage 中 token |
| 9 | **无自助改密通道** | 不存在管理员修改自己密码的接口，泄露密码无法由用户自行轮换 |
| 10 | **失败登录无审计** | 仅成功登录写 admin_logs |
| 11 | **Cloudflare Access 未启用** | 实测 `https://tlrphotos.com/admin` 返回 200 直达登录页，违反项目强制规范（管理后台必须经 CF Zero Trust Access 保护） |

### 2. 可复用的现有基础设施

- `createRateLimiter`（[rateLimit.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/middleware/rateLimit.ts)）：内存固定窗口限速，测试环境默认放行
- `verifyTurnstileToken` + `isTestBypass`（verificationService）：siteverify + 测试绕过
- `TurnstileWidget`（[组件](file:///opt/tlr-photos-ui/TLRphotos-UI/src/components/TurnstileWidget.tsx)）：ref.reset()、action、light 主题
- nginx smuggling-guard、CORS 白名单、bcrypt cost=10、127.0.0.1 仅本机监听 —— 均已就位
- 站点已橙云（CF 代理生效），具备启用 Access 的前提

## 二、关键安全设计（针对评审意见的硬约束）

### 约束 1：CF Access 必须先于应用层强制改密生效（防抢改）

**威胁场景**：默认密码 `TLRadmin2026!` 已出现在前端构建产物与源码历史中，属公开信息。若应用层先上线「默认密码 → must_change_password 强制改密」而 Access 未生效，任何知道默认密码者可先于合法管理员登录并把密码改成自己的值 → 账号被接管。

**执行顺序（硬性闸门，不可调换）**：

```
阶段 0：代码可先写、先构建，但部署包不得启用强制改密逻辑（开关关闭）
阶段 1：CF Access 配置完成
阶段 2：公网验证闸门——/admin 与 /api/admin/* 未授权请求必须全部被 CF Access 拦截（302 到身份门）
         ★ 闸门验证通过前，禁止进入阶段 3
阶段 3：部署应用层加固（含 must_change_password 暴露检测与强制改密），后端 restart
阶段 4：管理员通过 Access + 默认密码登录 → 强制改密 → token_version+1 → 旧 JWT 全部失效
```

实现上以 env 开关 `ADMIN_FORCE_CHANGE_PASSWORD=off|on` 控制暴露检测与拦截中间件：阶段 0–2 保持 `off`，阶段 3 置 `on` 后重启；即使代码产物提前部署也不会提前暴露改密入口。

### 约束 2：改密后旧 JWT 必须立即失效（token 版本机制）

- `admin_users` 新增 `token_version INTEGER NOT NULL DEFAULT 0`
- 登录签发的 JWT 载荷携带 `tv: <token_version>`
- `verifyAdminToken` 校验通过后必须比对 `decoded.tv === admin.token_version`，不一致 → 无效
- 修改密码（`/me/password`）与强制改密成功时：`token_version = token_version + 1`
  → 改密前所有已签发 JWT（含攻击者持有的）立即失效，无需等待 8h 过期
- 停用/删除管理员沿用现有 `is_active` 检查，叠加生效

### 约束 3：JWT iss/aud 声明本身即作废旧 token（修正原矛盾）

- JWT 增加 `iss: 'tlrphotos-backend'`、`aud: 'tlrphotos-admin'`，verify 时强制校验两者
- **部署后，所有不含 iss/aud 的现存旧 token 验证必然失败**——这不是风险，是预期效果：全员重新登录一次
- 原计划风险表中「现有 24h 旧 token 仍有效」的表述错误，已删除；无需轮换 ADMIN_JWT_SECRET（iss/aud + token_version 已完成全部存量 token 作废）
- 有效期 24h → **8h**

### 约束 4：SUPER_ADMIN_PASSWORD fatal 条件精确化

`initSuperAdmin()` 按下表分支精确处理，**不因 env 缺失而无条件 fatal**：

| 启动时 super 账户状态 | SUPER_ADMIN_PASSWORD 状态 | 行为 |
|---|---|---|
| 不存在（全新库，需 INSERT 引导） | 缺失/空/强度不达标 | **fatal：拒绝启动**，日志提示需配置（无法安全引导） |
| 不存在 | 存在且达标 | 用该值 bcrypt 入库；日志不打印明文；**引导后自动置 `must_change_password=1`** |
| 存在，bcrypt 格式（正常现网情况） | 任意 | **永不 fatal、不重置密码**；改为运行暴露检测（见下） |
| 存在，旧 sha256 格式（需替换的历史遗留） | 缺失/空/强度不达标 | **fatal：拒绝启动**（旧哈希不得继续使用，重置又无安全新密码可用） |
| 存在，旧 sha256 格式 | 存在且达标 | 用该值替换为 bcrypt；置 `must_change_password=1` |

**强度达标精确定义**（同时满足）：字符串类型、trim 后长度 ≥ 12、≤ 128、不等于公开默认密码 `TLRadmin2026!`、不与用户名相同。

**暴露检测**（仅在 `ADMIN_FORCE_CHANGE_PASSWORD=on` 时执行，针对现有 bcrypt 账户）：
对 super 账户执行一次 `bcrypt.compare('TLRadmin2026!', password_hash)`，命中 → 置 `must_change_password=1`；不命中不改动密码、不影响登录。

## 三、文件与模块改动

### 前端

- `src/admin/LoginPage.tsx`：删除默认账户提示块；嵌入 TurnstileWidget（action=`admin_login`）；login 携带令牌；autocomplete（username/current-password/new-password 语义）
- `src/admin/api.ts`：`login` 增加 `turnstile_token` 参数；新增 `changeMyPassword`
- `src/admin/types.ts`：`LoginResponse` 增加 `must_change_password`；新增改密响应类型
- `src/admin/AdminApp.tsx`：登录响应含 `must_change_password` 时进入强制改密视图；改密成功后清本地旧 token 并以新登录态重新校验
- 新建 `src/admin/ForceChangePassword.tsx`：强制改密组件（新密码+确认+强度提示，与约束 4 同强度口径+Turnstile）
- `src/admin/Layout.tsx`：退出时调用 `setAdminToken(null)` 清除本地凭据（如未做则补齐）

### 后端

- `backend/src/db.ts`：`admin_users` 新增列
  - `must_change_password INTEGER NOT NULL DEFAULT 0`
  - `token_version INTEGER NOT NULL DEFAULT 0`
  （沿用项目 ALTER 兼容迁移模式，与既有表升级方式一致，逐列 try/catch）
- `backend/src/services/adminService.ts`：
  - 移除 JWT 弱默认回退：`ADMIN_JWT_SECRET` 缺失或 trim 后 < 32 字符 → 任何签发/校验前 fatal
  - JWT 增加 iss/aud/tv，有效期 8h；verify 强制校验 iss/aud/tv
  - `initSuperAdmin` 按约束 4 的分支表重写；移除全部明文密码 console
  - 新增暴露检测函数（开关控制）
  - 用户不存在时执行 dummy bcrypt.compare 消除登录时序差
  - 新增 `bumpTokenVersion(adminId)`；改密事务内「更新 password_hash + tv+1 + must_change_password=0」原子提交
- 新建 `backend/src/services/adminLoginGuard.ts`：内存型失败计数与锁定（同用户名+同 IP，5 次失败锁 15 分钟；成功登录清零；重启清零可接受），与限速器职责分离
- `backend/src/routes/admin.ts`：
  - `/login` 链路：IP 限速 → 严格输入校验 → Turnstile → 失败锁定检查 → 常量时间校验 → guard 计数/清零 → 成功与失败均写审计
  - 新增 `POST /me/password`（已登录：当前密码校验 + Turnstile + 新密码强度，按约束 2 原子改密并 tv+1）
  - 强制改密拦截中间件（开关 on 时）：`must_change_password=1` 的请求除 `/me`、`/me/password`、`/logout` 外一律 403 `PASSWORD_CHANGE_REQUIRED`
- `backend/.env`（不进 git）/ `backend/.env.example`：
  - 新增 `SUPER_ADMIN_PASSWORD=`（仅引导/旧哈希升级时必需）
  - 新增 `ADMIN_FORCE_CHANGE_PASSWORD=off`
- `backend/docs/api.md`：更新登录契约（turnstile_token 必填、锁定码、限速、8h）、新增 `/me/password`、新增 `PASSWORD_CHANGE_REQUIRED` 说明

### 基础设施

- nginx（`/etc/nginx/sites-available/tlrphotos`）server 级安全头：见下；登录接口响应追加 `Cache-Control: no-store`；`nginx -t` 通过后 reload
- **Cloudflare Zero Trust Access（用户控制台操作，阶段 1）**：
  1. Zero Trust → Access → Applications → Add self-hosted
  2. 应用一：domain `tlrphotos.com`，Path `admin` 与 `admin/*`
  3. 应用二（或同应用追加路径）：Path `api/admin/*`
  4. Policy：Allow → Include emails 指定管理员邮箱（Abelzhaoqin@outlook.com）；身份源默认 One-time PIN（免费、无需绑定 IdP）
  5. 完成后我执行阶段 2 闸门验证，通过才进阶段 3

### 计划 CSP 策略

```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self';
worker-src 'self' blob:;
object-src 'none'; base-uri 'none'; form-action 'self';
frame-ancestors 'none'; upgrade-insecure-requests
```

React 内联样式走 CSSOM 不受限；脚本不含 unsafe-inline/unsafe-eval，XSS 注入脚本无法执行。部署后浏览器控制台实测 0 违规再按需收紧。

## 四、实施步骤（依赖顺序）

1. **阶段 0（可先行，不开开关）**：
   - db.ts 两列迁移
   - adminService（JWT iss/aud/tv、8h、init 分支表、dummy compare、bumpTokenVersion）
   - adminLoginGuard
   - admin.ts（/login 全链路、/me/password、强制改密中间件）
   - 前端全部改动；api.md、.env.example
   - admin.test.ts 适配 + 新增用例（tailtest 辅助生成）；全套件回归
   - 后端 tsc、前端 lint/build、nginx 安全头 + reload
   - **保持 `ADMIN_FORCE_CHANGE_PASSWORD=off` 部署重启**：此时限速/Turnstile/锁定/JWT 加固已生效，但不启用强制改密
2. **阶段 1**：向用户提供 CF Access 控制台逐步指引，用户完成配置
3. **阶段 2（闸门验证）**：公网实测未授权访问 `/admin`、`/api/admin/login`、`/api/admin/me` 全部被 Access 拦截；**未通过则修复后重验，不进入阶段 3**
4. **阶段 3**：`.env` 置 `ADMIN_FORCE_CHANGE_PASSWORD=on`，restart；验证暴露检测置位
5. **阶段 4**：管理员真实走一遍 Access → 默认密码登录 → 强制改密 → 确认旧 JWT 失效、改密后新 JWT 正常
6. 版本三处同步、Changelog、Git 指定文件提交推送

## 五、验证方案

- 后端：全套件通过（现有 196 项 + 新增：限速 429、5 次失败锁定、无 Turnstile 403、类型/超长入参 400、iss/aud/tv 校验、改密后旧 token 失效、强制改密期 403、fatal 分支表各路径）
- 前端：`npm run lint` 0 错误、`npm run build` 通过
- 端到端实测：
  1. 未过 Access：`/admin` 与 `/api/admin/*` 全部 302 身份门
  2. 通过 Access：无 Turnstile 被拒；5 次错误口令锁定 15 分钟；错误提示通用不可枚举
  3. 默认密码登录 → 强制改密页；改密前其他接口 403；改密后旧 token 立即 401、新 token 正常
  4. 安全头经 curl 全部存在；控制台无 CSP 违规；登录页不可被 iframe 嵌套
  5. separateweb-capture 留存登录页改造后截图
- 版本规范：三处同步、Changelog 追加、Git 指定文件提交推送

## 六、风险与处理

| 风险 | 处理 |
|------|------|
| 强制改密先于 Access 生效 → 默认密码被抢改 | 约束 1：开关 + 阶段闸门，Access 公网验证通过才置 on |
| 改密后攻击者持有的旧 token 仍可用 | 约束 2：token_version + tv 声明，改密事务内 +1，立即失效 |
| iss/aud 上线导致全员被登出 | 预期行为，重新登录一次；与 Access session 叠加体验可接受 |
| 失败锁定造成临时不可用 | 仅锁 15 分钟、仅登录入口、成功即清零；不影响已签发 token |
| CF Access 配置错误锁死管理员 | 策略先只加本人邮箱；Access 配置可在 CF 控制台秒级关闭，不影响 origin |
| CSP 过严影响功能 | 控制台实测 0 违规再收紧；nginx 头可快速回滚 |
| 失败登录记录 IP（个人数据） | 仅记录安全审计所需字段，沿用 admin_logs 既有周期，不新增扩散面 |

## 七、版本评估

新增 API 接口与强制改密流程（向后兼容的新功能 + 安全加固）→ **MINOR：V1.12.0 → V1.13.0**。
同步位置：package.json、.ai/context.md（release + feat 两条）、.trae/rules/版本管理规则.md（当前版本 + 历史记录）。
