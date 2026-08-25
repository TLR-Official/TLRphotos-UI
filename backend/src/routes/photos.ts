/**
 * @file photos.ts
 * @description 照片业务路由模块。
 *              提供照片上传（直传 + 预签名两种方式）、搜索、列表、详情、
 *              点赞、浏览量统计、OSS 图片代理、删除等接口。
 *              所有图片 URL 通过代理服务返回，避免暴露 OSS 直链。
 */
import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { generatePresignedUploadUrl, completeUpload, getFileUrl, deleteFromOSS } from '../services/ossService';
import { processImage, uploadProcessedImages, WatermarkConfig, disposeProcessedBuffers } from '../services/imageService';
import { getProxyUrl, escapeLikePattern } from '../utils/url';
import { verifyAdminToken } from '../services/adminService';
import { memoryManager } from '../services/memoryManager';

const router = express.Router();

// JWT 密钥：用于校验上传/删除接口的 Bearer Token
const JWT_SECRET = process.env.JWT_SECRET || '';

/**
 * 从请求头解析 JWT 获取当前用户 ID。
 * 未登录或令牌无效时返回 null。
 */
function getCurrentUserId(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

/**
 * 浏览去重窗口：24 小时（毫秒）。
 * 同一 viewerKey 在窗口内对同一照片的多次访问只计 1 次有效浏览。
 */
const VIEW_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 提取客户端真实 IP（项目部署在 Nginx 反代后）。
 * 优先取 X-Forwarded-For 首段（最接近客户端的代理 IP），避免反代后所有请求都显示为 127.0.0.1。
 */
function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded.length) return forwarded[0];
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * 浏览计数 + 24h 去重。
 * 计算 viewer_key（登录按 user_id，未登录按 IP），查询 photo_views：
 *  - 若窗口内已存在记录：跳过计数（返回 false）
 *  - 否则：UPDATE photos.views +1 并 INSERT OR REPLACE photo_views（返回 true）
 * 注：sqlite3 单连接默认串行化执行，SELECT→UPDATE→INSERT 序列调用之间不会被其他请求插入，等价于原子事务。
 * @param photoId 照片 ID
 * @param viewerKey 'user:<userId>' 或 'ip:<clientIp>'
 * @returns 是否计入了本次浏览（true=已计入，false=被去重）
 */
async function recordViewIfEligible(photoId: string, viewerKey: string): Promise<boolean> {
  const now = Date.now();
  const row = await db.get<{ last_viewed_at: number }>(
    'SELECT last_viewed_at FROM photo_views WHERE photo_id = ? AND viewer_key = ?',
    photoId,
    viewerKey
  );
  if (row && now - row.last_viewed_at < VIEW_DEDUP_WINDOW_MS) {
    return false; // 24h 内已浏览过，去重
  }
  await db.run('UPDATE photos SET views = views + 1 WHERE id = ?', photoId);
  await db.run(
    'INSERT OR REPLACE INTO photo_views (photo_id, viewer_key, last_viewed_at) VALUES (?, ?, ?)',
    photoId,
    viewerKey,
    now
  );
  return true;
}

/**
 * 判定请求是否来自已认证的管理员。
 * 通过 ADMIN_JWT_SECRET 校验 Bearer Token，有效则返回 true。
 * 用于图片代理路由放行管理员对未审核照片的访问。
 */
async function isAdminRequest(req: express.Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  const admin = await verifyAdminToken(token);
  return admin !== null;
}

/**
 * 根据 OSS Key 在数据库中查找对应照片。
 * 遍历所有 URL 字段使用 LIKE 子串匹配，兼容已存储为完整预签名 URL 的历史数据。
 */
async function findPhotoByOssKey(key: string): Promise<any | null> {
  if (!key) return null;
  const pattern = `%${key}%`;
  return db.get(
    `SELECT * FROM photos WHERE 
      thumbnail_path LIKE ? OR 
      original_url LIKE ? OR 
      preview_url LIKE ? OR 
      watermarked_url LIKE ? 
    LIMIT 1`,
    [pattern, pattern, pattern, pattern]
  );
}

// multer 配置：内存存储 + 50MB 大小限制 + 仅允许常见图片格式
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 JPG、PNG、WebP、HEIC 格式'));
    }
  },
});

/**
 * multer 上传错误处理中间件。
 * 统一将 MulterError 与文件类型错误转换为 400 JSON 响应。
 */
const handleUploadError = (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, message: '文件大小超过限制（最大50MB）' });
    } else {
      res.status(400).json({ success: false, message: '上传错误: ' + err.message });
    }
  } else if (err instanceof Error) {
    res.status(400).json({ success: false, message: err.message });
  } else {
    next(err);
  }
};

