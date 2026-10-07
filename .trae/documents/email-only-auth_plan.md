# 全面移除手机验证码、收敛为纯邮箱认证体系 — 实施计划

## 一、仓库调研结论

### 1.1 现状代码结构

**后端短信/验证码链路**
- [backend/src/services/spugService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/spugService.ts)：Spug 短信发送（`sendSmsCode`），仅被 [auth.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/auth.ts) 与 [admin.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/admin.ts) 引用
- [backend/src/services/otpService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/otpService.ts)：`OtpChannel='sms'|'mail'`、`OtpScene='login'|'register'|'bind_phone'|'admin_login'`；`createCodeRecord/verifyCode/cleanupExpiredCodes/maskTarget`
- [backend/src/services/aliMailService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/aliMailService.ts)：阿里云 DirectMail SMTP 邮件验证码（保留，为唯一发送通道）
- [backend/src/routes/auth.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/auth.ts)：
  - `POST /otp/send`（自动识别手机/邮箱，场景 login/register/bind_phone）
  - `POST /register`（identifier 自动识别；手机注册 email=NULL、phone_verified=1）
  - `POST /login`（两段式票据；channels 含 email/phone）
  - `POST /login/verify`（channel ∈ email/phone）
  - `POST /phone/bind`（登录后绑定手机）
- [backend/src/routes/admin.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/admin.ts)：`/login` 中的超管短信门 + `ADMIN_SMS_REQUIRED` 紧急开关（V1.13.1）+ `/login/sms/send`、`/login/sms/verify`
- [backend/src/services/adminService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/adminService.ts)：`AdminUser.phone/phone_verified`、`signAdminSmsTicket/verifyAdminSmsTicket`、`bootstrapSuperAdminPhones`
- [backend/src/server.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/server.ts)：启动时调用 `bootstrapSuperAdminPhones()`；定时清理 `cleanupExpiredCodes()`

**前端链路**
- [src/api/auth.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/api/auth.ts)：`sendOtp`（手机/邮箱）、`bindPhone`、`verifyLogin(channel)`、类型含 phone/phone_verified
- [src/features/auth/AuthPage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/auth/AuthPage.tsx)：手机/邮箱识别、手机号未注册引导、通道选择（邮箱/手机）
- [src/features/profile/ProfilePage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/profile/ProfilePage.tsx)：手机号资料行、绑定/换绑手机弹窗（约 200 行 phoneModal* 状态与逻辑）
- [src/admin/LoginPage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/admin/LoginPage.tsx)：超管短信第二阶段 UI
- 管理后台其余文件（api.ts/types.ts/AdminApp.tsx）含 must_change_password 等，密码门保留

**数据库（生产 backend/data/database.db，2026-10-07 只读核实）**
- `users`：含 `phone`、`phone_verified`，**无 `email_verified` 列**
- `admin_users`：含 `phone`、`phone_verified`
- `verification_codes`：sms 记录 3 条、mail 记录 18 条（表保留，收敛为纯邮箱）

### 1.2 生产用户数据画像（25 人）

- **全部 25 人均在 2026-09-26（OTP 体系上线日）之前注册**——全部属于"无任何验证注册的老用户"
- 25 人均有邮箱；仅 `test1` 同时登记手机号；**手机-only 用户 0 人；邮箱与手机都无 0 人**
- 垃圾账号 2 个：`agent.probe.9f2@example.com`、`agent.probe.role.a7@example.com`（扫描探测）

### 1.3 已确认的关键决策（用户拍板）

1. **每次登录都必须输入邮箱验证码**（保留两段式登录，仅保留 email 通道）
2. **管理后台超管短信第二因素代码一并物理删除**
3. **历史数据彻底清理**：DROP users/admin_users 的 phone 相关列（表重建）、清空 verification_codes 短信记录、删除两个 agent.probe 账号

### 1.4 版本判定

API 契约破坏性变更 + 数据库结构不兼容迁移（DROP 列）→ MAJOR：**V1.13.1 → V2.0.0**

---

## 二、目标设计

