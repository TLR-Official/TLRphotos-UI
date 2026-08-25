# TLRphotos API 契约文档

## 基础信息

- **基础路径**: `/api`
- **后端地址**: `http://localhost:3001`
- **数据格式**: JSON
- **统一响应格式**:
  ```json
  {
    "success": true,
    "data": {},
    "message": ""
  }
  ```

---

## 照片接口 (Photos)

### 获取照片列表

**GET** `/api/photos`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "000001",
      "title": "城市天际线",
      "thumbnail_path": "https://picsum.photos/seed/aero1/1200/800",
      "tags": ["城市", "航拍", "日落"],
      "width": 1200,
      "height": 800,
      "created_at": "2024-05-15T18:30:00Z"
    }
  ]
}
```

### 搜索照片

**GET** `/api/photos/search`

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 关键词（匹配标题、描述） |
| tag | string | 标签筛选 |
| sortBy | string | 排序字段（created_at/likes/views/title），默认created_at |
| sortOrder | string | 排序顺序（asc/desc），默认desc |

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "000001",
      "title": "城市天际线",
      "thumbnail_path": "https://picsum.photos/seed/aero1/1200/800",
      "tags": ["城市", "航拍", "日落"],
      "width": 1200,
      "height": 800,
      "likes": 1256,
      "views": 8932,
      "created_at": "2024-05-15T18:30:00Z"
    }
  ]
}
```

### 获取所有标签

**GET** `/api/photos/tags`

**响应**:
```json
{
  "success": true,
  "data": ["城市", "航拍", "日落", "自然", "全景"]
}
```

### 获取照片详情

**GET** `/api/photos/:id`

