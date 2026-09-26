# 登录强制验证码（手机号/邮箱二选一）Spec

## Why

当前登录仅需邮箱+密码+Turnstile 人机验证，缺少二次身份确认；注册只收邮箱不收验证码、不收集手机号，无法支撑手机号通道。需引入基于 push.spug.cc 官方验证码模板（`/sms`、`/mail`）的验证码体系，使登录必须完成手机号或邮箱验证码校验，同时让注册支持手机号/邮箱自动识别。

## What Changes

- **后端新增** `verification_codes` 表：target（邮箱/手机号）、channel（sms/mail）、scene（login/register/bind_phone）、code_hash（HMAC-SHA256，不明文存储）、attempts、expires_at（10 分钟）、used_at、ip；过期/已用记录每日清理
- **后端新增** `spugService`：封装 `POST https://push.spug.cc/sms/<TEMPLATE_CODE>` 与 `/mail/<TEMPLATE_CODE>`；15s AbortController 超时；`code!==200` 视为失败；模板编码经 `SPUG_SMS_TEMPLATE` / `SPUG_MAIL_TEMPLATE` env 注入，**未配置时接口返回 503**（与 EverOS 策略一致）
- **新增接口**（详见 api.md 更新）：
  - `POST /api/auth/otp/send` — 发送验证码（自动识别邮箱/手机号，scene=login/register/bind_phone）
  - 登录改造为两段式：`POST /api/auth/login` 密码校验通过后**不直接签发 JWT**，返回 `{ otp_required: true, login_ticket, channels: ["email", "phone"?] }`；`POST /api/auth/login/verify` 用 login_ticket + code 换取 JWT（**BREAKING**：登录响应结构变化，前端同步改造）
  - `POST /api/auth/register` 支持邮箱**或手机号**注册（自动识别），强制校验验证码
  - `POST /api/auth/phone/bind` — 已登录用户绑定手机号（向新手机号发短信码验证归属）
- **users 表迁移**：`email` 改为可空（手机号注册用户无邮箱），SQLite 表重建迁移（users_new → copy → drop → rename，迁移前自动备份 database.db）；新增 `phone_verified` 字段；手机号注册自动生成用户名
- **前端 AuthPage 改造**：登录增加第二段验证码步骤（通道选择、6 位码输入、60s 重发倒计时、错误提示）；注册表单 identifier 自动识别手机号/邮箱并要求验证码；手机号未注册时提示"该手机号未注册，继续登录将注册新账号"
- **前端 ProfilePage**：个人资料新增「绑定手机号」（短信验证码验证归属后写入 users.phone）
- **安全约束**：验证码 6 位数字、10 分钟有效、最多 5 次错误尝试（超即作废）；发送限速（同 target 60s 冷却、单 target 5 次/小时、单 IP 20 次/小时，复用 rateLimit 中间件）；send/login/verify 均保留 Turnstile 门；日志不落明文验证码与完整手机号（脱敏中间 4 位）

## Impact

- Affected code：`backend/src/db.ts`（表+迁移）、`backend/src/services/spugService.ts`（新）、`backend/src/services/otpService.ts`（新）、`backend/src/routes/auth.ts`（login/register/otp 接口）、`backend/src/server.ts`（清理定时器）、`backend/.env.example`、`backend/docs/api.md`、`src/features/auth/AuthPage.tsx`、`src/features/profile/ProfilePage.tsx`、`src/api/auth.ts`
- Affected specs：无历史 spec 冲突（cookie-login-session 的会话机制不变）
- 用户影响：所有用户下次登录必须完成一次验证码校验；仅邮箱用户无感知变化之外多一步邮箱收码

## ADDED Requirements

### Requirement: 验证码发送
系统 SHALL 提供 `POST /api/auth/otp/send`，入参 `{ target, scene, turnstile_token }`，自动识别 target 类型（手机号正则 `^1[3-9]\d{9}$`，否则按邮箱校验），调用 push.spug.cc 对应通道发送 6 位数字验证码，10 分钟有效。