### 2.1 用户侧认证新流程

- **注册**：仅接受邮箱。入参 `{email, password, username?, code, turnstile_token}`；校验场景 register 的邮箱验证码后建号（`email_verified=1`），注册成功即登录
- **登录第一段** `POST /api/auth/login`：入参仅 `{email, password, turnstile_token}`；密码校验通过后签发 10 分钟 login_ticket（绑定 userId+IP），自动下发/待发邮箱验证码；**不再返回 channels**
- **登录第二段** `POST /api/auth/login/verify`：入参 `{login_ticket, code}`（无 channel）；校验成功 → 置 `email_verified=1`（首次登录自动完成老用户邮箱确权）→ 签发 JWT + 会话
- **无邮箱账号（过渡兼容）**：第一段返回 `403 EMAIL_BIND_REQUIRED` + bind_ticket；`POST /api/auth/email/bind` 凭 bind_ticket 提交 `{email, code}`，验证通过写入邮箱并签发 JWT
- **已登录用户换邮箱**：同一 `/email/bind` 接受 JWT，新邮箱收码验证后替换（email_verified 保持 1）
- **邮箱验证码发送**：`POST /api/auth/email/code/send`，场景仅 `login/register/bind_email`；三层限速不变（60s 冷却 + 目标 5/h + IP 20/h），Turnstile fail-closed
- **账户功能门**：新增中间件 `requireVerifiedEmail`——`email_verified=0` 的会话调用账户类功能返回 `403 EMAIL_VERIFICATION_REQUIRED`。覆盖：上传（presigned/complete）、点赞、评论、资料修改、头像、改密；公开浏览与邮箱绑定/验证端点不拦截

### 2.2 管理后台新流程

- `/api/admin/login` 回归**单阶段**：限速 → 入参校验 → Turnstile(admin_login) → 锁定检查 → 密码校验 → 直接签发 JWT
- 删除 `/login/sms/send`、`/login/sms/verify`、`ADMIN_SMS_REQUIRED` 开关
- 强制改密门（must_change_password）、token_version、iss/aud 等既有机制全部保留
- 超管手机号引导（SUPER_ADMIN_PHONES / bootstrapSuperAdminPhones）删除

### 2.3 管理员支持端点（应对"老邮箱无法收信"）

- 新增 `PUT /api/admin/users/:id/email`（仅 super）：入参 `{email}`，更新站点用户邮箱并置 email_verified=0，写审计日志；用户下次登录经邮箱验证码完成确权

---

## 三、文件与模块变更清单

### 后端删除

- `backend/src/services/spugService.ts`（整文件删除）

### 后端修改

- [backend/src/db.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/db.ts)
  - 全新库基线：users 删除 phone/phone_verified、新增 `email_verified INTEGER NOT NULL DEFAULT 0`；admin_users 删除 phone/phone_verified
  - 增量迁移（全部幂等、try/catch 或 PRAGMA 守卫）：
    1. `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`
    2. 核实并删除两个 agent.probe 账号及其关联（likes/views，先 SELECT 核实）
    3. `DELETE FROM verification_codes WHERE channel='sms'`
    4. users 表重建（事务内：建 users_new → 复制列（不含 phone*）→ 校验行数一致 → drop/rename），仅当 phone 列存在时执行；重建前复制 .bak-v2-* 备份
    5. admin_users 同法重建删除 phone/phone_verified
- [backend/src/services/otpService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/otpService.ts)：
  - `OtpChannel` 收敛为 `'mail'`（或直接移除该类型，调用处固定 mail）；`OtpScene` 改为 `'login'|'register'|'bind_email'`
  - `createCodeRecord` 参数简化；`verifyCode/cleanupExpiredCodes/maskTarget` 保留
- [backend/src/services/authService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/authService.ts)：
  - User 接口删除 phone/phone_verified、新增 email_verified；全部 SELECT 列同步
  - 删除 `detectIdentifier`（或保留为仅邮箱校验并改名）；`findUserByIdentifier` 改为仅按 email；`register` 仅邮箱路径（email_verified=1）
  - 新增 `markEmailVerified(userId)`、`bindUserEmail(userId, email)`