/**
 * 搜索已审核通过的照片。
 * 支持按关键词（标题/描述模糊匹配）和标签过滤，并提供安全排序字段。
 * @query keyword 标题或描述关键词
 * @query tag 标签名（JSON 子串匹配）
 * @query sortBy 排序字段（白名单校验，防 SQL 注入）
 * @query sortOrder 排序方向 asc/desc
 */
router.get('/search', async (req, res) => {
  try {
    const { keyword, tag, category, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    let query = 'SELECT id, title, thumbnail_path, tags, width, height, likes, views, created_at FROM photos WHERE status = "approved"';
    const params: any[] = [];
    const conditions: string[] = [];

    // 关键词匹配：转义 LIKE 特殊字符防止用户输入干扰 SQL 通配符
    if (keyword) {
      const escapedKeyword = escapeLikePattern(String(keyword));
      conditions.push('(title LIKE ? OR description LIKE ?)');
      params.push(`%${escapedKeyword}%`, `%${escapedKeyword}%`);
    }

    // 标签匹配：tags 字段以 JSON 数组字符串存储，使用子串匹配
    if (tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${tag}"%`);
    }

    // 分区过滤：转义后精确匹配 category 字段，支持画廊按分区浏览
    if (category) {
      const escapedCategory = escapeLikePattern(String(category));
      conditions.push('category = ?');
      params.push(escapedCategory);
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    // 排序字段白名单校验：避免用户传入非法字段名导致 SQL 注入
    const validSortBy = ['created_at', 'likes', 'views', 'title'];
    const validSortOrder = ['asc', 'desc'];
    const safeSortBy = validSortBy.includes(String(sortBy)) ? sortBy : 'created_at';
    const safeSortOrder = validSortOrder.includes(String(sortOrder)) ? sortOrder : 'desc';

    query += ` ORDER BY ${safeSortBy} ${safeSortOrder}`;

    const photos = await db.all(query, params);

    // 解析 tags JSON 字符串为数组，并将缩略图地址转换为代理 URL
    const result = photos.map((photo: any) => {
      let tags: string[] = [];
      if (photo.tags) {
        try {
          tags = JSON.parse(photo.tags);
        } catch {
          // 旧数据兼容：tags 可能是空格分隔字符串
          tags = photo.tags.split(' ').filter(Boolean);
        }
      }
      const thumbnailUrl = getProxyUrl(photo.thumbnail_path, photo.id);
      return { ...photo, tags, thumbnail_path: thumbnailUrl };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error searching photos:', error);
    res.status(500).json({ success: false, message: '搜索照片失败' });
  }
});

/**
 * 聚合查询所有已审核照片的标签集合。
 * 返回去重并按字典序排序的标签数组，供前端标签云展示。
 */
router.get('/tags', async (req, res) => {
  try {
    const photos = await db.all('SELECT tags FROM photos WHERE status = "approved"');
    const tagSet = new Set<string>();

    photos.forEach((photo: any) => {
      if (photo.tags) {
        try {
          const tags = JSON.parse(photo.tags);
          if (Array.isArray(tags)) {
            tags.forEach((tag: string) => tagSet.add(tag));
          }
        } catch {
          // 旧数据兼容：空格分隔字符串
          const tags = photo.tags.split(' ').filter(Boolean);
          tags.forEach((tag: string) => tagSet.add(tag));
        }
      }
    });

    const tags = Array.from(tagSet).sort();
    res.json({ success: true, data: tags });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ success: false, message: '获取标签列表失败' });
  }
});

/**
 * 获取已审核通过的照片列表（按创建时间倒序）。
 * 支持分页参数 page（页码，从 1 开始）和 limit（每页条数，默认 50）。
 * 仅返回列表展示所需的最小字段集，并转换代理 URL。
 */
router.get('/', async (req, res) => {
  try {
    // 解析分页参数：page 从 1 开始，limit 默认 50，上限 100 防止滥用
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 50));
    const offset = (page - 1) * limit;

    // 解析分区过滤参数：存在时使用参数化查询精确匹配，避免 SQL 注入
    const { category } = req.query;
    const params: any[] = [];
    let baseQuery = 'SELECT id, title, thumbnail_path, tags, width, height, created_at FROM photos WHERE status = "approved"';
    if (category) {
      baseQuery += ' AND category = ?';
      params.push(String(category));
    }
    baseQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const photos = await db.all(baseQuery, params);

    const result = photos.map((photo: any) => {
      let tags: string[] = [];
      if (photo.tags) {
        try {
          tags = JSON.parse(photo.tags);
        } catch {
          tags = photo.tags.split(' ').filter(Boolean);
        }
      }
      const thumbnailUrl = getProxyUrl(photo.thumbnail_path, photo.id);
      return { ...photo, tags, thumbnail_path: thumbnailUrl };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ success: false, message: '获取照片列表失败' });
  }
});

