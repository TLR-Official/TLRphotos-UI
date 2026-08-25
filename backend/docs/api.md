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

### 获取预签名上传地址

**POST** `/api/photos/upload/presigned`

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
Authorization: Bearer <token>（可选，未登录记为匿名上传）
Content-Type: multipart/form-data
```

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