**V1.7.0 权限检查**：
- 匿名访客（无 token）放行公开已审核照片
- 被封禁/禁用用户的 token 不降级为匿名，返回 `401 { code: "USER_BANNED" / "USER_DISABLED" }`
- 登录用户 `can_view=0` 返回 `403 { code: "PERMISSION_DENIED", message: "您已被禁止查看图片" }`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 照片ID |

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "000001",
    "title": "城市天际线",
    "thumbnail_path": "https://picsum.photos/seed/aero1/1200/800",
    "original_url": "https://picsum.photos/seed/aero1/2048/1365",
    "tags": ["城市", "航拍", "日落"],
    "width": 1200,
    "height": 800,
    "description": "傍晚时分，城市的天际线...",
    "camera_model": "Sony A7R IV",
    "vehicle": "DJI Mavic 3 Pro",
    "location": "上海市浦东新区",
    "focal_length": "24mm",
    "iso": 100,
    "shutter_speed": "1/500s",
    "aperture": "f/8",
    "likes": 1256,
    "views": 8932,
    "is_liked": false,
    "created_at": "2024-05-15T18:30:00Z"
  }
}
```

**字段说明**:
- `is_liked`: 当前登录用户是否已点赞；未登录或未点赞时返回 `false`，前端用于切换点赞按钮视觉状态
- `views`: 经过 24h 去重后的有效浏览数（同一 viewer_key 在窗口内重复访问只计 1 次）

### 点赞照片

**POST** `/api/photos/:id/like`

**需登录**：请求头必须包含 `Authorization: Bearer <token>`，未登录或令牌无效返回 `401 { success: false, message: "请先登录后点赞", code: "AUTH_REQUIRED" }`。用户身份从 JWT 解析，不再从请求体取 `userId`（杜绝前端硬编码 anonymous 导致一个匿名点赞后所有人无法再赞的 bug）。

**V1.7.0 权限检查**：被封禁用户返回 `401 { code: "USER_BANNED" }`；`can_like=0` 返回 `403 { code: "PERMISSION_DENIED", message: "您已被禁止点赞" }`。

**请求体**: 无需（用户身份来自 JWT）

**响应**:
```json
{
  "success": true,
  "data": {
    "likes": 1257,
    "is_liked": true
  }
}
```

重复点赞幂等返回当前计数 + `is_liked: true`（不重复增加）。

### 取消点赞照片

**DELETE** `/api/photos/:id/like`

**需登录**：与点赞接口对称。

**请求体**: 无需

**响应**:
```json
{
  "success": true,
  "data": {
    "likes": 1256,
    "is_liked": false
  }
}
```

未点赞时幂等返回当前计数 + `is_liked: false`。

### 增加浏览量（24h 去重）

**POST** `/api/photos/:id/view`

**响应**:
```json
{
  "success": true,
  "data": {
    "views": 8933,
    "counted": true
  }
}
```

**字段说明**:
- `counted`: 本次浏览是否被计入；`false` 表示在 24h 去重窗口内被跳过未自增

**浏览去重机制**（适用于 GET `/api/photos/:id` 与 POST `/api/photos/:id/view`）：
- **viewer_key 计算**：登录用户取 `user:<userId>`，未登录用户取 `ip:<clientIp>`（从 X-Forwarded-For 首段提取，Nginx 反代后真实客户端 IP）
- **去重窗口**：24 小时。同一 (photo_id, viewer_key) 在窗口内重复访问只计 1 次有效浏览
- **去重存储**：`photo_views` 表，`(photo_id, viewer_key)` 联合主键 + `last_viewed_at` 时间戳；每小时定时清理 7 天前的旧记录
- **事务一致性**：sqlite3 单连接默认串行化执行，SELECT→UPDATE→INSERT 序列调用之间不会被其他请求插入，等价于原子事务

### 图片代理（原图/缩略图/预览/水印图）

**GET** `/api/photos/image/:key`

所有图片地址（`original_url`/`thumbnail_path`/`preview_url`/`watermarked_url`）均经此通配符路由代理，避免暴露 OSS 直链。后端按 OSS Key 生成预签名 URL 后流式回传（pipeline 自动背压），不全部载入内存。

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| key | string（URL 编码） | OSS 对象 Key，如 `photos/watermarked/xxx_watermarked.webp` |

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| photoId | string | 照片 ID，用于代理路由快速鉴权（按照片状态+所有者判定访问权限） |
| download | string | 传 `1` 时后端设置 `Content-Disposition: attachment`，触发浏览器保存到磁盘（V1.6.0 新增） |

**V1.7.0 权限检查**：
- 匿名访客普通访问放行；`download=1` 需登录，返回 `401 { code: "AUTH_REQUIRED" }`
- 被封禁/禁用用户返回 `401 { code: "USER_BANNED" / "USER_DISABLED" }`
- 登录用户 `can_view=0` 普通访问返回 `403`；`can_download=0` 且 `download=1` 返回 `403`

**响应**: 二进制图片流（`Content-Type` 透传 OSS，如 `image/webp`/`image/jpeg`）。

**下载模式**（`download=1`）：
- 后端按 `photoId` 查询照片标题，设置 `Content-Disposition: attachment; filename="<id>.jpg"; filename*=UTF-8''<编码标题>.jpg`（RFC 5987 支持中文文件名）
- 浏览器原生流式下载到磁盘，无需前端 fetch blob 全量加载到内存，速度最快
- 未审核照片仅所有者（带 `Authorization` 头）可下载；已审核照片为公开资源，任何人可下载

### 获取预签名上传地址

**POST** `/api/photos/upload/presigned`

**需登录**（V1.5.0）：请求头必须包含 `Authorization: Bearer <token>`，未登录返回 `401 { code: "AUTH_REQUIRED" }`。杜绝匿名用户生成上传地址，与 V1.4.0 点赞强制登录策略一致。

**V1.7.0 权限检查**：被封禁/禁用用户返回 `401 { code: "USER_BANNED" / "USER_DISABLED" }`；`can_upload=0` 返回 `403 { code: "PERMISSION_DENIED", message: "您已被禁止上传图片" }`。

**请求体**:
```json
{
  "fileName": "photo.jpg"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://bucket.oss-cn-hangzhou.aliyuncs.com/photos/1234567890_abc123.jpg?X-Amz-Signature=...",
    "key": "photos/1234567890_abc123.jpg"
  }
}
```

### 完成上传并保存照片

**POST** `/api/photos/upload/complete`

**需登录**（V1.5.0）：请求头必须包含 `Authorization: Bearer <token>`。从 JWT 解析 userId 写入 `photos.user_id`，防止落库为 NULL（历史曾因此导致 50 张匿名照片污染统计）。

**V1.7.0 权限检查**：被封禁/禁用用户返回 `401 { code: "USER_BANNED" / "USER_DISABLED" }`；`can_upload=0` 返回 `403 { code: "PERMISSION_DENIED" }`。

**请求体**:
```json
{
  "key": "photos/1234567890_abc123.jpg",
  "title": "城市天际线",
  "tags": ["城市", "航拍"],
  "description": "傍晚时分的城市天际线",
  "camera_model": "Sony A7R IV",
  "vehicle": "DJI Mavic 3 Pro",
  "location": "上海市浦东新区",
  "focal_length": "24mm",
  "iso": 100,
  "shutter_speed": "1/500s",
  "aperture": "f/8",
  "width": 1200,
  "height": 800
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "photoId": "000013",
    "key": "photos/1234567890_abc123.jpg",
    "url": "https://bucket.oss-cn-hangzhou.aliyuncs.com/photos/1234567890_abc123.jpg",
    "thumbnailUrl": "https://bucket.oss-cn-hangzhou.aliyuncs.com/photos/thumbnails/1234567890_abc123_thumb.webp"
  }
}
```

### 直接上传图片

**POST** `/api/photos/upload`

**请求头**:
```
Authorization: Bearer <token>（V1.5.0 起强制登录，未登录返回 401）
Content-Type: multipart/form-data
```

**V1.7.0 权限检查**：被封禁/禁用用户返回 `401 { code: "USER_BANNED" / "USER_DISABLED" }`；`can_upload=0` 返回 `403 { code: "PERMISSION_DENIED" }`。

**请求体**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| image | file | 是 | 图片文件（JPG/PNG/WebP/HEIC，最大50MB） |
| category | string | 是 | 照片分区，未提供时返回 400 `请选择照片分区` |
| title | string | 否 | 照片标题，默认"未命名照片" |
| tags | string/array | 否 | 标签，支持数组或中英文逗号分隔字符串 |
| description | string | 否 | 照片描述 |
| camera_model | string | 否 | 相机型号 |
| vehicle | string | 否 | 拍摄设备 |
| location | string | 否 | 拍摄地点 |
| focal_length | string | 否 | 焦距 |
| iso | number | 否 | ISO |
| shutter_speed | string | 否 | 快门速度 |
| aperture | string | 否 | 光圈 |
| width | number | 否 | 图片宽度 |
| height | number | 否 | 图片高度 |
| watermarkText | string | 否 | 水印文本（未提供或空字符串则跳过水印合成） |
| watermarkX | number | 否 | 水印锚点（文本中心）X 坐标，**单位：最终预览图宽度的百分比 0-100**；0=左边缘、50=水平居中、100=右边缘 |
| watermarkY | number | 否 | 水印锚点（文本中心）Y 坐标，**单位：最终预览图高度的百分比 0-100**；0=上边缘、50=垂直居中、100=下边缘 |
| watermarkOpacity | number | 否 | 水印不透明度，**单位：0-1 浮点数**（例如 0.6 = 60% 不透明）；后端兜底默认 0.6 |
| watermarkSize | number | 否 | 水印字号，**语义：长边 1200px 的预览图上的字号（CSS px）**；后端按最终预览图长边/1200 线性缩放，保证不同分辨率下水印视觉比例一致。默认 32 |
| structured_tags | string | 否 | 结构化标签 JSON |

**响应**:
```json
{
  "success": true,
  "data": {
    "photoId": "000014",
    "thumbnailUrl": "/api/photos/image/photos%2Fthumbnails%2F000014_thumb.webp",
    "previewUrl": "/api/photos/image/photos%2Fpreview%2F000014_preview.webp",
    "watermarkedUrl": "/api/photos/image/photos%2Fwatermarked%2F000014_watermarked.webp"
  }
}
```

**说明**:
- 新照片状态固定为 `pending`，需管理员审核后才会在前台展示
- 标题、描述、标签、结构化标签会进行敏感词校验，包含敏感词时返回 400
- 缺少 `category` 字段时返回 400 `{ success: false, message: "请选择照片分区" }`

---

## 文章接口 (Articles)

### 获取文章列表

**GET** `/api/articles`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "article_001",
      "title": "Markdown 和 LaTeX 测试文章",
      "excerpt": "本文包含了 Markdown 的所有主要语法...",
      "cover_image": "https://picsum.photos/seed/article1/400/300",
      "author": "TLR工作室",
      "published_at": "2024-07-01T10:00:00Z",
      "read_count": 1234,
      "like_count": 89,
      "comment_count": 23,
      "tags": ["技术", "Markdown", "LaTeX"]
    }
  ]
}
```