/**
 * 获取照片详情。
 * 若携带有效 JWT，则可同时查看本人上传的未审核照片；
 * 否则仅返回已审核照片。访问后自动累加浏览量并附带上传者信息。
 * @param id 照片 ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 可选鉴权：携带 Bearer Token 时解析当前用户 ID，用于放行本人未审核照片
    let currentUserId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        currentUserId = decoded.userId;
      } catch {}
    }

    // 已登录用户：可查看已审核或本人上传的照片；未登录：仅查看已审核照片
    let photo;
    if (currentUserId) {
      photo = await db.get('SELECT * FROM photos WHERE id = ? AND (status = "approved" OR user_id = ?)', id, currentUserId);
    } else {
      photo = await db.get('SELECT * FROM photos WHERE id = ? AND status = "approved"', id);
    }

    if (!photo) {
      return res.status(404).json({ success: false, message: '照片不存在' });
    }

    // 浏览计数：登录按 user_id 去重，未登录按 client IP 去重，24h 窗口内只计 1 次
    const viewerKey = currentUserId ? `user:${currentUserId}` : `ip:${getClientIp(req)}`;
    await recordViewIfEligible(id, viewerKey);

    // 查询上传者公开信息（仅返回 id、用户名、头像）
    let uploader = null;
    if (photo.user_id) {
      const user = await db.get('SELECT id, username, avatar_url FROM users WHERE id = ?', photo.user_id);
      if (user) {
        uploader = {
          id: user.id,
          username: user.username || '用户',
          avatar_url: user.avatar_url,
        };
      }
    }

    // 当前登录用户是否已点赞（未登录时为 false）
    let is_liked = false;
    if (currentUserId) {
      const likeRow = await db.get('SELECT 1 FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, currentUserId);
      is_liked = !!likeRow;
    }

    // 重新查询最新浏览数（去重逻辑可能未自增）
    const freshPhoto = await db.get<{ views: number; likes: number }>(
      'SELECT views, likes FROM photos WHERE id = ?',
      id
    );

    delete photo.altitude;
    res.json({
      success: true,
      data: {
        ...photo,
        // 用最新统计数覆盖 photo 对象上的旧值（去重逻辑可能未更新 views）
        views: freshPhoto?.views ?? photo.views,
        likes: freshPhoto?.likes ?? photo.likes,
        is_liked,
        // 所有图片地址统一转换为代理 URL，避免暴露 OSS 直链
        // 附带 photoId 参数以支持代理路由的快速鉴权
        original_url: getProxyUrl(photo.original_url, photo.id),
        thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
        preview_url: photo.preview_url ? getProxyUrl(photo.preview_url, photo.id) : '',
        watermarked_url: photo.watermarked_url ? getProxyUrl(photo.watermarked_url, photo.id) : '',
        tags: photo.tags ? JSON.parse(photo.tags) : [],
        uploader,
        // 审核驳回理由，仅在 rejected 状态下非空
        rejection_reason: photo.rejection_reason || null,
      },
    });
  } catch (error) {
    console.error('Error fetching photo:', error);
    res.status(500).json({ success: false, message: '获取照片详情失败' });
  }
});

/**
 * 点赞照片（需登录）。
 * 强制从 JWT 解析 user_id（不再从 body 取，杜绝 anonymous 共用导致一个匿名点赞后所有人无法再赞）。
 * 重复点赞幂等返回当前计数。响应附带 is_liked 字段供前端切换 UI 状态。
 * @param id 照片 ID
 * @returns 最新点赞数 + is_liked 状态
 */
router.post('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;

    // 强制登录：未登录或令牌无效返回 401
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: '请先登录后点赞',
        code: 'AUTH_REQUIRED',
      });
    }

    // 已点赞：幂等返回当前点赞数 + is_liked=true
    const existingLike = await db.get('SELECT 1 FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, currentUserId);
    if (existingLike) {
      const currentPhoto = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', id);
      return res.json({
        success: true,
        data: { likes: currentPhoto?.likes || 0, is_liked: true },
      });
    }

    // 未点赞：写入点赞记录并累加照片 likes 字段
    // 注：sqlite3 单连接默认串行化执行，INSERT + UPDATE 之间不会被其他请求插入
    await db.run('INSERT INTO photo_likes (photo_id, user_id) VALUES (?, ?)', id, currentUserId);
    await db.run('UPDATE photos SET likes = likes + 1 WHERE id = ?', id);
    const updatedPhoto = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', id);

    res.json({
      success: true,
      data: { likes: updatedPhoto?.likes || 0, is_liked: true },
    });
  } catch (error) {
    console.error('Error liking photo:', error);
    res.status(500).json({ success: false, message: '点赞失败' });
  }
});

