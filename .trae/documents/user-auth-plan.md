# 用户认证功能实现计划

## 一、需求分析

### 1.1 业务需求

* 在数据库中新增用户存储区域（users 表）

* 开发登录/注册一体化页面，通过流畅动画切换

* 支持邮箱+密码登录和注册

* 预留微信、QQ第三方登录入口（先UI，最好实现真实OAuth）

* 主题切换无缝衔接，无突兀变化

### 1.2 技术约束

* 纯代码后端（Node.js + Express + sqlite3）

* 前端 React + TypeScript + TailwindCSS

* 遵循"后端模型 → API路由 → api.md → 前端数据层 → 联调"顺序

* 所有颜色使用CSS变量或Tailwind dark:前缀

## 二、文件与模块规划

### 2.1 后端文件

| 文件路径                                  | 说明                    |
| ------------------------------------- | --------------------- |
| `backend/src/db.ts`                   | 新增 users 表结构          |
| `backend/src/services/authService.ts` | 用户认证服务（注册、登录、密码加密）    |
| `backend/src/routes/auth.ts`          | 认证API路由（注册、登录、获取用户信息） |
| `backend/docs/api.md`                 | 更新API契约文档             |

### 2.2 前端文件

| 文件路径                             | 说明            |
| -------------------------------- | ------------- |
| `src/features/auth/AuthPage.tsx` | 登录/注册一体化页面组件  |
| `src/features/auth/types.ts`     | 用户相关类型定义      |
| `src/api/auth.ts`                | 认证API调用函数     |
| `src/shared/UserContext.tsx`     | 用户状态管理Context |
| `src/shared/Header.tsx`          | 添加登录按钮        |
| `src/App.tsx`                    | 添加认证页面路由      |

### 2.3 依赖新增

| 包名             | 用途         |
| -------------- | ---------- |
| `bcrypt`       | 密码加密与验证    |
| `jsonwebtoken` | JWT令牌生成与验证 |

## 三、实施步骤

### 步骤1：后端数据库Schema更新

**文件**: `backend/src/db.ts`

新增 users 表结构：

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  wechat_openid TEXT,
  qq_openid TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 步骤2：创建认证服务

**文件**: `backend/src/services/authService.ts`

功能：

* `register(email, password, username)` - 用户注册

* `login(email, password)` - 用户登录

* `verifyToken(token)` - 验证JWT令牌

* `getUserById(id)` - 获取用户信息

安全措施：

* 使用 bcrypt 加密密码（saltRounds=10）

* JWT令牌过期时间设置为24小时

### 步骤3：创建认证路由

**文件**: `backend/src/routes/auth.ts`

路由定义：

| 方法   | 路径                   | 说明             |
| ---- | -------------------- | -------------- |
| POST | `/api/auth/register` | 用户注册           |
| POST | `/api/auth/login`    | 用户登录           |
| GET  | `/api/auth/me`       | 获取当前用户信息（需JWT） |
| POST | `/api/auth/logout`   | 退出登录           |

### 步骤4：更新API文档

**文件**: `backend/docs/api.md`

添加认证接口文档，包含请求/响应格式。

### 步骤5：创建前端用户Context

**文件**: `src/shared/UserContext.tsx`

管理用户登录状态，提供：

* `user` - 当前用户信息

* `isAuthenticated` - 是否登录

* `login()` - 登录方法

* `register()` - 注册方法

* `logout()` - 退出方法

### 步骤6：创建认证API

**文件**: `src/api/auth.ts`

封装后端认证接口调用。

### 步骤7：创建登录/注册页面组件

**文件**: `src/features/auth/AuthPage.tsx`

核心功能：

* 登录/注册切换的流畅动画（滑动/淡入淡出）

* 邮箱+密码表单验证

* 第三方登录入口（微信、QQ）

* 响应式设计，支持移动端

* 深色/浅色主题无缝切换

### 步骤8：更新Header组件

**文件**: `src/shared/Header.tsx`

添加登录/注册按钮，根据登录状态显示不同内容。

### 步骤9：更新路由配置

**文件**: `src/App.tsx`

添加 `/auth` 路由。

## 四、关键技术实现

### 4.1 登录/注册切换动画

使用 CSS transition 和 React 状态管理实现平滑切换：

* 登录表单向左滑出，注册表单向右滑入

* 按钮文本平滑过渡

* 背景颜色渐变过渡

### 4.2 主题适配

所有颜色使用 TailwindCSS 的 `dark:` 前缀：

```tsx
className={`${isDark ? 'text-white' : 'text-gray-900'}`}
```

### 4.3 第三方登录入口

仅实现UI层，点击后提示"功能开发中"，预留扩展接口。

## 五、风险与注意事项

### 5.1 安全风险

* 密码必须加密存储，禁止明文

* JWT令牌必须设置过期时间

* 登录接口需防止暴力破解（可后续添加限流）

### 5.2 数据库迁移

* 新增表使用 `CREATE TABLE IF NOT EXISTS`，避免重复创建

### 5.3 环境变量

* JWT\_SECRET 需要在 `.env.example` 中添加

## 六、验证标准

1. ✅ 数据库成功创建 users 表
2. ✅ 注册接口返回成功并加密密码
3. ✅ 登录接口返回 JWT 令牌
4. ✅ 前端登录/注册页面动画流畅
5. ✅ 主题切换无突兀变化
6. ✅ Header 登录按钮根据状态显示正确内容
7. ✅ Lint 检查通过