### 获取文章详情

**GET** `/api/articles/:id`

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "article_001",
    "title": "Markdown 和 LaTeX 测试文章",
    "excerpt": "本文包含了 Markdown 的所有主要语法...",
    "content_path": "/articles/test-markdown-latex.md",
    "cover_image": "https://picsum.photos/seed/article1/400/300",
    "author": "TLR工作室",
    "published_at": "2024-07-01T10:00:00Z",
    "read_count": 1234,
    "like_count": 89,
    "comment_count": 23,
    "tags": ["技术", "Markdown", "LaTeX"]
  }
}
```

### 获取文章内容

**GET** `/api/articles/:id/content`

**响应**:
```json
{
  "success": true,
  "data": "# Markdown 标题\n\n正文内容..."
}
```

### 点赞文章

**POST** `/api/articles/:id/like`

**请求体**:
```json
{
  "userId": "anonymous"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "like_count": 90
  }
}
```

### 取消点赞文章

**DELETE** `/api/articles/:id/like`

**请求体**:
```json
{
  "userId": "anonymous"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "like_count": 89
  }
}
```

### 增加阅读量

**POST** `/api/articles/:id/view`

**响应**:
```json
{
  "success": true,
  "data": {
    "read_count": 1235
  }
}
```

---

## 评论接口 (Comments)

### 获取文章评论

**GET** `/api/articles/:id/comments`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "comment_001",
      "author": "摄影爱好者",
      "content": "这篇文章太棒了！",
      "created_at": "2024-07-01T09:00:00Z"
    }
  ]
}
```

