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

## 安全约束 (V1.10.1)

- **CORS 白名单**：仅允许本站来源（默认 `https://tlrphotos.com` / `www.tlrphotos.com` / `admin.tlrphotos.com`，经环境变量 `CORS_ALLOWED_ORIGINS` 逗号分隔配置）；非白名单来源返回 403 `CORS_BLOCKED`；允许方法仅 `GET/POST/PUT/DELETE`，不携带凭证。同源前端与无 Origin 的服务端请求不受影响。
- **对象级访问控制**：照片列表/搜索/详情对匿名访客仅返回 `approved` 照片；未审核（pending/rejected）照片仅属主与管理员可访问，匿名直取返回 404。
- **上传认证顺序**：`POST /api/photos/upload` 先 JWT 认证 + `can_upload` 权限校验，通过后才进入 multipart 解析；未认证返回 401 `AUTH_REQUIRED`。
- **入口类型校验**：认证接口的 email/password 必须为字符串（长度上限 email 254 / password 200），非法类型返回 400；数据库引擎与 ORM 错误细节不回显。
- **速率限制**：登录/注册 10 次/分、照片公开读取 120 次/分（按 IP），超限返回 429 `RATE_LIMITED` + `Retry-After`。
- **指纹隐藏**：不返回 `X-Powered-By`；边缘（nginx）拒绝重复/非标准 `Transfer-Encoding` 及 CL+TE 共存请求（HTTP 请求走私防护）。
- 完整修复说明见 [security-fix-2026-09-24.md](./security-fix-2026-09-24.md)。

---

## 安全约束 (V2.0.0)

> ⚠️ **V2.0.0 破坏性变更**：全面移除手机验证码/短信通道（Spug），email 成为唯一账号标识与验证码通道；数据库 `users`/`admin_users` 的 `phone`/`phone_verified` 列物理删除（表重建迁移），旧 JWT 在部署后一律失效需重新登录。

纯邮箱验证码体系（每次登录强制邮箱验证码；阿里云 DirectMail SMTP 为唯一发送通道）：

- **验证码规格**：6 位纯数字；有效期 10 分钟；同一验证码最多 5 次错误尝试，超限锁定需重新获取
- **存储安全**：入库仅存 HMAC-SHA256 哈希，明文码仅在内存中传递给 SMTP 发送通道，绝不落库、不落日志；发送失败时作废旧记录，避免残留死码
- **发送限速**（三层独立叠加，任一超限返回 `429 RATE_LIMITED` + `Retry-After`）：
  - 同一邮箱 60 秒冷却（提示"发送过于频繁，请 60 秒后再试"）
  - 同一邮箱每小时最多 5 次
  - 同一 IP 每小时最多 20 次
