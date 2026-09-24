# 严重安全漏洞修复实施计划

> 对应外部扫描报告 ID:2 ~ ID:7（发现时间 2026-09-05，已验证）
> 计划版本：V1.10.1（PATCH，安全修复，无 API 契约破坏）

## 一、Repository Research（漏洞现状核实结论）

扫描距今 19 天，期间后端已上线 V1.5.0~V1.10.0 并两次重启。经代码审计 + 对线上运行服务做非侵入式复测，确认现状如下：

| 报告 ID | 级别 | 漏洞 | 当前核实结果 |
|---------|------|------|--------------|
| ID:2 | 高危 | HTTP Desync 请求走私：同一 TLS 连接发送重复 Transfer-Encoding（chunked + x），CF 与源站对请求边界解析不一致，可走私尾随 GET | **仍存在风险**。nginx 1.18.0 两个 vhost 均无 TE 检查 / CL+TE 共存检查；Node v20.20.2 llhttp 虽严格，但重复 TE 经 nginx 透传后仍被解析（扫描证据稳定复现） |
| ID:3 | 中危 | 详情接口 IDOR + 毫秒时间戳 ID 可批量枚举 + CORS `*` | **部分仍存在**。详情接口已做状态隔离（匿名仅 approved、属主可见本人未审核，[photos.ts#L307-L334](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/photos.ts#L307-L334)），未审核照片不能被匿名读取；但 CORS `Access-Control-Allow-Origin: *` 线上实测仍存在 |
| ID:4 | 中危 | POST /api/photos/upload 无认证直达 multer，错误字段返回 400 而非 401；且 multer 为内存存储，未认证请求已被完整缓冲（资源滥用） | **仍存在，线上实测 HTTP 400**。根因：`router.post('/upload', upload.single('image'), ...)` 中 multer 排在认证之前，认证在 handler 体内才执行（[photos.ts#L878](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/photos.ts#L878)） |
| ID:5 | 低危 | 登录口 email 传对象时，值进入 better-sqlite3 参数绑定位置抛出 `SQLITE_RANGE`，错误原文回显客户端 | **仍存在，线上实测回显 `SQLITE_RANGE: column index out of range`**。login/register 均仅做真值检查（`!email`），无类型校验；catch 直接回显 `error.message`（[auth.ts#L127-L178](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/auth.ts#L127-L178)） |
| ID:6 | 中危 | 列表接口未授权返回全量记录、暴露内部存储路径、CORS 全方法 | **部分已修复**。列表已强制 approved + 分页 + 仅 7 个公开字段，thumbnail 已改代理 URL（[photos.ts#L261-L299](file:///opt/tlr-photos-ui/TLRphotos-UI/backend/src/routes/photos.ts#L261-L299)）；但 CORS `*` + 全方法声明仍在 |
| ID:7 | 高危 | 详情接口未授权 IDOR | 同 ID:3：对象级状态隔离已具备，**CORS 通配仍在**；另外无限速/枚举告警 |

**业务基线约束**：本站为公开交通摄影画廊，匿名浏览 approved 照片列表/详情是**设计内功能**，不能要求列表/详情强制登录。修复边界 = ①未审核照片继续不可读（现状已满足，加回归测试锁定）；②消除跨域通配、指纹头、错误泄露、未认证上传解析、走私面；③补枚举速率限制。

## 二、Files and Modules

### 新建
- `backend/src/middleware/requireAuth.ts`：JWT 认证中间件（封装 loadAuthUser），未认证/封禁/禁用在进入 multer 前拦截；含 Express Request 类型增强（`authUser`）
- `backend/src/middleware/errorHandler.ts`：全局错误处理中间件，统一脱敏（SQLITE_* / errno / SQL 片段不外显），解析 body-parser / CORS 错误为规范 JSON
- `backend/src/middleware/rateLimit.ts`：轻量内存固定窗口限速器（按客户端 IP，复用现有 getClientIp），不引入新依赖
- `backend/docs/security-fix-2026-09-24.md`：修复说明文档（用户明确要求：漏洞详情 / 修复方法 / 验证结果）
- `/etc/nginx/conf.d/desync.conf`：http 级 `map`，标记非法 Transfer-Encoding
- `/etc/nginx/snippets/smuggling-guard.conf`：server 级守卫（非法 TE / CL+TE 共存 → 400）

### 修改
- `backend/src/server.ts`：
  - `app.disable('x-powered-by')`
  - `cors()` → 白名单配置（域名经 env `CORS_ALLOWED_ORIGINS` 注入，默认仅三个本站域名；methods 仅 GET/POST/PUT/DELETE；allowedHeaders 仅 Content-Type/Authorization/X-Session-Token；不带 credentials）
  - 路由后挂载全局 errorHandler
  - 限速器实例挂载到认证口与照片查询口
- `backend/src/routes/auth.ts`：login/register 入口增加严格类型校验（email/password 必须为 string；trim 后非空；长度上限 email 254 / password 200），非法输入 400 统一中文提示
- `backend/src/routes/photos.ts`：
  - `/upload` 路由链改为 `requireAuth → can_upload 权限检查 → multer → handleUploadError → handler`，匿名请求 401，multer 不再先于认证执行
  - 照片列表/详情与登录注册口挂载限速
- `backend/.env.example`：增加 `CORS_ALLOWED_ORIGINS` 占位说明
- `/etc/nginx/sites-available/tlrphotos`、`/etc/nginx/sites-available/tlrphotos-admin`：两个 443 server 内 `include snippets/smuggling-guard.conf;`，/api/ location 增加 `proxy_hide_header X-Powered-By;`
- `backend/tests/integration/auth.test.ts`、`photos.test.ts`：新增回归用例
- `backend/docs/api.md`：补「安全约束」小节（CORS 白名单、上传认证顺序、限速）
- 根目录 `package.json`：1.10.0 → 1.10.1
- `.ai/context.md`：Changelog 顶部追加修复条目与版本条目

## 三、Implementation Steps（按依赖顺序）

1. **认证中间件**：新建 `requireAuth.ts`（复用 loadAuthUser；error → 对应 401 JSON；无 user → 401 AUTH_REQUIRED；成功写 `req.authUser`）
2. **限速中间件**：新建 `rateLimit.ts`（固定窗口，Map 计数 + 60s 周期清扫；返回 429 标准信封）
3. **错误处理中间件**：新建 `errorHandler.ts`（白名单化错误信息：正则识别数据库引擎/解析错误 → 500「服务器内部错误」；body-parser SyntaxError → 400；CORS 错误 → 403；完整错误仅落服务端日志）
4. **改造 server.ts**：disable x-powered-by → 白名单 CORS → 限速挂载（登录/注册：10 次/分；照片列表/详情：120 次/分）→ 路由后挂 errorHandler
5. **改造 auth.ts**：login/register 入口类型与长度校验
6. **改造 photos.ts 上传链**：requireAuth + 内联 can_upload 检查置于 multer 之前；handler 内现有认证/权限/人机验证逻辑保留（纵深防御，不删除）
7. **回归测试**（先写期望再验证）：
   - 无认证 POST /upload → 401（断言不是 400，且响应无 multer 错误特征）
   - login/register email 为对象/数组/null → 400 通用提示；全响应体不得出现 `SQLITE`
   - 匿名读取未审核照片 ID → 404（锁定现有隔离行为）
   - 非白名单 Origin 请求 → 不出现 Access-Control-Allow-Origin；白名单 Origin → 回显该 Origin
   - 所有响应无 X-Powered-By
   - 限速触发 → 429
8. **nginx 走私防护**：conf.d map（空/精确 chunked 合法，其余含逗号合并值一律非法）+ snippet 守卫（非法 TE、CL+TE 共存返回 400）→ 两个 vhost include → `nginx -t` → reload
9. **文档**：security-fix-2026-09-24.md（六漏洞逐项：描述/影响/修复/验证证据）+ api.md 安全小节
10. **版本与 Context**：package.json 1.10.1；Changelog 追加版本条目与修复条目
11. **部署**：backend `npm run build` → 重启 tlrphotos-backend → nginx reload
12. **安全回归（线上实测）**：
    - 应用层：重放本轮 4 项 curl 探针（上传口 401、类型混淆 400 无 SQLITE、CORS 无通配、无 X-Powered-By）
    - 走私：经 nginx（127.0.0.1）与经 CF（tlrphotos.com）用 openssl s_client 各发一次双 TE 探针，断言 400 且同连接无尾随响应；合法 chunked POST 行为不变
    - 全量 `npm test` 通过
13. **Git**：仅暂存本次相关文件，commit `[fix] 修复扫描确认的6项安全漏洞(HTTP走私/未授权上传/错误泄露/CORS) | V1.10.1 | 时间`，push main

## 四、Dependencies and Considerations

- 不新增 npm 依赖（限速器手写）；无需前端改动与前端 rebuild（前端同源请求，不受 CORS 白名单影响）
- CORS 白名单默认值：`https://tlrphotos.com,https://www.tlrphotos.com,https://admin.tlrphotos.com`；无 Origin 的同源/服务端请求照常放行
- nginx `if + return` 为官方认可的安全用法；守卫放在 server 级，静态资源与 /api 均受保护
- nginx 对重复头以逗号合并，正是 map 可捕获的特征；合法单一 chunked 不受影响（PUT/POST 大文件上传走 multipart + Content-Length，不依赖 TE 透传）
- 限速器为进程内状态，服务重启即清零，单实例部署下无一致性问题
- 测试环境已有的 tokens 绕过（TEST_BYPASS_TOKEN）与限速不冲突；限速窗口在测试中用大阈值/可控参数避免污染套件

## 五、Validation

- `cd backend && npm test`：全量用例（含新增回归）全部通过
- `cd backend && npm run build`：tsc 0 error
- `nginx -t`：syntax ok + test successful
- 线上 4 类应用层探针 + 2 路径走私探针全部符合预期
- 核心功能冒烟：匿名浏览列表/详情、登录、（测试账号）上传链不受影响

## 六、Risks

- **CORS 白名单误伤**：若存在尚未列出的合法第三方消费端 → 经 `CORS_ALLOWED_ORIGINS` env 即时追加，无需改代码
- **nginx 规则误拦合法请求**：reload 前用 `nginx -t` 校验，上线后立即用合法 chunked/multipart POST 冒烟；异常时 `include` 行可即时回滚并重 reload
- **走私阻断改变 CF 回源行为**：仅拦截畸形请求，规范请求帧不变；双路径（直连 nginx / 经 CF）实测确认
- **限速影响正常用户**：NAT/校园网共享 IP 可能集中命中，阈值已放宽（照片 120/min、登录 10/min），429 响应带明确提示
- **源站 443 仅允许 CF IP 段**（扫描报告建议项）：本次**不默认实施**，防火墙变更存在锁死风险；修复报告中列为后续加固建议，需用户单独确认后再执行