### 发表评论

**POST** `/api/articles/:id/comments`

**请求体**:
```json
{
  "author": "访客",
  "content": "评论内容"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "comment_1234567890",
    "article_id": "article_001",
    "author": "访客",
    "content": "评论内容",
    "created_at": "2024-07-01T10:00:00Z"
  }
}
```

---

## 认证接口 (Auth)

### 用户注册

**POST** `/api/auth/register`

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "username": "用户名"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "user_1234567890123",
    "email": "user@example.com",
    "username": "用户名"
  }
}
```

### 用户登录

**POST** `/api/auth/login`

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "remember": false
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| email | string | 是 | - | 邮箱地址 |
| password | string | 是 | - | 密码 |
| remember | boolean | 否 | false | 是否保存登录状态（30天有效） |

**响应**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_1234567890123",
      "email": "user@example.com",
      "username": "用户名",
      "avatar_url": null
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "session_token": "abc123def456..."
  }
}
```

**说明**: 
- 当 `remember` 为 `true` 时，返回 `session_token`，用于自动登录
- `session_token` 有效期为 30 天，或连续 7 天无活动自动过期
- **V1.7.0 封禁检查**：被封禁用户（`banned_at` 非空）尝试登录时返回 `400 { success: false, message: "该账号已被封禁" }`，无法成功登录；被封禁用户的现有 JWT 也会在所有需鉴权接口（上传/点赞/查看/下载）被 `loadAuthUser` 拦截，返回 `401 { code: "USER_BANNED" }`

### 自动登录（刷新令牌）

**POST** `/api/auth/refresh`

**请求体**:
```json
{
  "session_token": "abc123def456..."
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| session_token | string | 是 | 登录时获取的会话令牌 |

**响应**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_1234567890123",
      "email": "user@example.com",
      "username": "用户名",
      "avatar_url": null
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**说明**:
- 使用 `session_token` 换取新的 JWT token
- 自动更新会话的最后活动时间
- 会话过期或无效时返回 401 错误

### 获取当前用户信息

**GET** `/api/auth/me`

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "user_1234567890123",
    "email": "user@example.com",
    "username": "用户名",
    "avatar_url": null,
    "bio": "个人简介",
    "phone": "13800138000",
    "website": "https://example.com",
    "location": "北京市",
    "custom_fields": {},
    "created_at": "2024-07-01T10:00:00Z"
  }
}
```

### 更新用户资料

