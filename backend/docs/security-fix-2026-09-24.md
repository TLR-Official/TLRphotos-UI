# TLRphotos 严重安全漏洞修复报告（V1.10.1）

- **修复日期**：2026-09-24
- **对应扫描**：外部安全检测 ID:2 ~ ID:7（漏洞发现于 2026-09-05，均标记"已验证"）
- **修复版本**：V1.10.1（PATCH，语义化版本；无 API 契约破坏性变更）
- **验证结论**：6 项漏洞全部修复，后端 162 项测试全部通过，线上双路径（源站直连 / 经 Cloudflare）回归通过。

---

## 漏洞与修复明细

### ID:2【高危】HTTP Desync 请求走私 — 已修复

- **位置**：`https://tlrphotos.com` 全站入口（Cloudflare → nginx → Express）
- **详情**：同一 TLS 连接发送重复 `Transfer-Encoding`（`chunked` 与混淆值 `x`）的 POST，并在 chunk 结束后追加一条独立 GET。Cloudflare 按单条请求处理返回单个 405，源站却将尾随 GET 解析为独立请求返回 200：客户端在一次 read 收到两条响应（`['405','200']`），后续显式 GET 无响应。重复 TE 是唯一变量，双 chunked 混淆变体稳定复现。攻击者可借残留请求队列毒化其他用户请求、访问内部路由或绕过 WAF。
- **修复**：
  1. 新增 `/etc/nginx/conf.d/desync.conf`：`map $http_transfer_encoding $bad_te` —— 仅缺省/空或精确单个 `chunked` 合法；重复头经 nginx 逗号合并（`chunked, x`）及任何非标准编码值一律判非法；
  2. 新增 `/etc/nginx/snippets/smuggling-guard.conf` 并由两个 vhost 引入：非法 TE → 400；`Content-Length` 与 `Transfer-Encoding` 共存（CL.TE / TE.CL 前提）→ 400；
  3. 应用层 Node v20.20.2 llhttp 保持严格解析，systemd 未启用任何 insecure parser 选项。
- **验证**：
  - 源站 TLS 双 TE 探针 → `400 Bad Request`，无尾随响应；
  - 经 CF 公网双 TE 探针 → 恰好 1 条响应 `400 Bad Request`；
  - 合法单一 chunked POST（/api/auth/login）→ 正常透传至应用（JSON 业务响应）。

### ID:3【中危】照片详情 IDOR + 时间戳 ID 可枚举 + CORS 通配 — 已修复

- **位置**：`GET /api/photos/{id}`
- **详情**：详情接口在无认证时返回完整元数据，资源 ID 为毫秒时间戳、连续可预测，配合列表接口可批量枚举；响应带 `Access-Control-Allow-Origin: *`，任意第三方站点脚本可跨域读取。
- **现状核实与修复**：
  1. 对象级访问控制经核实已具备：匿名仅可读取 `approved`，未登录读取未审核照片返回 404；照片属主可查看本人未审核照片（[photos.ts](../../backend/src/routes/photos.ts) 详情路由）；
  2. 新增回归测试锁定该隔离行为（匿名读取 pending → 404）；
  3. CORS 由 `*` 收紧为域名白名单（见下）；
  4. 公开读取按 IP 限速 120 次/分，抑制批量枚举。

### ID:4【中危】未授权文件上传端点可达 — 已修复

- **位置**：`POST /api/photos/upload`
- **详情**：multer 中间件排在认证之前，无任何凭证的请求直接进入 multipart 解析层并返回 400 `Unexpected field`（受保护端点此时应返回 401）。multer 为内存存储，未认证请求的文件已被完整缓冲，构成存储滥用与潜在未授权写入面。
- **修复**：路由链调整为 `requireAuth（JWT 认证 + 封禁/禁用检查）→ can_upload 权限检查 → multer → 错误处理 → 业务处理`，匿名请求在文件解析前即 401。新增 [requireAuth.ts](../../backend/src/middleware/requireAuth.ts)。
- **验证**：
  - 匿名 POST（空体与带 multipart 两种）→ 401 `AUTH_REQUIRED`，响应无 multer 错误特征；
  - 线上实测：`{"success":false,"message":"请先登录","code":"AUTH_REQUIRED"}`。

### ID:5【低危】登录口泄露 SQLite 引擎错误细节 — 已修复

