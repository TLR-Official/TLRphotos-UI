# Cookie 登录状态管理 - Product Requirement Document

## Overview
- **Summary**: 设计并实现一个名为"cookie"的后端数据库表，用于存储用户登录状态信息，实现"记住我"功能
- **Purpose**: 允许用户选择是否保存登录状态，实现双重过期机制（30天时间过期 + 7天活动过期），保护敏感数据安全
- **Target Users**: 所有网站用户

## Goals
- 创建 cookie 数据库表，存储用户登录状态信息
- 实现双重过期机制：30天绝对过期 + 7天无活动过期
- 对敏感数据（IP地址等）进行加密存储
- 在前端登录界面添加"保存登录状态"复选框
- 建立定期清理过期登录状态的机制

## Non-Goals (Out of Scope)
- 不修改现有的 JWT 认证机制
- 不引入新的第三方认证服务
- 不实现 OAuth/SAML 等第三方登录集成

## Background & Context
- 现有认证系统使用 JWT token，存储在 localStorage 中，token 有效期为 24 小时
- 用户每次打开网页都需要重新登录
- 需要实现"记住我"功能，让用户可以选择持久化登录状态

## Functional Requirements
- **FR-1**: 创建 cookie 数据库表，包含用户ID、会话token、IP地址（加密）、创建时间、最后活动时间等字段
- **FR-2**: 实现双重过期机制：自登录后30天绝对过期，7天无活动自动过期
- **FR-3**: 对所有敏感数据（特别是IP地址）进行加密存储和安全解密
- **FR-4**: 前端登录界面添加"保存登录状态"复选框
- **FR-5**: 仅当用户主动勾选复选框时，才保存登录状态到数据库
- **FR-6**: 未勾选时，不保存登录状态，用户每次打开网页需重新登录
- **FR-7**: 实现定期检查和清理过期登录状态的机制

## Non-Functional Requirements
- **NFR-1**: 加密解密过程必须安全可靠，使用 AES-256-GCM 算法
- **NFR-2**: 过期检查机制不能影响系统性能，采用定时任务异步清理
- **NFR-3**: 登录状态数据仅存储在本地 SQLite 数据库，不上传至任何外部服务
- **NFR-4**: 数据库查询必须高效，为过期检查字段创建索引

## Constraints
- **Technical**: Node.js + Express + SQLite，使用 Node.js 内置 crypto 模块进行加密
- **Dependencies**: 仅使用现有依赖，不引入新的加密库

## Assumptions
- 用户浏览器支持 localStorage 和 HTTP cookies
- 服务器有足够的权限执行定时任务
- 数据库加密密钥通过环境变量注入

## Acceptance Criteria

### AC-1: Cookie 数据库表创建成功
- **Given**: 应用启动时
- **When**: 数据库初始化完成
- **Then**: cookie 表被正确创建，包含必要字段和索引
- **Verification**: `programmatic`

### AC-2: 敏感数据加密存储
- **Given**: 用户登录并勾选"保存登录状态"
- **When**: 登录状态写入数据库
- **Then**: IP地址等敏感数据以加密形式存储，无法直接读取
- **Verification**: `programmatic`

### AC-3: 30天时间过期机制
- **Given**: 用户登录并勾选"保存登录状态"，记录创建时间为 T0
- **When**: 系统时间到达 T0 + 30天
- **Then**: 该登录状态被标记为过期，用户需重新登录
- **Verification**: `programmatic`

### AC-4: 7天活动过期机制
- **Given**: 用户登录并勾选"保存登录状态"，最后活动时间为 T0
- **When**: 用户连续7天未进行任何操作，系统时间到达 T0 + 7天
- **Then**: 该登录状态被标记为过期，用户需重新登录
- **Verification**: `programmatic`

### AC-5: 前端"保存登录状态"复选框功能
- **Given**: 用户打开登录页面
- **When**: 用户勾选/取消勾选"保存登录状态"复选框
- **Then**: 登录请求中正确传递 remember 参数，后端根据参数决定是否保存登录状态
- **Verification**: `human-judgment`

### AC-6: 定期清理过期登录状态
- **Given**: 系统运行中
- **When**: 定时任务触发（每天凌晨）
- **Then**: 所有过期的登录状态记录被自动删除
- **Verification**: `programmatic`

## Open Questions
- [ ] 加密密钥的存储方式（环境变量）
- [ ] 定期清理任务的具体时间配置