**PUT** `/api/auth/me`

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "username": "新用户名",
  "bio": "个人简介",
  "phone": "13800138000",
  "website": "https://example.com",
  "location": "北京市",
  "custom_fields": {
    "字段名": {
      "value": "字段值",
      "isPrivate": false
    }
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "user_1234567890123",
    "email": "user@example.com",
    "username": "新用户名",
    "avatar_url": null,
    "bio": "个人简介",
    "phone": "13800138000",
    "website": "https://example.com",
    "location": "北京市",
    "custom_fields": {}
  }
}
```

### 修改密码

**PUT** `/api/auth/me/password`

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "oldPassword": "旧密码",
  "newPassword": "新密码"
}
```

**响应**:
```json
{
  "success": true,
  "message": "密码修改成功"
}
```

### 上传头像

**POST** `/api/auth/me/avatar`

**请求头**:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**请求体**:
```
avatar: <file> (JPG/PNG/WebP, 最大5MB)
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "user_1234567890123",
    "avatar_url": "/uploads/abc123def456.jpg"
  }
}
```

### 退出登录

**POST** `/api/auth/logout`

**响应**:
```json
{
  "success": true,
  "message": "退出成功"
}
```

---

## 专栏接口 (Column)

### 获取专栏信息

**GET** `/api/column`

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "column_001",
    "name": "航拍技术专栏",
    "description": "探索航拍世界，分享专业技巧，记录精彩瞬间",
    "cover_image": "https://picsum.photos/seed/column/600/400"
  }
}
```

---

## 管理后台接口 (Admin)

**统一请求头**: `Authorization: Bearer <admin_token>`（除登录接口外均需管理员鉴权）

### 获取分区列表

**GET** `/api/admin/zones`

**说明**: 返回全部分区（航空/铁路/汽车），用于管理后台下拉选择框（如创建账户、过滤照片时的分区选择）。

**请求头**:
```
Authorization: Bearer <admin_token>
```

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "aviation",
      "name": "航空",
      "name_en": "Aviation",
      "description": "民用航空相关影像，包括飞行器、机场、地勤等",
      "icon": "✈️"
    },
    {
      "id": "railway",
      "name": "铁路",
      "name_en": "Railway",
      "description": "铁路相关影像，包括列车、车站、线路设施等",
      "icon": "🚆"
    },
    {
      "id": "automobile",
      "name": "汽车",
      "name_en": "Automobile",
      "description": "汽车及其他地面交通相关影像",
      "icon": "🚗"
    }
  ]
}
```

---

## 管理后台用户管理（V1.7.0）

> 以下接口均需 `Authorization: Bearer <admin_token>`，仅 `super` 角色可调用。

### 获取站点用户列表