- [backend/src/services/adminService.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/services/adminService.ts)：
  - AdminUser 删除 phone/phone_verified；删除短信票据函数与 `bootstrapSuperAdminPhones`；其余（JWT/tv/must_change_password/exposed 检测）不动
- [backend/src/middleware/adminAuth.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/middleware/adminAuth.ts)：无手机相关（不动）
- 新建 `backend/src/middleware/requireVerifiedEmail.ts`：载入用户行，email_verified=0 → 403
- [backend/src/routes/auth.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/auth.ts)：按 2.1 全面重写相关路由；删除 /phone/bind
- [backend/src/routes/admin.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/admin.ts)：/login 单阶段化、删除短信端点、新增 `PUT /users/:id/email`
- [backend/src/routes/photos.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/photos.ts)：上传与点赞路由挂接 requireVerifiedEmail
- [backend/src/routes/articles.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/articles.ts)：评论写入挂接（如存在评论写入路由）
- [backend/src/server.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/server.ts)：删除 bootstrapSuperAdminPhones 调用与 import；清理逻辑保留
- [backend/docs/api.md](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/docs/api.md)：重写认证章节（邮箱-only）、标注删除端点与 V2.0.0 破坏性变更
- [backend/.env.example](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/.env.example)：删除 SPUG_SMS_TEMPLATE、SUPER_ADMIN_PHONES、ADMIN_SMS_REQUIRED 说明

### 前端修改

- [src/api/auth.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/api/auth.ts)：类型删 phone/phone_verified、加 email_verified；删 bindPhone；新增 bindEmail；verifyLogin 去掉 channel；sendOtp 收敛为邮箱场景（或改名 sendEmailCode）
- [src/features/auth/AuthPage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/auth/AuthPage.tsx)：
  - 输入框/文案/校验全部邮箱-only；删除手机识别、phoneNotice、通道选择
  - 保留两段式验证码 UI（文案固定为发往邮箱）；新增 EMAIL_BIND_REQUIRED 内联绑定步骤（新邮箱 → 收码 → 验证），含分步指引文案
- [src/features/profile/ProfilePage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/features/profile/ProfilePage.tsx)：
  - 删除手机号资料行与全部 phoneModal* 状态/逻辑
  - 新增邮箱行（已验证徽章/未验证警示）+ 换邮箱弹窗（新邮箱 → 发码 → 验证）
