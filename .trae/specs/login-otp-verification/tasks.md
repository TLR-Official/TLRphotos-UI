# Tasks

## 后端

- [ ] Task 1: 数据库迁移
  - [ ] SubTask 1.1: db.ts `users` 表迁移 — `email` 改可空（新建 users_new + copy + drop + rename，迁移前自动备份 database.db）
  - [ ] SubTask 1.2: db.ts 新增 `phone_verified` 字段与 `verification_codes` 表（target/channel/scene/code_hash/attempts/expires_at/used_at/ip，过期索引）
  - [ ] SubTask 1.3: seedMockData 兼容：注册用户仍填 email 但兼容新结构

- [ ] Task 2: 验证码服务
  - [ ] SubTask 2.1: 新建 `backend/src/services/spugService.ts` — 封装 `POST /sms/<TEMPLATE_CODE>` 与 `/mail/<TEMPLATE_CODE>`；15s 超时；`code!==200` 抛错；未配置 env 抛 503 型错
  - [ ] SubTask 2.2: 新建 `backend/src/services/otpService.ts` — `generateCode()` 6 位数字、`createCodeRecord(target, channel, scene, ip)`（HMAC-SHA256 哈希入库）、`verifyCode(target, code, scene)`（防时序攻击 constant-time 比较）、`cleanupExpiredCodes()`（日清 7 天前）
  - [ ] SubTask 2.3: 在 backend/src/server.ts 挂载 `cleanupExpiredCodes` 每日定时器

- [ ] Task 3: Auth 路由接口改造
  - [ ] SubTask 3.1: `POST /api/auth/otp/send` — 自动识别 target 类型；复用 rateLimiter 限速（同 target 60s 冷却/5次/小时/IP 20次/小时）；调用 spugService 发送；保留 Turnstile 门
  - [ ] SubTask 3.2: `POST /api/auth/login` 改造为两段式 — 密码校验通过后生成 10min `login_ticket`（HMAC 签名绑定 userId+IP），返回 `{ otp_required, login_ticket, channels }`；**不签发 JWT**
  - [ ] SubTask 3.3: `POST /api/auth/login/verify` — 校验 ticket 签名与过期；otpService.verifyCode 校验验证码（最多 5 次错误，超限作废）；通过后按原 login 流程签发 JWT/会话
  - [ ] SubTask 3.4: `POST /api/auth/register` 改造 — 支持 identifier 自动识别（手机号/邮箱）；发送验证码强制校验；手机号注册写入 `phone` + `phone_verified=1`，email=NULL，自动生成用户名；重复注册 409
  - [ ] SubTask 3.5: `POST /api/auth/phone/bind` — 需登录；向待绑定手机号发码（scene=bind_phone）；验证通过后写 `users.phone`+`phone_verified=1`；重复绑定 409
  - [ ] SubTask 3.6: 错误脱敏 — otp send/verify 的日志与错误响应不落明文码、手机号中间 4 位脱敏；复用现有 errorHandler 敏感模式正则

- [ ] Task 4: 后端环境变量与文档
  - [ ] SubTask 4.1: `.env.example` 新增 `SPUG_SMS_TEMPLATE`、`SPUG_MAIL_TEMPLATE`
  - [ ] SubTask 4.2: `api.md` 更新 — 新增 OTP 章节（send / login / login/verify / register / phone/bind）+ 响应契约 + 错误码表

- [ ] Task 5: 后端集成测试
  - [ ] SubTask 5.1: 新建 `backend/tests/integration/otp.test.ts` — send（成功/限速/未配置模板 503）、login（两段式返回 ticket）、verify（正确/错误/超限/过期）、register（手机号注册/重复 409）、bind（成功/重复 409）
  - [ ] SubTask 5.2: 新建 `backend/tests/unit/otpService.test.ts` — HMAC 哈希不变性、constant-time 比较、attempts 计数
  - [ ] SubTask 5.3: 确保 auth.test.ts/photos.test.ts 现有用例不因 login 两段式而挂（用 TEST_BYPASS_TOKEN + 测试环境跳过 OTP 或给 mock code）

## 前端

- [ ] Task 6: API 封装
  - [ ] SubTask 6.1: `src/api/auth.ts` — 新增 `sendOtp(target, scene, turnstileToken)`、`verifyLogin(ticket, code)`、`bindPhone(phone, code, turnstileToken)`；更新 `register` 参数为 `{ identifier, password, code, turnstileToken }`
  - [ ] SubTask 6.2: `src/api/auth.ts` — `login` 返回值改为 `LoginResponse | LoginOtpResponse`，类型安全

- [ ] Task 7: AuthPage 改造
  - [ ] SubTask 7.1: 注册页 — identifier 输入框（邮箱/手机号自动识别）+ 密码 + 验证码输入 + 「发送验证码」按钮（60s 倒计时）+ Turnstile
  - [ ] SubTask 7.2: 登录页第一段 — 邮箱/手机号 + 密码 + Turnstile；成功后进入第二段
  - [ ] SubTask 7.3: 登录页第二段 — 通道选择（邮箱/手机号，未绑定手机号时仅邮箱）+ 验证码输入 + 60s 重发 + 错误提示（尝试超限、过期、不匹配）；验证通过后存储 token 跳转
  - [ ] SubTask 7.4: 手机号未注册提示 — 登录输入手机号无匹配时显示「该手机号未注册，继续登录将注册新账号」，提供「去注册」链接

- [ ] Task 8: ProfilePage 绑定手机号
  - [ ] SubTask 8.1: 个人资料页新增「绑定手机号」区域（输入手机号 + 短信验证码 + 60s 倒计时 + 成功提示）；若已绑定则显示脱敏手机号
  - [ ] SubTask 8.2: useUser 的 user 类型扩展 `phone` 与 `phone_verified`

- [ ] Task 9: 前端构建验证
  - [ ] SubTask 9.1: `npm run lint` 0 error
  - [ ] SubTask 9.2: `npm run build` 通过

## 部署与版本

- [ ] Task 10: 版本号与 Changelog
  - [ ] SubTask 10.1: package.json → V1.11.0（含 API 契约 BREAKING 变更、表迁移、新功能模块，属 MINOR）
  - [ ] SubTask 10.2: `.ai/context.md` Changelog 顶部追加 release 条目
  - [ ] SubTask 10.3: `.trae/rules/版本管理规则.md` 当前版本与历史记录同步更新

- [ ] Task 11: 部署验证
  - [ ] SubTask 11.1: 生产 `.env` 新增 `SPUG_SMS_TEMPLATE`/`SPUG_MAIL_TEMPLATE`
  - [ ] SubTask 11.2: 前端 build → dist/ → 推送
  - [ ] SubTask 11.3: 后端 rebuild dist + 重启 tlrphotos-backend.service
  - [ ] SubTask 11.4: 端到端验证：邮箱注册→登录→发送码→输入码→成功；管理后台登录不受影响

# Task Dependencies

- Task 2 (验证码服务) 必须在 Task 3 (接口) 之前完成
- Task 3 (接口) 必须在 Task 5 (测试) 与 Task 6 (前端 API) 之前完成
- Task 6 (前端 API) 必须在 Task 7 (登录页) 与 Task 8 (绑定手机号) 之前完成
- Task 1 (数据库) 与 Task 2 (验证码服务) 可并行
- Task 7 (登录页) 与 Task 8 (绑定手机号) 可并行
- Task 9 (构建验证) 必须在 Task 11 (部署) 之前