/**
 * 取消点赞照片（需登录）。
 * 与点赞接口对称：未点赞时幂等返回当前值；已点赞则删除记录并扣减计数（MAX(0, ...) 防负数）。
 */
router.delete('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;

    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: '请先登录',
        code: 'AUTH_REQUIRED',
      });
    }

    const existingLike = await db.get('SELECT 1 FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, currentUserId);
    if (!existingLike) {
      const currentPhoto = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', id);
      return res.json({
        success: true,
        data: { likes: currentPhoto?.likes || 0, is_liked: false },
      });
    }

    await db.run('DELETE FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, currentUserId);
    // MAX(0, likes - 1) 防止并发或异常情况下计数变为负数
    await db.run('UPDATE photos SET likes = MAX(0, likes - 1) WHERE id = ?', id);
    const updatedPhoto = await db.get<{ likes: number }>('SELECT likes FROM photos WHERE id = ?', id);

    res.json({
      success: true,
      data: { likes: updatedPhoto?.likes || 0, is_liked: false },
    });
  } catch (error) {
    console.error('Error unliking photo:', error);
    res.status(500).json({ success: false, message: '取消点赞失败' });
  }
});

/**
 * 显式累加浏览量接口（24h 去重）。
 * 与详情接口共用 recordViewIfEligible helper，避免重复计数时调用方需要双次请求。
 * 响应附带 counted 字段标识本次浏览是否被计入。
 */
router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    // 登录按 user_id 去重，未登录按 client IP 去重
    const currentUserId = getCurrentUserId(req);
    const viewerKey = currentUserId ? `user:${currentUserId}` : `ip:${getClientIp(req)}`;
    const counted = await recordViewIfEligible(id, viewerKey);

    const updatedPhoto = await db.get<{ views: number }>('SELECT views FROM photos WHERE id = ?', id);

    res.json({
      success: true,
      data: { views: updatedPhoto?.views || 0, counted },
    });
  } catch (error) {
    console.error('Error incrementing view:', error);
    res.status(500).json({ success: false, message: '更新浏览量失败' });
  }
});

/**
 * OSS 图片代理接口。
 * 接收 OSS Key，生成预签名 URL 后通过服务端流式转发，避免前端直接持有 OSS 凭证。
 * 缩略图 404 时自动回退到原图；任何失败最终返回占位 SVG。
 * 安全策略：未审核照片（pending/rejected）的图片仅所有者可访问。
 * @param key OSS 对象 Key（URL 编码）
 */