- 新建账户门处理（最小实现）：客户端对 403 EMAIL_VERIFICATION_REQUIRED 统一弹窗提示"请重新登录完成邮箱验证"并提供退出入口
- [src/admin/LoginPage.tsx](file:///opt/tlr-photos-ui/TLRphotos-UI/src/admin/LoginPage.tsx)：删除短信第二阶段 UI 与状态，登录成功直接 setAdminToken
- [src/admin/api.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/admin/api.ts) / [types.ts](file:///opt/tlr-photos-ui/TLRphotos-UI/src/admin/types.ts)：移除短信响应分支

### 配置变更（服务器，部署时执行）

- `backend/.env`：删除 `SPUG_SMS_TEMPLATE`、`SUPER_ADMIN_PHONES`、`ADMIN_SMS_REQUIRED`；保留 `ADMIN_FORCE_CHANGE_PASSWORD=on` 与 DirectMail SMTP 配置

---

## 四、实施步骤（依赖顺序）

1. **数据库层改造**：db.ts 新基线 + 5 条迁移（备份先行），在生产库副本上先跑通
2. **otpService / authService 收敛**：类型与函数签名改造
3. **后端路由重写**：auth.ts（注册/登录/邮箱码/绑定）、admin.ts（单阶段登录 + 邮箱支持端点）
4. **requireVerifiedEmail 中间件**：新建并挂接 photos/articles 等账户功能
5. **删除 spugService.ts** 与 server.ts 引导调用
6. **前端改造**：api/types → AuthPage → ProfilePage → 管理员 LoginPage
7. **测试改造与新增**（见第五节），全套件回归
8. **文档同步**：api.md、.env.example
9. **部署**：后端 build → .env 清理 → restart；前端 lint/build → 部署 dist
10. **线上实测**（真实邮箱收码）：注册、登录两段、老用户确权、管理员单阶段、支持端点
11. **版本与提交**：V2.0.0 三处同步 → Changelog → 指定文件 git add → commit → push

---

## 五、测试方案

### 5.1 改造既有套件

- `admin.test.ts`：删除短信第二因素与 ADMIN_SMS_REQUIRED 开关用例及种子账号手机列；/login 断言单阶段直接发 token；新增 `PUT /users/:id/email` 用例
- `otp.test.ts`：全部场景改为邮箱；删除手机识别/通道用例
- `auth.test.ts`：注册/登录断言邮箱-only；新增 bind_email 流程
- `otpService.test.ts`：类型与场景适配
- 其余套件（verification/everos/photos/cors）按新字段适配

### 5.2 新增用例

- 注册接口传入手机号 → 400；无验证码/错误验证码 → 拒绝
- 登录第一段不签发 JWT、第二段错误码（NOT_FOUND/MISMATCH/LOCKED/EXPIRED）处理
- login_ticket 篡改/过期/跨 IP → 401
- EMAIL_BIND_REQUIRED 流程：bind_ticket → 绑定新邮箱 → JWT
- email_verified=0 账户调用上传/点赞/评论/资料修改 → 403；首次登录验码后 → 200
- 限速三层与验证码 5 次锁定
- **数据迁移测试**：复制生产库 → initDb → 断言：phone 列已不存在、probe 账号已删（关联无孤儿）、sms 码清零、用户数=23、全部照片/点赞数据完整、email_verified 列存在且默认 0、迁移可重复执行幂等

### 5.3 回归与安全验证

- 后端全套件全部通过（基线 218，数量随删除/新增变化，以实际为准）
- 前端 lint 0 错误、build 通过
- 安全点：无任何端点可用手机号触达；无邮箱账号不能绕过绑定；管理后台登录不受影响

---

## 六、依赖与注意事项

- 邮件唯一出口为阿里云 DirectMail SMTP（aliMailService），其可用性是整个登录体系前提；上线前必须真实收码验证
- SQLite 表重建须在事务中完成并校验行数，失败自动回滚；email 的 UNIQUE 索引需在重建 SQL 中显式保留
- 旧 JWT（部署前签发）在 requireVerifiedEmail 门处会被要求重新登录——预期行为，需在变更说明中告知用户
- 当前前端代码存在 dark 模式分支（如 phoneNotice 处），删除手机 UI 时一并清除相关残留，不新增 dark 样式
- 禁止改动 nginx/CSP（与本需求无关）

## 七、风险与应对

| 风险 | 应对 |
|------|------|
| 表重建导致数据损坏 | 重建前 .bak-v2-* 文件备份 + 事务 + 行数/关键表校验；异常即恢复备份 |
| 老用户旧邮箱无法收信，无法登录 | 管理员 `PUT /users/:id/email` 人工核验后重置邮箱；用户下次登录收码确权 |
| DirectMail 发信故障致全员无法登录 | 上线窗口避开繁忙时段；保留回滚能力（服务回退 + 备份库）；故障时按 V1 邮件通道经验排查 SMTP |
| 部署后既有会话失效引发用户困惑 | 登录页/公告说明"需重新登录并验证邮箱"；流程仅多一次邮件码输入 |
| 回滚需求 | 代码 revert + 恢复 .bak 数据库 + 还原 .env；回滚操作步骤随上线记录一并留存 |

## 八、交付物

- V2.0.0 代码（后端 + 前端 dist）并部署到生产
- api.md 纯邮箱契约；.env.example 清理
- package.json / .ai/context.md / .trae/rules/版本管理规则.md 三处版本同步
- Git 提交：`[release] 全面移除手机验证码收敛为纯邮箱认证 | V2.0.0 | 时间戳`，推送 main
