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
| watermarkText | string | 否 | 水印文本 |
| watermarkX | number | 否 | 水印 X 坐标 |
| watermarkY | number | 否 | 水印 Y 坐标 |
| watermarkOpacity | number | 否 | 水印不透明度 |
| watermarkSize | number | 否 | 水印字号 |
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