router.get('/image/*', async (req: any, res) => {
  // 客户端提前断开连接时，通过 AbortController 取消上游 fetch，避免 response.body 残留占用
  const controller = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    // 通配符参数 [0] 携带完整的 OSS Key
    const key: string = req.params[0];
    let decodedKey = decodeURIComponent(key);

    console.log('Proxy image request:', decodedKey);

    // 安全检查：查找该图片所属的照片记录
    const photoId = req.query.photoId as string | undefined;
    let photo: any | null = null;

    if (photoId) {
      // 快速路径：通过 URL 参数传入 photoId，直接查询
      photo = await db.get('SELECT id, status, user_id FROM photos WHERE id = ?', photoId);
    }

    if (!photo) {
      // 兜底路径：通过 OSS Key 反查照片记录
      photo = await findPhotoByOssKey(decodedKey);
    }

    // 如果找到了照片且状态不是 approved，检查访问权限
    if (photo && photo.status && photo.status !== 'approved') {
      // 管理员可查看所有状态的照片，绕过审核状态限制
      const isAdmin = await isAdminRequest(req);
      if (!isAdmin) {
        const currentUserId = getCurrentUserId(req);
        // 非所有者尝试访问未审核照片 → 403 禁止
        if (!currentUserId || photo.user_id !== currentUserId) {
          console.log(`Blocked access to unapproved photo ${photo.id} (status: ${photo.status})`);
          return sendForbiddenImage(res);
        }
      }
    }

    const presignedUrl = await getFileUrl(decodedKey);

    const response = await fetch(presignedUrl, { signal: controller.signal });

    if (!response.ok) {
      // 缩略图不存在时尝试回退到原图：将 _thumb 后缀还原为原始扩展名
      if (response.status === 404 && decodedKey.includes('_thumb')) {
        const originalKey = decodedKey.replace('_thumb.webp', '.jpg').replace('_thumb.jpg', '.jpg').replace('_thumb.png', '.png');
        console.log('Thumbnail not found, falling back to original:', originalKey);

        const originalPresignedUrl = await getFileUrl(originalKey);
        const originalResponse = await fetch(originalPresignedUrl, { signal: controller.signal });

        if (!originalResponse.ok) {
          console.error('Original image also not found:', originalKey);
          return sendPlaceholderImage(res);
        }

        const contentType = originalResponse.headers.get('content-type') || 'image/jpeg';

        res.setHeader('Content-Type', contentType);
        if (originalResponse.body) {
          // 使用 pipe 自动处理背压和流清理，避免 reader 泄漏
          const { pipeline } = require('stream');
          const { Readable } = require('stream');
          const nodeStream = Readable.fromWeb(originalResponse.body);
          pipeline(nodeStream, res, (err: any) => {
            if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
              console.error('Stream pipeline error:', err);
            }
          });
        }
        return;
      }
      return sendPlaceholderImage(res);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    if (response.body) {
      // 使用 pipeline 自动处理背压和流清理，避免 reader 泄漏
      const { pipeline } = require('stream');
      const { Readable } = require('stream');
      const nodeStream = Readable.fromWeb(response.body);
      pipeline(nodeStream, res, (err: any) => {
        if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
          console.error('Stream pipeline error:', err);
        }
      });
    }
  } catch (error: any) {
    // 客户端主动断开导致的 abort 不视为错误
    if (error?.name === 'AbortError') {
      console.log('Proxy image request aborted by client:', req.params[0]);
      return;
    }
    console.error('Error proxying image:', error);
    sendPlaceholderImage(res);
  }
});

/**
 * 返回占位 SVG 图片。
 * 当 OSS 图片不可用时作为兜底响应，保证前端能正常渲染图片位。
 */
function sendPlaceholderImage(res: any) {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#374151" />
    <text x="200" y="140" text-anchor="middle" fill="#9CA3AF" font-family="sans-serif" font-size="16">图片暂不可用</text>
    <text x="200" y="165" text-anchor="middle" fill="#6B7280" font-family="sans-serif" font-size="12">Image Unavailable</text>
  </svg>`;
  
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Content-Length', Buffer.byteLength(svgContent));
  res.send(svgContent);
}

/**
 * 返回禁止访问的占位 SVG 图片。
 * 当非所有者尝试访问未审核照片时返回，明确告知无权查看。
 */
function sendForbiddenImage(res: any) {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#991B1B" />
    <text x="200" y="130" text-anchor="middle" fill="#FCA5A5" font-family="sans-serif" font-size="16">访问被禁止</text>
    <text x="200" y="155" text-anchor="middle" fill="#F87171" font-family="sans-serif" font-size="12">照片正在审核中</text>
    <text x="200" y="175" text-anchor="middle" fill="#EF4444" font-family="sans-serif" font-size="10">Access Denied</text>
  </svg>`;
  
  res.status(403);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Content-Length', Buffer.byteLength(svgContent));
  res.send(svgContent);
}

/**
 * 生成 OSS 预签名上传地址。
 * 前端使用该地址直接 PUT 上传文件至 OSS，无需经过服务端中转。
 * @body fileName 目标文件名
 * @returns uploadUrl 预签名上传 URL、key OSS 对象 Key
 */
router.post('/upload/presigned', async (req, res) => {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ success: false, message: '文件名不能为空' });
    }

    const presignedUrl = await generatePresignedUploadUrl(fileName);

    res.json({
      success: true,
      data: {
        uploadUrl: presignedUrl.url,
        key: presignedUrl.key,
      },
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ success: false, message: '生成上传地址失败' });
  }
});

/**
 * 预签名上传完成回调接口。
 * 前端直传 OSS 成功后调用，服务端确认上传结果并写入照片元数据。
 * 照片 ID 取当前最大数值 ID + 1，并补零至 6 位。
 */
