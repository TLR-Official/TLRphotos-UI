# 用户个人页面开发计划

## 1. 需求分析

### 1.1 功能需求

| 功能模块 | 子功能 | 需求描述 |
|---------|-------|---------|
| 个人资料管理 | 头像上传 | 支持 JPG/PNG 格式，提供预览功能 |
| | 资料编辑 | 姓名、联系方式、简介等基本信息 |
| | 扩展资料 | 允许用户添加自定义信息项 |
| | 密码修改 | 原密码验证 + 新密码设置 + 确认 |
| 隐私设置 | 公开/私密切换 | 为每个资料项提供切换选项 |
| | 前端加密 | 私密资料前端加密存储 |
| | 密码加密 | 使用 bcrypt 加密存储 |
| 导航栏集成 | 用户信息展示 | 显示头像和用户名 |
| | 下拉菜单 | 悬停弹出：个人资料、已上传图片等 |
| 安全与体验 | 表单验证 | 即时验证和反馈 |
| | 二次确认 | 敏感操作需确认 |
| | 响应式设计 | 适配不同设备 |
| | 本地缓存 | 提升加载速度 |

### 1.2 技术约束

- 后端：Node.js + Express + SQLite（sqlite3）
- 前端：React + TypeScript + TailwindCSS
- 密码加密：bcrypt（已引入）
- 头像存储：本地服务器（开发环境）/ Cloudflare R2（生产环境）

---

## 2. 现有代码分析

### 2.1 后端

**数据库表结构** (`backend/src/db.ts`)：
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

**认证服务** (`backend/src/services/authService.ts`)：
- 已有：`register`, `login`, `verifyToken`, `getUserById`
- 缺少：`updateUser`, `changePassword`, `uploadAvatar`

**认证路由** (`backend/src/routes/auth.ts`)：
- 已有：`POST /register`, `POST /login`, `GET /me`, `POST /logout`
- 缺少：`PUT /me`, `PUT /me/password`, `POST /me/avatar`

### 2.2 前端

**用户上下文** (`src/shared/UserContext.tsx`)：
- 已有：登录、注册、退出
- 缺少：更新用户信息、获取用户详细资料

**Header 组件** (`src/shared/Header.tsx`)：
- 当前：仅显示登录/退出按钮
- 需要：显示用户头像和下拉菜单

**API 层** (`src/api/auth.ts`)：
- 已有：`login`, `register`, `getCurrentUser`
- 缺少：`updateUser`, `changePassword`, `uploadAvatar`

---

## 3. 实现计划

### 3.1 后端修改

#### 3.1.1 数据库表结构更新

**文件**: `backend/src/db.ts`

新增字段：
- `bio TEXT` - 用户简介
- `phone TEXT` - 联系方式
- `website TEXT` - 个人网站
- `location TEXT` - 位置
- `custom_fields TEXT` - 自定义字段（JSON）

#### 3.1.2 认证服务扩展

**文件**: `backend/src/services/authService.ts`

新增方法：
- `updateUser(userId, data)` - 更新用户资料
- `changePassword(userId, oldPassword, newPassword)` - 修改密码
- `updateAvatar(userId, avatarUrl)` - 更新头像

#### 3.1.3 认证路由扩展

**文件**: `backend/src/routes/auth.ts`

新增路由：
- `PUT /api/auth/me` - 更新用户资料
- `PUT /api/auth/me/password` - 修改密码
- `POST /api/auth/me/avatar` - 上传头像

#### 3.1.4 API 文档更新

**文件**: `backend/docs/api.md`

更新认证相关接口文档。

### 3.2 前端修改

#### 3.2.1 API 层扩展

**文件**: `src/api/auth.ts`

新增函数：
- `updateUser(data)` - 更新用户资料
- `changePassword(oldPassword, newPassword)` - 修改密码
- `uploadAvatar(file)` - 上传头像

#### 3.2.2 用户上下文扩展

**文件**: `src/shared/UserContext.tsx`

新增方法：
- `updateUserInfo(data)` - 更新用户信息
- `refreshUser()` - 刷新用户数据

#### 3.2.3 Header 组件更新

**文件**: `src/shared/Header.tsx`

修改内容：
- 登录状态显示用户头像和用户名
- 悬停显示下拉菜单（个人资料、已上传图片等）
- 下拉菜单包含退出登录选项

#### 3.2.4 用户个人页面

**文件**: `src/features/profile/ProfilePage.tsx`（新建）

页面结构：
- 侧边栏：头像、基本信息、导航菜单
- 主内容区：资料编辑、隐私设置、密码修改

#### 3.2.5 路由配置更新

**文件**: `src/App.tsx`

新增路由：
- `/profile` - 用户个人页面

### 3.3 隐私加密方案

#### 3.3.1 前端加密

使用 Crypto API 对私密字段进行加密：
- 加密算法：AES-GCM
- 密钥来源：用户密码哈希 + 随机盐

#### 3.3.2 字段隐私标记

在 `custom_fields` JSON 中标记每个字段的隐私状态：
```json
{
  "字段名": {
    "value": "加密后的值",
    "isPrivate": true
  }
}
```

---

## 4. 文件变更清单

### 4.1 新建文件

| 文件路径 | 描述 |
|---------|------|
| `src/features/profile/ProfilePage.tsx` | 用户个人页面组件 |
| `src/features/profile/types.ts` | 类型定义 |

### 4.2 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `backend/src/db.ts` | 更新 users 表结构 |
| `backend/src/services/authService.ts` | 新增用户更新和密码修改方法 |
| `backend/src/routes/auth.ts` | 新增 PUT/POST 路由 |
| `backend/docs/api.md` | 更新 API 文档 |
| `src/api/auth.ts` | 新增 API 调用函数 |
| `src/shared/UserContext.tsx` | 新增状态更新方法 |
| `src/shared/Header.tsx` | 添加用户下拉菜单 |
| `src/App.tsx` | 新增个人页面路由 |
| `.ai/context.md` | 更新 Changelog |

---

## 5. 风险与注意事项

### 5.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 头像上传大小限制 | 服务器资源消耗 | 设置文件大小限制（如 5MB） |
| 前端加密密钥管理 | 数据丢失风险 | 使用 localStorage 存储密钥 |
| 密码修改安全 | 暴力破解风险 | 增加请求频率限制 |
| XSS 攻击 | 用户数据泄露 | 前端输入验证 + 后端过滤 |

### 5.2 兼容性

- 确保在深色/浅色主题下都有良好显示
- 响应式设计适配移动端

---

## 6. 实施步骤

1. 更新数据库表结构
2. 扩展后端认证服务
3. 扩展后端路由
4. 更新 API 文档
5. 扩展前端 API 层
6. 更新用户上下文
7. 更新 Header 组件
8. 创建用户个人页面
9. 更新路由配置
10. 更新 Context 文档

---

## 7. 验证方案

1. **注册新用户** → 登录 → 查看个人页面
2. **编辑个人资料** → 保存 → 刷新验证
3. **上传头像** → 预览 → 保存验证
4. **修改密码** → 旧密码错误验证 → 新密码规则验证
5. **隐私设置** → 切换公开/私密 → 验证加密存储
6. **下拉菜单** → 悬停显示 → 点击跳转验证
7. **响应式测试** → 移动端适配验证