- **隐私脱敏**：接口响应与日志中的邮箱脱敏返回（如 `a***@example.com`）
- **login_ticket**：两步登录中间票据，HMAC-SHA256 签名（恒时比较），绑定 userId + 客户端 IP（XFF 首段），10 分钟有效，IP 变更立即失效
- **bind_ticket**：无邮箱老用户在 `/login` 密码校验通过后获得的绑定票据，HMAC 签名 + IP 绑定，10 分钟有效；仅可用于 `/email/code/send`（bind_email）与 `/email/bind`
- **校验目标防伪造**：`/login/verify` 的验证目标由服务端从用户记录取 `user.email`，客户端不可传入 target
- **邮箱确权门**：上传/点赞/评论/资料修改等账户类操作要求 `email_verified=1`，否则返回 403 `EMAIL_VERIFICATION_REQUIRED`；新注册用户验码通过即确权，老用户首次登录验码后自动确权
- **配置依赖**：验证码邮件统一走阿里云 DirectMail SMTP（`ALIYUN_SMTP_HOST/PORT/USER/PASSWORD/FROM_NAME`）；未配置时发送返回 503（fail-closed）。已删除配置：`SPUG_SMS_TEMPLATE`、`SUPER_ADMIN_PHONES`、`ADMIN_SMS_REQUIRED`。V3.2.0 新增 `EMAIL_VERIFY_INTERVAL_DAYS`（登录邮箱验码周期天数，默认 30；0/负数恢复每次登录均验码）。

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
| keyword | string | 关键词（匹配标题、描述、**飞机注册号（V3.2.0，归一化大写模糊匹配）**） |
| tag | string | 标签筛选 |
| registration | string | 飞机注册号检索（V3.2.0）：大小写不敏感，按归一化大写值 LIKE 模糊匹配（如 `b-1234` 命中 `B-1234`） |
| is_hot | string | 热门意愿过滤（V3.2.0）：传 `1`/`true` 时仅返回上传者勾选「愿意推荐为热门」的照片 |
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
      "registration_number": "B-1234",
      "is_hot": 0,
      "created_at": "2024-05-15T18:30:00Z"
    }
  ]
}
```

> V3.2.0 起列表项新增 `registration_number`（飞机注册号，存量数据可能为 `null`）与 `is_hot`（0/1）字段。

### 获取所有标签

**GET** `/api/photos/tags`

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| with_counts | string | 传 `1`/`true` 时返回带计数的大标签聚合（V3.2.0），按计数降序；缺省保持向后兼容返回字符串数组 |

**响应**（缺省，向后兼容）:
```json
{
  "success": true,
  "data": ["城市", "航拍", "日落", "自然", "全景"]
}
```

**响应**（`?with_counts=1`，仅统计已审核照片）:
```json
{
  "success": true,
  "data": [
    { "name": "航拍", "count": 42 },
    { "name": "城市", "count": 17 }
  ]
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
  "registration_number": "B-1234",
  "is_hot": 1,
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

> **V3.2.0 新增字段**：
> - `registration_number`（string，**必填**）：飞机注册号，2-20 位大写字母/数字/连字符且须以字母或数字开头（如 `B-1234`、`N123AB`）；服务端 trim + 转大写校验，缺失或非法返回 `400 { code: "REGISTRATION_REQUIRED" }`，校验先于 OSS 完成调用。
> - `is_hot`（number/boolean/string，可选）：上传者「愿意推荐为热门图片」意愿标记，接受 `true`/`"true"`/`"1"`/`1`，其余视为未勾选（0）。仅作审核参考，不公开展示。

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
| registration_number | string | 是 | 飞机注册号（V3.2.0）：2-20 位大写字母/数字/连字符且须以字母或数字开头（如 `B-1234`）；服务端 trim + 转大写校验，缺失或非法返回 400 `{ code: "REGISTRATION_REQUIRED" }` |
| is_hot | string | 否 | 「愿意推荐为热门图片」意愿标记（V3.2.0）：`true`/`1` 视为勾选，其余为未勾选（0）；仅作审核参考，不公开展示 |
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

## 评论接口 (Comments, V3.0.0)

> ⚠️ V3.0.0 破坏性变更：旧端点 `GET/POST /api/articles/:id/comments` 已移除（调用返回 404）；评论表重建为通用主题模型。旧单层评论已迁移为 `subject_type=article` 的 L1 主评论（作者/内容/时间戳不变，`user_id` 为空，仅管理员可删）。

### 层级模型（严格三级）

评论以通用主题 `(subject_type, subject_id)` 挂载，一期 `subject_type ∈ {photo, article}`：

| 层级 | 含义 | parent_id 指向 | depth |
|------|------|----------------|-------|
| L1 | 针对照片/文章的主评论 | null | 1 |
| L2 | 主评论下的直接回复 | L1 id | 2 |
| L3 | 回复之间的互相引用回复 | 被回复的 L2/L3 id | 3 |

- 对 L3 再回复时，新节点 `depth` 仍为 **3**，`parent_id` 指向被回复节点，正文以"回复 @用户"前缀**平铺**展示；系统永不产生 depth=4。
- 线程内每条评论都冗余 `root_id`（L1 id）。

**评论行字段**：`id, subject_type, subject_id, root_id, parent_id, depth, user_id, author, reply_to_user_id, reply_to_user_name, content, like_count, created_at`；登录态读取时附加 `is_liked`。

### 生命周期（归档 / 回迁）

- **基础留存**：L1 发布后本地保留 `COMMENT_RETAIN_DAYS`（默认 10）天。
- **每日归档作业**：服务启动 30s 后执行一次，此后每 24h 一次（进程内加锁，单实例执行）。对超期且非 pinned 的线程：将整楼序列化为 JSON 上传 OSS（`comments-archive/{rootId}.json`）→ 校验对象存在与大小 → 写归档索引 → 删除本地 comments/likes/heat 行并扣减主题 `comment_count`。
- **热度续期**（启发式算法，非 ML）：依据回复数、全楼点赞数、时间衰减计算热度分，并以近 `COMMENT_VELOCITY_WINDOW_DAYS`（默认 2）天增量计算增速、线性外推 `COMMENT_PREDICTION_DAYS`（默认 7）天：
  - `hot`：`retain_until` 滚动续期为 `now + COMMENT_HOT_EXTRA_DAYS`（默认 7）天；
  - `viral`：长期本地留存至 `root_created_at + COMMENT_VIRAL_DAYS`（默认 365）天；
  - pinned（管理员置顶）线程永不归档。
- **回迁语义**：回复已归档线程时，后端先从 OSS 拉取 JSON，经版本/主题/层级校验后**原样写回**（保留 id 与全部时间戳），再写入新回复；归档索引保留并标记 `rehydrated_at`。
- **读取归档**：客户端先查 IndexedDB 缓存（TTL 7 天）；未命中则调用下方签名 URL 端点取得 24h 预签名 URL，直读 JSON 后回写缓存。签名失效（云端 403）时淘汰缓存并重取。

### 获取 L1 主评论列表

**GET** `/api/comments?subject_type=photo&subject_id=:id&page=1&page_size=20&sort=latest`

**查询参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| subject_type | 是 | `photo` / `article` |
| subject_id | 是 | 主题 id（≤128 字符） |
| page | 否 | 默认 1 |
| page_size | 否 | 默认 20，上限 50 |
| sort | 否 | `latest`（默认，按创建时间倒序）/ `hottest`（按热度分倒序） |

**响应**（公开读取；携带登录 token 时返回 `is_liked`）：
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "c1",
        "subject_type": "photo",
        "subject_id": "p1",
        "root_id": "c1",
        "parent_id": null,
        "depth": 1,
        "user_id": "u1",
        "author": "alice",
        "reply_to_user_id": null,
        "reply_to_user_name": null,
        "content": "拍得真好",
        "like_count": 5,
        "created_at": "2026-10-01T10:00:00Z",
        "is_liked": false,
        "replies": [
          {
            "id": "c2",
            "root_id": "c1",
            "parent_id": "c1",
            "depth": 2,
            "user_id": "u2",
            "author": "bob",
            "reply_to_user_id": null,
            "reply_to_user_name": null,
            "content": "同意",
            "like_count": 0,
            "created_at": "2026-10-02T10:00:00Z",
            "is_liked": false
          }
        ],
        "total_reply_count": 1,
        "has_more_replies": false
      }
    ],
    "archiveThreads": [
      {
        "root_id": "c9",
        "subject_type": "photo",
        "subject_id": "p1",
        "oss_key": "comments-archive/c9.json",
        "archived_at": "2026-10-09T03:00:00Z",
        "root_created_at": "2026-09-20T10:00:00Z",
        "reply_count": 3,
        "heat_tier": "normal",
        "last_reply_at": "2026-09-29T10:00:00Z",
        "rehydrated_at": null
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

说明：每个 L1 仅内联首批回复（按楼总回复数取至上限），超出时 `has_more_replies=true`，前端用单楼回复端点续载。已回迁（`rehydrated_at != null`）的索引对应线程已在 `items` 活跃列表，客户端不再展示归档提示。

### 发表主评论 / 回复

**POST** `/api/comments`（须登录且邮箱已确权）

**请求体**：
```json
{
  "subject_type": "photo",
  "subject_id": "p1",
  "parent_id": "c1",
  "root_id": "c1",
  "content": "回复内容，≤1000 字"
}
```

- 发表 L1：省略 `parent_id` / `root_id`。
- 回复活跃线程：提供 `parent_id`（`root_id` 可省略，服务端解析）。
- 回复归档线程：提供归档线程的 `parent_id` 与 `root_id`；若 parent 本地不存在，服务端自动回迁该线程后再写入。
- 不能跨主题回复（`PARENT_SUBJECT_MISMATCH` 400）。

**响应**：`201`，`data` 为新建评论行。

### 单楼回复二次加载

**GET** `/api/comments/:rootId/replies?limit=100&offset=2`

**响应**：
```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 3,
    "limit": 100,
    "offset": 2
  }
}
```

### 点赞 / 取消点赞（幂等）

**POST** `/api/comments/:id/like`（须登录 + 邮箱确权）
**DELETE** `/api/comments/:id/like`（同上）

**响应**：
```json
{
  "success": true,
  "data": { "like_count": 6, "is_liked": true }
}
```

重复点赞 / 未点赞时取消均幂等返回当前状态。

### 删除评论

**DELETE** `/api/comments/:id`（须登录 + 邮箱确权 + 168h 内人机验证状态）

- L1：整楼删除；若线程已归档，同时删除 OSS 对象与归档索引。
- L2/L3：仅删除单条（其下子评论保留，孤儿由前端树算法提升展示）。
- 仅本人可删；V3 迁移产生的历史评论（`user_id` 为空）只能由管理员删除。

**响应**：
```json
{
  "success": true,
  "data": { "deletedThread": true, "removedCount": 4 }
}
```

### 获取归档线程直读 URL

**GET** `/api/comments/archives/:rootId/url`

**响应**（索引存在 → 200）：
```json
{
  "success": true,
  "data": {
    "url": "https://tlr-main.oss-cn-hongkong.aliyuncs.com/comments-archive/c9.json?Expires=...&Signature=...",
    "archived_at": "2026-10-09T03:00:00Z",
    "root_created_at": "2026-09-20T10:00:00Z",
    "reply_count": 3
  }
}
```

索引不存在 → 404 `ARCHIVE_NOT_FOUND`。URL 有效期 24h。

### 评论错误码

| code | HTTP | 说明 |
|------|------|------|
| INVALID_PARAMS | 400 | subject_type / subject_id 等参数不合法 |
| COMMENT_CONTENT_EMPTY | 400 | 内容 trim 后为空 |
| COMMENT_CONTENT_TOO_LONG | 400 | 内容超过 1000 字 |
| PARENT_SUBJECT_MISMATCH | 400 | 不能跨主题回复 |
| AUTH_REQUIRED | 401 | 未登录 |
| EMAIL_VERIFICATION_REQUIRED | 403 | 邮箱未确权 |
| HUMAN_VERIFICATION_REQUIRED | 403 | 删除缺少人机验证状态 |
| COMMENT_DELETE_FORBIDDEN | 403 | 无权删除 |
| SUBJECT_NOT_FOUND | 404 | 评论主题不存在 |
| PARENT_NOT_FOUND | 404 | 被回复评论不存在 |
| COMMENT_NOT_FOUND | 404 | 评论不存在 |
| ARCHIVE_NOT_FOUND | 404 | 归档索引/云对象不存在 |
| ARCHIVE_JOB_LOCKED | 409 | 归档作业正在执行 |

### 管理端点（Admin）

均须管理员 JWT，操作写入 `admin_logs` 审计。

| 方法与路径 | 说明 |
|------------|------|
| `DELETE /api/admin/comments/:id` | 删除任意评论（L1 整楼含归档云对象）；审计动作 `comment_delete` |
| `PUT /api/admin/comments/:rootId/pin` | 置顶 / 取消置顶；请求体 `{ "pinned": true }`（缺省 true）；审计动作 `comment_pin` / `comment_unpin` |

---

## 认证接口 (Auth)

> **V2.0.0 账号体系**：**仅支持邮箱**注册与登录（手机/短信通道全面移除）；登录保持「密码校验 → 邮箱验证码确认」两段式；老用户首次登录验码通过即自动完成邮箱确权（`email_verified=1`）；账号无邮箱时进入强制邮箱绑定流程。
>
> **V3.2.0 邮件验证周期化**：邮箱验证码按周期触发，不再每次登录强制验码。用户最近确权时间锚点为 `users.last_email_verified_at`（注册/验码成功/换绑邮箱时刷新）。环境变量 `EMAIL_VERIFY_INTERVAL_DAYS`（逐请求读取，正整数天数）控制触发周期：上次确权距今未超过该周期时登录直接签发 JWT；超过周期或锚点为 NULL 时仍走两段式验码。默认 `30`（每月一次），设 `90` 为每三月一次，设 `0` 或负数恢复 V2.0.0「每次登录均须验码」旧行为。

### 发送邮箱验证码（V2.0.0）

**POST** `/api/auth/email/code/send`

向邮箱发送 6 位数字验证码，用于登录、注册、绑定/更换邮箱三个场景。

**限速**：三层叠加（同一邮箱 60s 冷却 / 同一邮箱 5 次每小时 / 同一 IP 20 次每小时），任一超限返回 `429 RATE_LIMITED` + `Retry-After`。

**请求体**:
```json
{
  "email": "user@example.com",
  "scene": "login",
  "turnstile_token": "0.zzAAA...",
  "bind_ticket": "可选：bind_email 场景的绑定票据"
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址（trim + 小写，≤254 字符），非法邮箱格式返回 400 |
| scene | string | 是 | 业务场景：`login` / `register` / `bind_email` |
| turnstile_token | string | 是 | Turnstile 挑战令牌（register 场景 action=register，其余 action=login） |
| bind_ticket | string | 否 | bind_email 场景：无邮箱老用户登录第一段获得的绑定票据（与 JWT 二选一） |

**场景规则**:
- `login`：邮箱必须已注册，否则 404 `EMAIL_NOT_REGISTERED`
- `register`：邮箱必须未注册，否则 409 `ALREADY_REGISTERED`
- `bind_email`：须持有效 bind_ticket（IP 绑定）或有效 JWT；邮箱被**其他账号**占用时 409 `ALREADY_REGISTERED`；两者均无返回 401 `UNAUTHORIZED`

**响应**:
```json
{
  "success": true,
  "data": {
    "channel": "mail",
    "cooldown": 60,
    "expires_minutes": 10,
    "target": "u***@example.com"
  }
}
```

**错误码**:
| HTTP | code | 说明 |
|------|------|------|
| 400 | INVALID_PARAMS | 参数格式错误 / 邮箱格式不正确 / 不支持的场景 |
| 401 | UNAUTHORIZED | bind_email 场景无有效绑定凭证 |
| 403/503 | HUMAN_VERIFICATION_REQUIRED | Turnstile 校验未通过或服务不可用（fail-closed） |
| 404 | EMAIL_NOT_REGISTERED | login 场景邮箱未注册 |
| 409 | ALREADY_REGISTERED | register 场景邮箱已注册 / bind_email 被他人绑定 |
| 429 | RATE_LIMITED | 触发三层限速之一 |
| 500 | OTP_SEND_FAILED | 验证码发送失败（通道侧错误） |
| 502/503 | 邮件通道透传码 | SMTP 发送失败（502）或邮件服务未配置（503） |

### 用户注册（V2.0.0：仅邮箱）

**POST** `/api/auth/register`

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "username": "用户名",
  "code": "123456",
  "turnstile_token": "0.zzAAA..."
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址（trim + 小写，≤254 字符）；传入手机号形态字符串返回 400 |
| password | string | 是 | 密码（≤200 字符） |
| username | string | 否 | 用户名（≤50 字符） |
| code | string | 是 | 6 位数字验证码（scene=register），须先调用 `/api/auth/email/code/send` 获取 |
| turnstile_token | string | 是 | Turnstile 挑战令牌（action=register），fail-closed |

**账号写入规则**：验码通过后建号，`email=邮箱`、`email_verified=1`（注册即确权）。

**响应**（201，注册成功视同完成登录，直接签发双令牌）:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_1234567890123",
      "email": "user@example.com",
      "username": "用户名",
      "avatar_url": null,
      "email_verified": 1
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "session_token": "abc123def456..."
  }
}
```

**错误码**:
| HTTP | code | 说明 |
|------|------|------|
| 400 | INVALID_PARAMS | 参数格式错误 / 邮箱格式不正确 |
| 400 | OTP_REQUIRED | 验证码缺失或非 6 位数字 |
| 400 | OTP_EXPIRED | 验证码不存在 / 已使用 / 已过期（提示重新获取） |
| 400 | OTP_MISMATCH | 验证码错误 |
| 400 | OTP_LOCKED | 错误次数超过 5 次被锁定，需重新获取 |
| 403/503 | HUMAN_VERIFICATION_REQUIRED | Turnstile 校验未通过或服务不可用 |
| 409 | ALREADY_REGISTERED | 邮箱已被注册 |
| 429 | RATE_LIMITED | 触发限速（10 次/分/IP） |
| 500 | REGISTER_FAILED | 注册失败 |

### 用户登录 · 第一步：密码校验（V2.0.0 两段式 / V3.2.0 周期化）

**POST** `/api/auth/login`

> 第一步仅校验密码。默认返回 `otp_required + login_ticket`（**不签发 JWT**），客户端须先调 [`POST /api/auth/email/code/send`](#发送邮箱验证码v200)（scene=login）再调 [`POST /api/auth/login/verify`](#用户登录--第二步邮箱验证码确认v200) 完成确认。
>
> **V3.2.0 周期跳过**：`EMAIL_VERIFY_INTERVAL_DAYS > 0` 且该用户 `last_email_verified_at` 距今未超期时，跳过验证码段，直接签发 JWT（响应结构与第二步成功一致，含 `user/token/session_token`，**不含** `otp_required` 字段）。客户端须同时兼容两种响应：检测到 `otp_required === true` 进入验码段，否则按已登录处理。

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "turnstile_token": "0.zzAAA..."
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址（trim + 小写，≤254 字符）；传入手机号形态字符串返回 400 |
| password | string | 是 | 密码（≤200 字符） |
| turnstile_token | string | 条件 | 人机验证令牌（action=login）：该用户 168h 内已有有效验证状态（同 IP）时可省略，否则必传 |

**响应**（密码校验通过，进入第二步）:
```json
{
  "success": true,
  "data": {
    "otp_required": true,
    "login_ticket": "eyJ1c2VySWQiOi...xxx.c2ln...",
    "expires_minutes": 10
  }
}
```

**响应**（V3.2.0 周期内跳过验码，直接签发）:
```json
{
  "success": true,
  "data": {
    "user": { "id": "u_001", "email": "user@example.com", "username": "飞友" },
    "token": "eyJhbGciOi...",
    "session_token": "sess_xxx"
  }
}
```

**账号无邮箱时的强制绑定响应**（过渡态兜底）`403`:
```json
{
  "success": false,
  "code": "EMAIL_BIND_REQUIRED",
  "message": "该账号尚未绑定邮箱，请先完成邮箱绑定",
  "data": { "bind_ticket": "eyJ1c2VySWQiOi...xxx.c2ln...", "expires_minutes": 10 }
}
```
客户端随后用 bind_ticket 调 `/email/code/send`（bind_email）与 `/email/bind` 完成绑定，绑定成功即完成登录签发。

**错误码**:
| HTTP | code | 说明 |
|------|------|------|
| 400 | INVALID_PARAMS | 参数格式错误 / 邮箱格式不正确 |
| 401 | AUTH_FAILED | 邮箱不存在或密码错误（不细分回显） |
| 401 | AUTH_REJECTED | 账号已被封禁 / 禁用 |
| 403/503 | HUMAN_VERIFICATION_REQUIRED | Turnstile 校验未通过或服务不可用 |
| 403 | EMAIL_BIND_REQUIRED | 账号无邮箱，须先绑定（data.bind_ticket） |
| 429 | RATE_LIMITED | 触发限速（10 次/分/IP） |

### 用户登录 · 第二步：邮箱验证码确认（V2.0.0）

**POST** `/api/auth/login/verify`

校验 `login_ticket`（签名 + 过期 + IP 匹配）后验证邮箱一次性验证码（**验证目标固定为服务端取出的该用户邮箱**，客户端不可传入）；通过后自动 `markEmailVerified` 完成确权（老用户首次登录即确权），再签发 JWT + 会话并建立 168h 人机验证状态。

**限速**：10 次/分/IP，抑制验证码爆破。

**请求体**:
```json
{
  "login_ticket": "eyJ1c2VySWQiOi...xxx.c2ln...",
  "code": "123456"
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| login_ticket | string | 是 | 第一步返回的登录票据（≤2048 字符） |
| code | string | 是 | 6 位数字验证码（scene=login） |

**响应**（与注册成功结构一致）:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_1234567890123",
      "email": "user@example.com",
      "username": "用户名",
      "avatar_url": null,
      "email_verified": 1
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "session_token": "abc123def456..."
  }
}
```

**错误码**:
| HTTP | code | 说明 |
|------|------|------|
| 400 | INVALID_TICKET | 票据格式非法 |
| 400 | OTP_REQUIRED | 验证码缺失或非 6 位数字 |
| 400 | OTP_EXPIRED / OTP_MISMATCH / OTP_LOCKED | 验证码过期 / 错误 / 锁定（语义同注册） |
| 401 | INVALID_TICKET | 票据签名无效 / 已过期 / IP 变更（需重新走第一步） |
| 401 | USER_BANNED / USER_DISABLED | 出票后账号被封禁 / 禁用（签发前复核） |
| 403 | EMAIL_BIND_REQUIRED | 该账号无邮箱（须先走绑定流程） |
| 404 | USER_NOT_FOUND | 用户不存在 |
| 429 | RATE_LIMITED | 触发限速（10 次/分/IP） |
| 500 | LOGIN_FAILED | 登录失败 |

**说明**:
- `session_token` 有效期为 30 天，或连续 7 天无活动自动过期
- **封禁检查**：被封禁用户的现有 JWT 在所有需鉴权接口被 `loadAuthUser` 拦截，返回 `401 { code: "USER_BANNED" }`
- **人机验证**：登录成功（第二步通过）即建立/刷新 168h 验证状态

### 绑定 / 更换邮箱（V2.0.0）

**POST** `/api/auth/email/bind`

支持两种身份凭证：
- **bind_ticket**（无邮箱老用户登录第一段签发）：绑定成功后直接完成登录，签发 JWT + 会话
- **JWT**（已登录用户更换邮箱）：绑定成功返回更新后的用户资料

**请求体**:
```json
{
  "email": "new@example.com",
  "code": "123456",
  "bind_ticket": "可选：绑定票据（与 Authorization 头二选一）",
  "turnstile_token": "0.zzAAA..."
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 新邮箱（trim + 小写，≤254 字符） |
| code | string | 是 | 6 位数字验证码（scene=bind_email，调 `/api/auth/email/code/send` 获取） |
| bind_ticket | string | 否 | 绑定票据；不传时必须携带 `Authorization: Bearer <token>` |
| turnstile_token | string | 是 | Turnstile 挑战令牌（action=login） |

**响应（bind_ticket 路径）**：结构同登录成功（user + token + session_token，`email_verified=1`）。

**响应（JWT 路径，更新后的用户资料）**:
```json
{
  "success": true,
  "data": {
    "id": "user_1234567890123",
    "email": "new@example.com",
    "username": "用户名",
    "avatar_url": null,
    "email_verified": 1
  }
}
```

**错误码**:
| HTTP | code | 说明 |
|------|------|------|
| 400 | INVALID_PARAMS | 邮箱格式不正确 / code 非 6 位数字 |
| 400 | OTP_REQUIRED / OTP_EXPIRED / OTP_MISMATCH / OTP_LOCKED | 验证码相关错误（语义同注册） |
| 401 | INVALID_TICKET | bind_ticket 签名无效 / 过期 / IP 变更 |
| 401 | UNAUTHORIZED | 既无有效票据也未登录 |
| 403/503 | HUMAN_VERIFICATION_REQUIRED | Turnstile 校验未通过或服务不可用 |
| 404 | USER_NOT_FOUND | 用户不存在 |
| 409 | ALREADY_REGISTERED | 邮箱已被其他账号绑定 |
| 500 | BIND_FAILED | 绑定失败 |

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
    "email_verified": 1,
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
    "email_verified": 1,
    "website": "https://example.com",
    "location": "北京市",
    "custom_fields": {}
  }
}
```

> 邮箱未确权（`email_verified≠1`）时返回 403 `EMAIL_VERIFICATION_REQUIRED`；本接口不接受邮箱/手机号字段，更换邮箱须走 [`POST /api/auth/email/bind`](#绑定--更换邮箱v200)。

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

## 人机验证 (Human Verification, V1.8.0)

基于 Cloudflare Turnstile 的人机认证机制，保护所有高危操作。

### 机制说明

- **验证门（fail-closed）**：下方清单中的高危端点在执行前强制校验人机验证状态；Turnstile 服务未配置或暂不可用时一律拒绝（503），不存在任何绕过通道
- **168 小时有效期**：通过一次验证后 168 小时（7 天）内免重复验证，超时自动过期（定时任务每日清理过期记录）
- **IP 绑定**：验证状态与客户端 IP（X-Forwarded-For 首段）绑定，IP 变更立即失效
- **登出失效**：`POST /api/auth/logout` 成功后立即清除该用户的验证状态
- **登录/注册内联验证**：登录与注册在请求体内直接携带 `turnstile_token`，服务端 canonical siteverify 校验（success === true + action 匹配 + hostname 白名单）通过后方可继续；登录成功即建立 168h 验证状态
- **其余高危操作**：请求被 403 拦截后，前端弹出 Turnstile 验证组件，完成挑战后调用 `POST /api/verification/verify`（管理端调 `/api/admin/verification/verify`）建立验证状态，再重试原操作
- **测试绕过**：仅 `NODE_ENV=test` 且请求携带与 `TEST_BYPASS_TOKEN` 完全匹配的 `tokens` 参数时放行；生产环境该通道物理关闭

### 高危端点清单

| 端点 | 方法 | action | 拦截方式 |
|------|------|--------|----------|
| /api/auth/register | POST | register | 请求体携带 turnstile_token |
| /api/auth/login | POST | login | 请求体携带 turnstile_token（已有有效验证状态时免） |
| /api/auth/me | PUT | update_profile | 403 验证门 |
| /api/auth/me/password | PUT | change_password | 403 验证门 |
| /api/auth/me/avatar | POST | avatar_upload | 403 验证门 |
| /api/photos/upload/presigned | POST | photo_upload | 403 验证门 |
| /api/photos/upload/complete | POST | photo_upload | 403 验证门 |
| /api/photos/upload | POST | photo_upload | 403 验证门 |
| /api/photos/:id | DELETE | photo_delete | 403 验证门 |
| /api/comments/:id | DELETE | photo_delete | 403 验证门（V3.0.0 新增；验证状态与 action 无关） |
| /api/admin/users/:id/ban | POST | admin_user_admin | 403 验证门 |
| /api/admin/users/:id/unban | POST | admin_user_admin | 403 验证门 |
| /api/admin/users/:id/permissions | PUT | admin_user_admin | 403 验证门 |
| /api/admin/users/:id/email | PUT | admin_user_admin | 403 验证门（V2.0.0 新增） |

### 验证门拦截响应（403）

```json
{
  "success": false,
  "code": "HUMAN_VERIFICATION_REQUIRED",
  "message": "该操作需先完成人机验证，请按页面提示完成验证后重试"
}
```

### 查询验证状态（用户端）

**GET** `/api/verification/status`

**鉴权**: Bearer Token（用户）

**响应**:
```json
{
  "success": true,
  "data": {
    "verified": true,
    "verified_at": "2026-09-05T12:00:00.000Z",
    "expires_at": "2026-09-12T12:00:00.000Z"
  }
}
```

### 提交人机验证（用户端）

**POST** `/api/verification/verify`

**鉴权**: Bearer Token（用户）

**请求体**:
```json
{
  "action": "photo_delete",
  "turnstile_token": "0.zzAAA..."
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | 高危操作类型，白名单：login / register / change_password / update_profile / avatar_upload / photo_upload / photo_delete / admin_user_admin |
| turnstile_token | string | 是 | Turnstile widget 返回的令牌（一次性，≤2048 字符） |
| tokens | string | 否 | 测试绕过参数，仅 NODE_ENV=test 且匹配 TEST_BYPASS_TOKEN 时生效 |

**响应**: 同"查询验证状态"

**错误**:
- `403 HUMAN_VERIFICATION_FAILED`：siteverify 校验未通过（token 无效 / action 不匹配 / hostname 不在 TURNSTILE_HOSTNAMES 白名单）
- `503`：Turnstile 服务未配置或暂不可用（fail-closed，一律拒绝）

### 提交人机验证（管理端）

**POST** `/api/admin/verification/verify`

**鉴权**: Bearer Token（管理员）

**请求体**:
```json
{
  "action": "admin_user_admin",
  "turnstile_token": "0.zzAAA..."
}
```

**说明**: `action` 固定为 `admin_user_admin`；校验通过后建立管理员 168h 验证状态（subject_type=admin），与用户态相互独立。

**响应**: 同"查询验证状态"

### 查询验证状态（管理端）

**GET** `/api/admin/verification/status`

**鉴权**: Bearer Token（管理员）

**响应**: 同"查询验证状态"（verified 为管理员当前验证状态）

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

### 管理员登录（V2.0.0：全角色单阶段）

**POST** `/api/admin/login`

**说明**: 登录入口全链路防护：IP 限速（10 次/分钟）→ 严格输入校验 → Turnstile 人机验证 → 失败锁定检查 → bcrypt 常量时间校验。失败提示统一为「用户名或密码错误」，不可枚举用户。**V2.0.0 起超管与审核员统一单阶段登录**：校验通过即直接签发 JWT，不再存在短信第二因素；`/login/sms/send`、`/login/sms/verify` 端点与 `ADMIN_SMS_REQUIRED`、`SUPER_ADMIN_PHONES` 配置均已删除。

**请求体**:
```json
{
  "username": "admin",
  "password": "明文密码",
  "turnstile_token": "Turnstile 令牌（action=admin_login）"
}
```

**参数约束**: `username` 为字符串、trim 后 1–64 字符；`password` 为字符串、1–128 字符；`turnstile_token` 必填（测试环境可用 `tokens=TEST_BYPASS_TOKEN` 绕过）。

**成功响应（全角色统一）** `200`:
```json
{
  "success": true,
  "token": "管理员 JWT（8h，含 iss/aud/tv 声明）",
  "admin": {
    "id": "admin-id",
    "username": "admin",
    "name": "系统管理员",
    "role": "super",
    "zone": null,
    "must_change_password": 0
  }
}
```

**失败响应**:

| 状态码 | code | 触发条件 |
|--------|------|----------|
| 400 | — | 缺失/类型错误/超长入参 |
| 429 | RATE_LIMITED | 同 IP 超过 10 次/分钟（含 Retry-After） |
| 403 | HUMAN_VERIFICATION_FAILED | Turnstile 缺失/无效/action 不符 |
| 403 | ADMIN_LOGIN_LOCKED | 同用户名+同 IP 连续 5 次失败，锁定 15 分钟（`data.retry_after_seconds`） |
| 401 | — | 用户名或密码错误 |


### 修改当前管理员密码

**POST** `/api/admin/me/password`

**鉴权**: Bearer Token（管理员）

**说明**: 凭当前密码与 Turnstile 设置新密码。成功后 `password_hash` 更新、`token_version+1`——**改密前所有已签发 JWT 立即失效**，响应携带新 JWT；同时 `must_change_password=0`，强制改密状态解除。

**请求体**:
```json
{
  "current_password": "当前密码",
  "new_password": "新密码",
  "confirm_password": "新密码确认",
  "turnstile_token": "Turnstile 令牌（action=admin_change_password）"
}
```

**新密码口径**: trim 后 12–128 位、不等于已公开默认密码、不与用户名相同；两次输入必须一致。

**成功响应** `200`:
```json
{
  "success": true,
  "message": "密码修改成功",
  "token": "携带新 tv 的 JWT",
  "admin": { "must_change_password": 0 }
}
```

**强制改密状态说明（PASSWORD_CHANGE_REQUIRED）**: `must_change_password=1` 的账号仅允许 `GET /api/admin/me` 与 `POST /api/admin/me/password`，访问其他任何接口返回 `403` 与 code `PASSWORD_CHANGE_REQUIRED`。超管引导、旧哈希替换、新建管理员均会初始置 1；超管暴露默认密码检测命中时（`ADMIN_FORCE_CHANGE_PASSWORD=on`）置 1。

---

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

### 超管代改用户邮箱（V2.0.0 新增）

**PUT** `/api/admin/users/:id/email`

**说明**：当用户无法自行收码换绑（如邮箱废弃）时，由超管代为指定新邮箱。更新后该用户 `email_verified=0`，下次登录必须完成邮箱验证码确认。

**权限**：管理员鉴权 + **仅 `role=super`**（其他角色 403）+ 高危操作人机验证（`ensureHumanVerified`，168h 状态内同 IP 免重复挑战）。

**请求体**:
```json
{
  "email": "new@example.com",
  "turnstile_token": "Turnstile 令牌（action=admin_login）"
}
```

**响应**:
```json
{
  "success": true,
  "message": "邮箱已更新，用户须在下次登录时完成邮箱验证",
  "data": { "email": "new@example.com", "email_verified": 0 }
}
```

**错误码**:
| 状态码 | code | 触发条件 |
|--------|------|----------|
| 400 | — | 邮箱格式不正确 |
| 403 | HUMAN_VERIFICATION_REQUIRED | 人机验证未通过 |
| 404 | — | 目标用户不存在 |
| 409 | ALREADY_REGISTERED | 邮箱已被其他账号绑定 |

**审计日志**：`action=update_user_email`，`target_id` 为用户 ID。

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

## EverOS 记忆层 (V1.9.0)

EverOS 是面向 AI Agent 的持久化结构化记忆层。会话消息写入后由云端**异步抽取**为
episode（情节记忆）与 atomic_facts（原子事实），自动去重与矛盾消解；生成回答前先检索召回相关上下文。

**配置**：`EVEROS_API_KEY`（必填，未配置时两个接口返回 503）、`EVEROS_PROJECT_ID`（默认 `tlrphotos`，记忆空间隔离，查询不跨空间）、`EVEROS_BASE_URL`（默认云端 `https://api.evermind.ai`，自托管可覆盖）。

**鉴权**：两个接口均需登录（`Authorization: Bearer <jwt>`），记忆按用户隔离——写入时用户轮次的 `sender_id` 为本人用户 ID，检索只能命中本人记忆。

**机制要点**：
- 写入云端默认异步：返回 `status: "queued"`，通常 5–15 秒后可被检索，无需轮询
- 时间戳由服务端按 unix 毫秒自动生成
- 助手轮次（`role: "assistant"`）使用固定 `sender_id=tlrphotos_assistant`

### POST /api/everos/memory — 写入记忆轮次

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | 是 | 消息文本，1–10000 字符 |
| `session_id` | string | 否 | 会话标识（≤128 字符），缺省按用户派生 `session_<userId>` |
| `role` | string | 否 | `user`（默认）/ `assistant` / `tool` |
| `async_mode` | boolean | 否 | 默认 `true`（云端异步抽取，202 queued） |

**请求示例**：
```json
{ "session_id": "chat_2026_09_18", "content": "我喜欢黑白摄影，不喜欢过度饱和", "role": "user" }
```

**成功响应**：
```json
{
  "success": true,
  "data": { "message_count": 1, "status": "queued" }
}
```

**错误**：未登录 401；未配置 503；参数错误 400；EverOS 侧错误透传其状态码（如 401/429/5xx）与消息。

### POST /api/everos/search — 检索记忆

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 检索文本 |
| `method` | string | 否 | `hybrid`（默认，关键词+向量 RRF 融合）/ `keyword` / `vector` / `agentic` |
| `top_k` | integer | 否 | 1–100，默认 5（聊天），研究场景建议 10 |
| `include_profile` | boolean | 否 | 是否同时返回用户画像条目，默认 false |

**成功响应**：
```json
{
  "success": true,
  "data": {
    "episodes": [
      {
        "id": "6aad26025a2e15798b4386f1",
        "session_id": "chat_2026_09_18",
        "summary": "~200 字摘要",
        "subject": "摄影偏好",
        "episode": "完整叙事文本，可直接拼入 LLM prompt",
        "atomic_facts": [{ "id": "...", "content": "用户偏好黑白摄影" }],
        "score": 0.87
      }
    ],
    "profiles": [],
    "unprocessed_messages": []
  }
}
```

`unprocessed_messages`：当前会话尚未完成异步抽取的最新原始消息（避免刚说完就检索出现空档）。

**典型用法**：Agent 在生成回复前先 `search`，把 `episodes[].episode` 与 `atomic_facts` 作为上下文拼入 prompt；对话轮次通过 `memory` 写入。

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
