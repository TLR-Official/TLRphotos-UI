# Checklist

* [x] 数据库迁移：users.email 可空、phone\_verified 字段、verification\_codes 表创建成功且不影响现有用户数据

* [x] spugService 能调用 push.spug.cc `/mail/<TEMPLATE>` 与 `/sms/<TEMPLATE>` 并正确处理 200/非 200 响应；未配置模板返回 503

* [x] otpService 验证码为 6 位数字、HMAC-SHA256 存储、10 分钟有效、最多 5 次错误尝试、过期/已用即失效

* [x] `POST /api/auth/otp/send` 自动识别邮箱/手机号、限速（60s 冷却/5次/小时/20次/IP）、保留 Turnstile 门、错误不落明文码

* [x] `POST /api/auth/login` 密码通过后返回 `{ otp_required, login_ticket, channels }`，不签发 JWT；ticket 10 分钟有效

* [x] `POST /api/auth/login/verify` 校验 ticket + 验证码，通过后才签发 JWT/会话；错误超限 5 次作废

* [x] `POST /api/auth/register` 支持手机号/邮箱自动识别 + 强制验证码；手机号注册 email=NULL + phone\_verified=1 + 自动生成用户名；重复 409

* [x] `POST /api/auth/phone/bind` 需登录、向新手机号发码验证归属、重复绑定 409

* [x] 日志与错误响应不落明文验证码、手机号中间 4 位脱敏

* [x] api.md 包含完整 OTP 章节（5 个接口契约 + 错误码表）

* [x] 后端测试：otp.test.ts 集成用例 + otpService.test.ts 单元用例全部通过；现有 auth/photos 测试不受影响

* [x] 前端 AuthPage 注册页：identifier 自动识别、发送验证码 60s 倒计时、验证码必填、提交成功跳转

* [x] 前端 AuthPage 登录页：第一段密码 → 第二段通道选择 + 验证码输入 + 60s 重发 + 错误提示；手机号未注册提示

* [x] 前端 ProfilePage 新增「绑定手机号」区域：输入手机号 + 短信码 + 60s 倒计时 + 已绑定显示脱敏

* [x] `npm run lint` 0 error、`npm run build` 通过

* [x] package.json V1.11.0、Changelog 顶部追加 release 条目、版本管理规则同步更新

* [x] 生产 `.env` 配置 SPUG\_SMS\_TEMPLATE/SPUG\_MAIL\_TEMPLATE；前端 dist/ 更新；后端 rebuild + 重启服务

* [x] 端到端验证：邮箱注册→登录→发送码→输入码→成功；手机号注册→登录→发送码→输入码→成功；管理后台登录不受影响