router.post('/upload/complete', async (req, res) => {
  try {
    const { key, title, tags, description, camera_model, vehicle, location, altitude, focal_length, iso, shutter_speed, aperture, width, height } = req.body;

    if (!key) {
      return res.status(400).json({ success: false, message: '文件Key不能为空' });
    }

    // 确认 OSS 上传结果，返回原图与缩略图 URL
    const uploadResult = await completeUpload(key);

    // tags 字段支持数组或中英文逗号分隔字符串，统一序列化为 JSON 数组字符串存储
    const newPhoto = {
      title: title || '未命名照片',
      thumbnail_path: uploadResult.thumbnailUrl,
      original_url: uploadResult.url,
      tags: tags ? JSON.stringify(Array.isArray(tags) ? tags : tags.split(/[,，]/).map((t: string) => t.trim()).filter((t: string) => t)) : '[]',
      width: width || 0,
      height: height || 0,
      description: description || '',
      camera_model: camera_model || '',
      vehicle: vehicle || '',
      location: location || '',
      altitude: altitude || 0,
      focal_length: focal_length || '',
      iso: iso || 0,
      shutter_speed: shutter_speed || '',
      aperture: aperture || '',
      likes: 0,
      views: 0,
      created_at: new Date().toISOString(),
    };

    // 使用事务包装 ID 生成与插入，防止并发上传导致 ID 冲突
    // BEGIN IMMEDIATE 立即获取写锁，串行化并发写入请求
    await db.exec('BEGIN IMMEDIATE TRANSACTION');
    let newId: string;
    try {
      // 生成自增 ID：查询当前最大数值 ID 并 +1，补齐 6 位前导零
      const maxIdResult = await db.get("SELECT id FROM photos ORDER BY CAST(id AS INTEGER) DESC LIMIT 1");
      let currentMaxId = 0;
      if (maxIdResult?.id) {
        const parsed = parseInt(maxIdResult.id, 10);
        if (!isNaN(parsed) && parsed > 0) {
          currentMaxId = parsed;
        }
      }
      newId = String(currentMaxId + 1).padStart(6, '0');

      await db.run(
        'INSERT INTO photos (id, title, thumbnail_path, original_url, tags, width, height, description, camera_model, vehicle, location, altitude, focal_length, iso, shutter_speed, aperture, likes, views, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId,
        newPhoto.title,
        newPhoto.thumbnail_path,
        newPhoto.original_url,
        newPhoto.tags,
        newPhoto.width,
        newPhoto.height,
        newPhoto.description,
        newPhoto.camera_model,
        newPhoto.vehicle,
        newPhoto.location,
        newPhoto.altitude,
        newPhoto.focal_length,
        newPhoto.iso,
        newPhoto.shutter_speed,
        newPhoto.aperture,
        newPhoto.likes,
        newPhoto.views,
        newPhoto.created_at
      );

      await db.exec('COMMIT');
    } catch (txError) {
      // 事务失败时回滚，避免锁残留
      try {
        await db.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Failed to rollback transaction:', rollbackErr);
      }
      throw txError;
    }

    res.json({
      success: true,
      data: {
        photoId: newId,
        key: uploadResult.key,
        // 返回代理 URL 而非 OSS 直链
        url: `/api/photos/image/${encodeURIComponent(uploadResult.url)}`,
        thumbnailUrl: `/api/photos/image/${encodeURIComponent(uploadResult.thumbnailUrl)}`,
      },
    });
  } catch (error) {
    console.error('Error completing upload:', error);
    res.status(500).json({ success: false, message: '上传完成处理失败' });
  }
});

/**
 * 直接上传图片接口（服务端中转）。
 * 接收 multipart 文件流，依次完成：JWT 鉴权 → 敏感词校验 → 图片处理（缩略图/预览图/水印图）
 * → OSS 上传 → 元数据写入。新照片状态固定为 pending，需管理员审核后才能在前台展示。
 * 所有大 Buffer（multer 原始上传 Buffer、sharp 生成 Buffer）统一接入 MemoryManager，
 * 在 finally 中显式释放，避免 OOM。
 * @multipart image 图片文件
 */
