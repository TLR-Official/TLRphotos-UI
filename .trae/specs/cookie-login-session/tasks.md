# Cookie 登录状态管理 - The Implementation Plan (Decomposed and Prioritized Task List)

## [ ] Task 1: 创建加密工具函数
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 创建 `backend/src/utils/crypto.ts` 文件
  - 实现 AES-256-GCM 加密和解密函数
  - 使用环境变量存储加密密钥
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `programmatic` TR-1.1: 加密函数能正确加密字符串并返回密文
  - `programmatic` TR-1.2: 解密函数能正确解密密文并返回原始字符串
  - `programmatic` TR-1.3: 使用不同密钥解密应失败
- **Notes**: 使用 Node.js 内置 crypto 模块，无需额外依赖

## [ ] Task 2: 创建 cookie 数据库表
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 在 `backend/src/db.ts` 的 `initSchema` 函数中添加 cookie 表创建语句
  - 表结构：id(PK), user_id, session_token, encrypted_ip, created_at, last_active_at, expires_at
  - 创建索引：user_id, session_token, expires_at, last_active_at
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-2.1: 应用启动后 cookie 表存在
  - `programmatic` TR-2.2: cookie 表包含所有必要字段
  - `programmatic` TR-2.3: 索引正确创建
- **Notes**: 使用 SQL 的 CREATE TABLE IF NOT EXISTS 语句，避免重复创建

## [ ] Task 3: 实现 Cookie 服务层
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 创建 `backend/src/services/cookieService.ts` 文件
  - 实现以下功能：
    - `createSession`: 创建登录会话（加密IP地址）
    - `getSession`: 根据 session_token 获取会话并验证过期
    - `updateLastActive`: 更新最后活动时间
    - `deleteSession`: 删除指定会话
    - `cleanupExpired`: 清理所有过期会话
    - `getUserSessions`: 获取用户所有会话
    - `deleteUserSessions`: 删除用户所有会话
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-6
- **Test Requirements**:
  - `programmatic` TR-3.1: 创建会话后能正确读取
  - `programmatic` TR-3.2: 30天时间过期后会话不可用
  - `programmatic` TR-3.3: 7天无活动后会话不可用
  - `programmatic` TR-3.4: 更新活动时间能延长会话有效期
  - `programmatic` TR-3.5: cleanupExpired 能正确删除过期会话
- **Notes**: 双重过期检查：expires_at（30天）和 last_active_at + 7天

## [ ] Task 4: 更新认证路由和服务
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 修改 `backend/src/services/authService.ts` 的 `login` 函数，接受 remember 参数
  - 修改 `backend/src/routes/auth.ts` 的登录接口，支持 remember 参数
  - 修改 `/me` 接口，更新会话活动时间
  - 修改 `/logout` 接口，删除会话记录
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-4.1: 登录时传递 remember=true 能创建会话记录
  - `programmatic` TR-4.2: 登录时传递 remember=false 不创建会话记录
  - `programmatic` TR-4.3: 访问 /me 时能更新最后活动时间
  - `programmatic` TR-4.4: 登出时能删除会话记录
- **Notes**: 登录成功后返回 session_token，用于后续自动登录

## [ ] Task 5: 实现自动登录接口
- **Priority**: high
- **Depends On**: Task 4
- **Description**: 
  - 在 `backend/src/routes/auth.ts` 中添加 `/refresh` 接口
  - 接口接受 session_token，验证会话有效性后返回新的 JWT token
  - 更新会话的最后活动时间
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `programmatic` TR-5.1: 使用有效 session_token 能获取新的 JWT token
  - `programmatic` TR-5.2: 使用过期 session_token 返回错误
  - `programmatic` TR-5.3: 使用无效 session_token 返回错误
- **Notes**: 自动登录成功后更新活动时间

## [ ] Task 6: 更新前端登录页面
- **Priority**: high
- **Depends On**: Task 5
- **Description**: 
  - 修改 `src/features/auth/AuthPage.tsx`，添加"保存登录状态"复选框
  - 修改登录逻辑，传递 remember 参数
  - 修改 `src/api/auth.ts` 的 login 函数，支持 remember 参数
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `human-judgment` TR-6.1: 登录页面显示"保存登录状态"复选框
  - `human-judgment` TR-6.2: 勾选复选框后登录请求包含 remember=true
  - `human-judgment` TR-6.3: 未勾选时登录请求不包含 remember 参数或为 false
- **Notes**: 复选框默认不勾选

## [ ] Task 7: 更新前端 UserContext 实现自动登录
- **Priority**: high
- **Depends On**: Task 6
- **Description**: 
  - 修改 `src/shared/UserContext.tsx`，在应用启动时检查 session_token
  - 调用 `/api/auth/refresh` 接口实现自动登录
  - 存储 session_token 到 localStorage
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5
- **Test Requirements**:
  - `programmatic` TR-7.1: 应用启动时存在有效 session_token 能自动登录
  - `programmatic` TR-7.2: session_token 过期时自动清除并要求重新登录
  - `programmatic` TR-7.3: 登出时清除 session_token
- **Notes**: 自动登录失败时不影响用户正常登录流程

## [ ] Task 8: 添加定时清理任务
- **Priority**: medium
- **Depends On**: Task 3
- **Description**: 
  - 在 `backend/src/server.ts` 中添加定时任务
  - 每天凌晨执行一次 cleanupExpired
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `programmatic` TR-8.1: 定时任务能正确执行并清理过期会话
  - `human-judgment` TR-8.2: 定时任务配置正确，每天凌晨执行
- **Notes**: 使用 Node.js 的 setTimeout 和 setInterval 实现，无需额外依赖

## [ ] Task 9: 更新 API 文档
- **Priority**: medium
- **Depends On**: Task 5
- **Description**: 
  - 更新 `backend/docs/api.md`，添加新接口文档和参数说明
- **Acceptance Criteria Addressed**: 所有 AC
- **Test Requirements**:
  - `human-judgment` TR-9.1: API 文档完整，包含新接口说明
  - `human-judgment` TR-9.2: 参数说明准确
- **Notes**: 按照现有文档格式添加