- **位置**：`POST /api/auth/login`（注册口同类问题一并修复）
- **详情**：email 传入 JSON 对象（如 `{"$ne":"x"}`）时，值进入 better-sqlite3 参数列映射位置，抛出 `SQLITE_RANGE: column index out of range` 并原样回显，泄露数据库引擎与 ORM 技术栈，降低攻击者探测成本。
- **修复**：
  1. login/register 入口严格校验：email/password 必须为字符串、trim 后非空、长度上限 email 254 / password 200，非法输入统一返回 400 `请求参数格式不正确`；username 可选但须为字符串 ≤50；
  2. 新增全局错误处理中间件 [errorHandler.ts](../../backend/src/middleware/errorHandler.ts)：数据库/ORM 错误（SQLITE_*、errno、SQL 片段、磁盘路径）仅记录服务端日志，客户端只收到通用提示；body-parser 解析错误规范返回 400/413；
  3. `app.disable('x-powered-by')` + nginx `proxy_hide_header X-Powered-By`，双重隐藏框架指纹。
- **验证**：对象/数组/null 等类型输入（login + register 共 8 组用例）→ 400，响应体无 `SQLITE` / `column index` / `errno`；线上实测同样确认。

### ID:6【中危】照片列表未授权元数据与存储路径泄露 — 已修复

- **位置**：`GET /api/photos`
- **详情**：列表匿名可读，原实现回传服务端存储路径，且 CORS `*` + OPTIONS 声明全部方法（含 PUT/PATCH/DELETE）。
- **现状核实与修复**：
  1. 列表经核实已强制 `status = approved` + 分页（limit 上限 100）+ 仅 7 个公开字段；缩略图以代理 URL 返回，不暴露原始存储结构；
  2. CORS 方法收紧为实际使用的 `GET/POST/PUT/DELETE`（不再声明 PATCH），来源白名单化；
  3. 列表/搜索/详情统一限速。

### ID:7【高危】照片详情未授权 IDOR — 已修复

- 与 ID:3 同源。对象级状态隔离经核实有效（匿名 approved only），CORS 通配已移除，枚举限速已挂载，相关行为均有自动化回归测试覆盖。

---

## CORS 白名单策略

- 白名单经环境变量 `CORS_ALLOWED_ORIGINS`（逗号分隔）注入；默认：
  `https://tlrphotos.com, https://www.tlrphotos.com, https://admin.tlrphotos.com`
- 无 Origin 的同源/服务端/健康检查请求放行；非白名单来源 → 403 `CORS_BLOCKED`；
- 不携带凭证（`credentials: false`），预检缓存 86400 秒。
- 线上实测：非白名单请求 0 个 ACAO 响应头；白名单请求回显对应 Origin。

## 速率限制策略

| 端点 | 阈值（每 IP） |
|------|---------------|
| POST /api/auth/login、/register | 10 次 / 60 秒 |
| GET /api/photos、/api/photos/search、/api/photos/:id | 120 次 / 60 秒 |

超限返回 429 `RATE_LIMITED` + `Retry-After`。限速器为无依赖内存固定窗口实现。

## 测试与回归结果

- **自动化测试**：后端 10 个测试文件、**162 项全部通过**（本次新增 20 项回归：入口类型校验 9 项、上传认证前置 3 项、CORS 白名单 5 项、限速器 3 项）；
- **类型检查**：`tsc` 0 error；
- **nginx**：`nginx -t` 通过后 reload；
- **线上回归**：

| 探针 | 预期 | 结果 |
|------|------|------|
| 匿名 POST /api/photos/upload | 401 | ✅ 401 AUTH_REQUIRED |
| login email 对象 | 400 通用提示，无 SQLITE | ✅ |
| 非白名单 Origin（源站/经CF） | 无 ACAO | ✅ |
| 白名单 Origin | 回显 Origin | ✅ |
| X-Powered-By（源站/经CF） | 不存在 | ✅ |
| 双 TE 走私探针（源站/经CF） | 400 且单响应 | ✅ |
| 合法 chunked POST | 正常透传 | ✅ |
| 列表 / 详情核心功能 | 200 | ✅ |

## 后续加固建议（本次未实施）

1. **源站 443 仅允许 Cloudflare IP 段**（配合 Authenticated Origin Pulls）：防火墙规则变更存在锁死风险，需单独安排窗口与回滚预案后实施；
2. Cloudflare 侧为异常枚举（ID 连续扫描特征）配置告警与 WAF 规则；
3. 限速器在多实例部署前需替换为共享存储（Redis / CF rate limiting）。
