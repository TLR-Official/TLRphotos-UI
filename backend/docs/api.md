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
      "id": "photo_001",
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
    "id": "photo_001",
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
    "altitude": 120,
    "focal_length": "24mm",
    "iso": 100,
    "shutter_speed": "1/500s",
    "aperture": "f/8",
    "likes": 1256,
    "views": 8932,
    "created_at": "2024-05-15T18:30:00Z"
  }
}
```

### 点赞照片

**POST** `/api/photos/:id/like`

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
    "likes": 1257
  }
}
```

### 取消点赞照片

**DELETE** `/api/photos/:id/like`

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
    "likes": 1256
  }
}
```

### 增加浏览量

**POST** `/api/photos/:id/view`

**响应**:
```json
{
  "success": true,
  "data": {
    "views": 8933
  }
}
```

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
  "altitude": 120,
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
    "photoId": "photo_1234567890123",
    "key": "photos/1234567890_abc123.jpg",
    "url": "https://bucket.oss-cn-hangzhou.aliyuncs.com/photos/1234567890_abc123.jpg",
    "thumbnailUrl": "https://bucket.oss-cn-hangzhou.aliyuncs.com/photos/thumbnails/1234567890_abc123_thumb.webp"
  }
}
```

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