router.post('/upload', upload.single('image'), handleUploadError, async (req: express.Request, res: express.Response) => {
  let processedImages: Awaited<ReturnType<typeof processImage>> | null = null;
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的图片' });
    }

    // 1) 登记 multer 原始 Buffer，便于 Manager 异常时兜底回收
    memoryManager.registerBuffer(
      `upload:${file.fieldname}:${Date.now()}`,
      file.buffer.byteLength,
      () => {
        // Buffer.fill(0) 显式清零，立即释放给操作系统（Node.js 版本支持的情况下）
        try {
          (file.buffer as any).fill?.(0);
        } catch {
          /* ignore */
        }
        // 把 req.file 置空，让 GC 在下一轮能够回收这段内存
        (req as any).file = null;
        return true;
      }
    );

    // 可选鉴权：解析 JWT 获取上传者 userId，未登录则记为匿名
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as { userId: string };
        userId = decoded.userId;
      } catch {}
    }

    const {
      title,
      tags,
      description,
      camera_model,
      vehicle,
      location,
      altitude,
      focal_length,
      iso,
      shutter_speed,
      aperture,
      width,
      height,
      watermarkText,
      watermarkX,
      watermarkY,
      watermarkOpacity,
      watermarkSize,
      category,
      structured_tags,
    } = req.body;

    // 分区必填校验：未提供 category 时早期返回，避免后续无意义的图片处理与 OSS 上传
    if (!category) {
      return res.status(400).json({ success: false, message: '请选择照片分区' });
    }

    // 水印配置：仅当提供水印文本时构造配置对象，否则留空
    let watermarkConfig: WatermarkConfig | undefined;
    if (watermarkText) {
      watermarkConfig = {
        text: watermarkText,
        x: parseInt(watermarkX) || 0,
        y: parseInt(watermarkY) || 0,
        opacity: parseFloat(watermarkOpacity) || 0.6,
        size: parseInt(watermarkSize) || 32,
      };
    }

    // 军事相关敏感词黑名单：标题、描述、标签、结构化标签均需校验
    const blacklist = ['军用', '部队', '歼', '运-8', '运-9', '直-10', '直-20', '坦克', '装甲', '导弹', '雷达站', '军港', '护卫舰', '驱逐舰'];
    const checkBlacklist = (text: string) => {
      if (!text) return false;
      return blacklist.some(word => text.includes(word));
    };

    if (checkBlacklist(title) || checkBlacklist(description) || checkBlacklist(tags)) {
      return res.status(400).json({ success: false, message: '内容包含敏感词汇，无法上传' });
    }

    // 结构化标签 JSON：解析后逐字段过滤敏感值，解析失败兜底为空对象
    let validatedStructuredTags = '{}';
    if (structured_tags) {
      try {
        const parsedTags = typeof structured_tags === 'string' ? JSON.parse(structured_tags) : structured_tags;
        const filteredTags: Record<string, any> = {};
        for (const [key, value] of Object.entries(parsedTags)) {
          if (!checkBlacklist(String(value))) {
            filteredTags[key] = value;
          }
        }
        validatedStructuredTags = JSON.stringify(filteredTags);
      } catch {
        validatedStructuredTags = '{}';
      }
    }

    // 生成缩略图、预览图、水印图（如有配置）
    processedImages = await processImage(file.buffer, file.originalname, watermarkConfig);

    // 批量上传至 OSS，返回各尺寸图片的访问 URL
    const uploadedUrls = await uploadProcessedImages(processedImages);

    // 生成自增 6 位补零 ID
    const maxIdResult = await db.get("SELECT id FROM photos ORDER BY CAST(id AS INTEGER) DESC LIMIT 1");
    let currentMaxId = 0;
    if (maxIdResult?.id) {
      const parsed = parseInt(maxIdResult.id, 10);
      if (!isNaN(parsed) && parsed > 0) {
        currentMaxId = parsed;
      }
    }
    const newId = String(currentMaxId + 1).padStart(6, '0');

    const newPhoto = {
      id: newId,
      title: title || '未命名照片',
      thumbnail_path: uploadedUrls.thumbnailUrl,
      original_url: uploadedUrls.previewUrl,
      preview_url: uploadedUrls.previewUrl,
      watermarked_url: uploadedUrls.watermarkedUrl || '',
      watermark_config: watermarkConfig ? JSON.stringify(watermarkConfig) : '{}',
      user_id: userId || null,
      category: category || null,
      tags: tags ? JSON.stringify(Array.isArray(tags) ? tags : tags.split(/[,，]/).map((t: string) => t.trim()).filter((t: string) => t)) : '[]',
      structured_tags: validatedStructuredTags,
      width: width || 0,
      height: height || 0,
      description: description || '',
      camera_model: camera_model || '',
      vehicle: vehicle || '',
      location: location || '',
      altitude: altitude || 0,
      focal_length: focal_length || '',
      iso: iso || 0,
      shutter_speed: shutter_speed || '',
      aperture: aperture || '',
      likes: 0,
      views: 0,
      created_at: new Date().toISOString(),
    };

    // 写入照片记录，状态固定为 pending 等待管理员审核
    await db.run(
      `INSERT INTO photos 
        (id, title, thumbnail_path, original_url, preview_url, watermarked_url, watermark_config, user_id,
         category, tags, structured_tags, width, height, description, camera_model, vehicle, location, altitude, 
         focal_length, iso, shutter_speed, aperture, likes, views, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newPhoto.id,
      newPhoto.title,
      newPhoto.thumbnail_path,
      newPhoto.original_url,
      newPhoto.preview_url,
      newPhoto.watermarked_url,
      newPhoto.watermark_config,
      newPhoto.user_id,
      newPhoto.category,
      newPhoto.tags,
      newPhoto.structured_tags,
      newPhoto.width,
      newPhoto.height,
      newPhoto.description,
      newPhoto.camera_model,
      newPhoto.vehicle,
      newPhoto.location,
      newPhoto.altitude,
      newPhoto.focal_length,
      newPhoto.iso,
      newPhoto.shutter_speed,
      newPhoto.aperture,
      newPhoto.likes,
      newPhoto.views,
      'pending',
      newPhoto.created_at
    );

    res.json({
      success: true,
      data: {
        photoId: newId,
        // 返回代理 URL，前端可直接通过该地址访问图片
        thumbnailUrl: `/api/photos/image/${encodeURIComponent(processedImages.thumbnailKey)}`,
        previewUrl: `/api/photos/image/${encodeURIComponent(processedImages.previewKey)}`,
        ...(processedImages.watermarkedKey
          ? { watermarkedUrl: `/api/photos/image/${encodeURIComponent(processedImages.watermarkedKey)}` }
          : {}),
      },
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ success: false, message: '图片处理失败: ' + (error instanceof Error ? error.message : '未知错误') });
  } finally {
    // 不管成功失败，显式释放 sharp 衍生 Buffer 和 multer 原始 Buffer，避免 V8 新生代晋升到老年代
    if (processedImages) {
      disposeProcessedBuffers(processedImages);
    }
    if (req.file) {
      try {
        (req.file.buffer as any).fill?.(0);
      } catch {
        /* ignore */
      }
      (req as any).file = null;
    }
  }
});

/**
 * 删除照片。
 * 校验 JWT 与照片归属权后，先删除 OSS 上的原图、缩略图、预览图、水印图，
 * 再删除数据库点赞记录与照片记录，保证资源与数据一致。
 * @param id 照片 ID
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 强制鉴权：必须携带有效 Bearer Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    } catch {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const photo = await db.get('SELECT * FROM photos WHERE id = ?', id);
    if (!photo) {
      return res.status(404).json({ success: false, message: '照片不存在' });
    }

    // 权限校验：仅上传者本人可删除
    if (photo.user_id !== decoded.userId) {
      return res.status(403).json({ success: false, message: '无权删除此照片' });
    }

    // 从完整 OSS URL 中提取对象 Key（去除域名前缀与查询参数）
    const extractKey = (url: string) => {
      if (!url) return null;
      const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
      if (url.startsWith(ossDomain)) {
        return url.replace(ossDomain, '').split('?')[0];
      }
      return null;
    };

    // 收集所有需要清理的 OSS 对象 Key
    const keysToDelete = [
      extractKey(photo.original_url),
      extractKey(photo.thumbnail_path),
      extractKey(photo.preview_url),
      extractKey(photo.watermarked_url),
    ].filter(Boolean);

    // 逐个删除 OSS 对象，单文件失败不影响整体流程
    for (const key of keysToDelete) {
      try {
        await deleteFromOSS(key!);
      } catch (error) {
        console.error('Error deleting from OSS:', key, error);
      }
    }

    // 先删点赞记录再删照片，避免外键级联问题（虽已配置 ON DELETE CASCADE，显式删除更安全）
    await db.run('DELETE FROM photo_likes WHERE photo_id = ?', id);
    await db.run('DELETE FROM photos WHERE id = ?', id);

    res.json({ success: true, message: '照片删除成功' });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({ success: false, message: '删除照片失败' });
  }
});

// ── photo_views 旧记录定时清理 ─────────────────────────────────────────────
// 去重窗口 24h，保留 7 天足够回溯；每小时清理一次 7 天前的旧记录避免表无限增长
const PHOTO_VIEWS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
setInterval(() => {
  const cutoff = Date.now() - PHOTO_VIEWS_RETENTION_MS;
  db.run('DELETE FROM photo_views WHERE last_viewed_at < ?', cutoff)
    .then(() => console.log(`[PhotoViews] Cleaned records older than 7 days (cutoff=${new Date(cutoff).toISOString()})`))
    .catch(err => console.error('[PhotoViews] Cleanup failed:', err));
}, 60 * 60 * 1000); // 每小时

export default router;