#### Scenario: 邮箱发送成功
- **WHEN** 已注册用户提交已绑定邮箱 + scene=login + 有效 turnstile_token
- **THEN** 调用 `POST /mail/<SPUG_MAIL_TEMPLATE>`（`{to, scene:"登录验证", code, minute:"10"}`），返回 `{ success: true, data: { channel: "mail", cooldown: 60 } }`，不落明文码

#### Scenario: 未配置模板
- **WHEN** `SPUG_MAIL_TEMPLATE` 未配置
- **THEN** 返回 503 `{ message: "验证码服务未配置" }`，不产生验证码记录

#### Scenario: 限速
- **WHEN** 同一 target 60 秒内重复请求，或单 target 超 5 次/小时
- **THEN** 返回 429 `RATE_LIMITED` + `Retry-After`

### Requirement: 两段式登录
系统 SHALL 将登录拆为密码校验与验证码校验两步，密码通过后签发 10 分钟有效的一次性 `login_ticket`（HMAC 签名，绑定 userId+IP），凭 ticket+验证码换取 JWT。

#### Scenario: 密码通过进入验证步
- **WHEN** 邮箱+密码正确
- **THEN** 返回 `{ otp_required: true, login_ticket, channels }`；channels 含 `email`，已绑定手机号时含 `phone`；**不签发 JWT**

#### Scenario: 验证码正确
- **WHEN** `POST /api/auth/login/verify` 提交有效 ticket + 匹配验证码
- **THEN** 验证码标记已用，按原逻辑签发 JWT/会话，返回与原登录一致的 `{ user, token, session_token }`

#### Scenario: 验证码错误超限
- **WHEN** 同一验证码记录错误尝试达 5 次
- **THEN** 返回 400 `OTP_LOCKED`（"尝试次数过多，请重新获取验证码"），该码作废

#### Scenario: 手机号未注册
- **WHEN** 登录 identifier 为手机号且未绑定任何账号
- **THEN** 返回 404 `PHONE_NOT_REGISTERED`（"该手机号未注册，继续登录将注册新账号"）

### Requirement: 手机号/邮箱注册
系统 SHALL 支持 register 入参 identifier 自动识别：邮箱走邮件码、手机号走短信码；验证码校验通过才创建账号；手机号注册写入 `phone` + `phone_verified=1`，email 为 NULL，自动生成用户名。

#### Scenario: 手机号注册成功
- **WHEN** 提交未注册手机号 + 密码 + 有效短信码
- **THEN** 创建账号并直接签发 JWT（视同完成登录验证）

#### Scenario: 重复注册
- **WHEN** target 已存在
- **THEN** 返回 409 `ALREADY_REGISTERED`（"该手机号/邮箱已注册，请直接登录"）

### Requirement: 绑定手机号
系统 SHALL 提供 `POST /api/auth/phone/bind`（需登录）：向待绑定手机号发送短信码（scene=bind_phone），验证通过后写入 `users.phone` + `phone_verified=1`；若手机号已被他人绑定返回 409。

#### Scenario: 绑定成功
- **WHEN** 登录用户提交新手机号 + 有效短信码
- **THEN** users.phone 更新，后续登录 channels 出现 `phone`

### Requirement: 验证码安全存储与清理
系统 SHALL 以 HMAC-SHA256（密钥=JWT_SECRET）存储验证码哈希，禁止明文入库/入日志；used_at 非空或 expires_at 过期即失效；每日清理 7 天前记录。

## MODIFIED Requirements

### Requirement: 登录接口契约
`POST /api/auth/login` 响应由直接返回 token 改为两段式（见上）；旧字段在第二步返回。前端 AuthPage 同步改造，管理后台 admin 登录不受影响。

### Requirement: 注册接口契约
`POST /api/auth/register` 入参由 `{ email, password, username? }` 改为 `{ identifier, password, username?, code, turnstile_token }`（identifier 自动识别邮箱/手机号）；**BREAKING**，前端同步改造。

## REMOVED Requirements

无。