**GET** `/api/admin/users/list`

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 20 | 每页数量 |
| keyword | string | - | 按用户名或邮箱模糊搜索 |

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "user_123",
      "email": "user@example.com",
      "username": "用户名",
      "avatar_url": null,
      "is_active": 1,
      "banned_at": null,
      "can_upload": 1,
      "can_view": 1,
      "can_download": 1,
      "can_like": 1,
      "created_at": "2026-07-15T10:00:00Z",
      "updated_at": "2026-07-15T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 156 }
}
```

### 切换用户启用/禁用

**PUT** `/api/admin/users/:id/toggle`

**说明**：翻转 `is_active`（1→0 禁用，0→1 启用），不影响封禁状态。被封禁用户需先解封才能使用此接口。

**响应**:
```json
{ "success": true, "message": "用户已禁用", "data": { "is_active": 0 } }
```

### 封禁用户（V1.7.0 新增）

**POST** `/api/admin/users/:id/ban`

**说明**：设置 `is_active=0` + `banned_at=时间戳`，并删除所有"记住我"会话实现强制下线。被封禁用户：
- 重新登录时返回 `400 { message: "该账号已被封禁" }`
- 现有 JWT 在所有需鉴权接口被拦截，返回 `401 { code: "USER_BANNED" }`

**响应**:
```json
{ "success": true, "message": "用户已封禁" }
```

**审计日志**：`action=ban_user`，`details` 含 `{ username, email, banned_at }`，`ip` 记录操作来源。

### 解封用户（V1.7.0 新增）

**POST** `/api/admin/users/:id/unban`

**说明**：清除 `banned_at` 标记并恢复 `is_active=1`。解封后用户可重新登录。

**响应**:
```json
{ "success": true, "message": "用户已解封" }
```

**审计日志**：`action=unban_user`。

### 更新用户功能权限（V1.7.0 新增）

**PUT** `/api/admin/users/:id/permissions`

**说明**：精细化权限控制 — 单独禁用/启用上传、查看、下载、点赞。仅传需变更的字段（0 或 1），未传字段不变。

**请求体**（所有字段可选）:
```json
{
  "can_upload": 0,
  "can_view": 1,
  "can_download": 0,
  "can_like": 1
}
```

**权限字段说明**:
| 字段 | 禁止后效果 | 拦截接口 |
|------|-----------|---------|
| can_upload | 无法上传新照片 | POST /upload, /upload/presigned, /upload/complete → 403 |
| can_view | 登录态无法查看图片详情/代理图（匿名仍可公开浏览已审核照片） | GET /:id, GET /image/* → 403 |
| can_download | 无法下载图片（下载需登录） | GET /image/*?download=1 → 403 |
| can_like | 无法点赞或取消点赞 | POST/DELETE /:id/like → 403 |

**响应**:
```json
{
  "success": true,
  "message": "权限已更新",
  "data": { "can_upload": 0, "can_view": 1, "can_download": 0, "can_like": 1 }
}
```

**审计日志**：`action=update_permissions`，`details` 含 `changes` 对象记录每项 `from→to`。

---

## 管理后台统计与监控

### 获取仪表盘系统统计

**GET** `/api/admin/stats`

**需登录**：管理员 token。`zone_master`/`zone_auditor` 仅统计本分区照片，`super` 看全部分区。

**响应**（V1.5.0）:
```json
{
  "success": true,
  "data": {
    "userCount": 156,
    "photoCount": 89,
    "adminCount": 3,
    "todayUploads": 5,
    "pendingCount": 12,
    "zoneName": null
  }
}
```

**字段说明**：
- `zoneName`：当前管理员所属分区名（`zone_master`/`zone_auditor` 时返回，`super` 时为 `null`）；前端用于显示"当前分区：xxx"提示
- `partial_error`：可选，单个统计查询失败时返回错误明细（V1.5.0 改用 `Promise.allSettled` 隔离失败）

### 获取照片审核统计

**GET** `/api/admin/photos/stats`

**需登录**：管理员 token。`zone_master`/`zone_auditor` 仅统计本分区照片。

**响应**（V1.5.0 修复 total 运算符优先级 + 增加 zoneName）:
```json
{
  "success": true,
  "data": {
    "total": 89,
    "pending": 12,
    "approved": 67,
    "rejected": 10,
    "zoneName": "landscape"
  }
}
```

### 仪表盘健康检查（V1.5.0 新增）

**GET** `/api/admin/dashboard/health`

**需登录**：`super` 或 `zone_master` token。

**作用**：检查关键数据一致性，返回 `healthy` 状态与 `issues` 列表。前端 DashboardPage 每 30 秒轮询，异常时显示黄色告警条。后端另有 5 分钟定时任务（`setInterval`），异常时写入 `admin_logs`（action=`dashboard_alert`）。

**检查项**：
- `photos.user_id IS NULL` 数量（应为 0）
- `photo_likes.user_id='anonymous'` 残留（应为 0）
- `article_likes.user_id='anonymous'` 残留（应为 0）
- `photos.status` 非 approved/pending/rejected 的异常状态数（应为 0）
- 近 1 小时 `admin_logs` 中 `dashboard_alert` 数量

**响应**:
```json
{
  "success": true,
  "data": {
    "healthy": true,
    "issues": [],
    "checked_at": "2026-08-25T09:30:00.000Z"
  }
}
```

异常时：
```json
{
  "success": true,
  "data": {
    "healthy": false,
    "issues": ["匿名照片: 5", "anonymous 点赞: 3"],
    "checked_at": "2026-08-25T09:30:00.000Z"
  }
}
```

---

## 健康检查

**GET** `/api/health`

**响应**:
```json
{
  "success": true,
  "message": "TLRphotos API is running",
  "timestamp": "2024-07-01T10:00:00Z"
}
```
