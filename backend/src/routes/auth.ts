/**
 * @file auth.ts
 * @description 用户认证路由模块。
 *              覆盖注册、登录、登出、令牌刷新、当前用户信息维护、
 *              修改密码、上传头像、查看指定用户公开资料与照片、
 *              用户仪表盘统计等场景。鉴权统一基于 Bearer Token + Session Token 双令牌机制。
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { register, login, verifyToken, getUserById, updateUser, changePassword, updateAvatar } from '../services/authService';
import { getSession, updateLastActive, deleteSession } from '../services/cookieService';
import { db } from '../db';
import multer from 'multer';
import path from 'path';
import { getProxyUrl } from '../utils/url';

const JWT_SECRET = process.env.JWT_SECRET || '';
// JWT 有效期：固定 24 小时，过期后通过 refresh 接口续签
const JWT_EXPIRES_IN = '24h';

/**
 * 获取客户端真实 IP。
 * 优先读取反向代理设置的 x-forwarded-for / x-real-ip 头，
 * 兜底使用 socket 远端地址，用于会话审计与风控。
 */
function getClientIp(req: express.Request): string {
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.socket.remoteAddress || 
             'unknown';
  return Array.isArray(ip) ? ip[0] : ip;
}

// 头像上传 multer 配置：磁盘存储 + 5MB 限制 + 仅允许 JPG/PNG/WebP
const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 JPG、PNG 或 WebP 格式的图片'));
    }
  },
});

const router = express.Router();

/**
 * 用户注册。
 * 仅校验邮箱与密码必填，username 可选；具体业务逻辑由 authService.register 完成。
 * @body email 邮箱
 * @body password 密码
 * @body username 用户名（可选）
 * @returns 新用户基础信息
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
    }

    const user = await register(email, password, username);

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '注册失败' });
  }
});

/**
 * 用户登录。
 * 调用 authService.login 完成密码校验、JWT 与 Session Token 签发，
 * 同时记录客户端 IP 用于会话安全绑定。
 * @body email 邮箱
 * @body password 密码
 * @body remember 是否记住登录（影响 Session 有效期）
 * @returns 用户信息 + JWT + Session Token
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password, remember } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
    }

    const ipAddress = getClientIp(req);
    const result = await login(email, password, remember, ipAddress);

    res.json({
      success: true,
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          avatar_url: result.user.avatar_url,
        },
        token: result.token,
        session_token: result.session_token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ success: false, message: error instanceof Error ? error.message : '登录失败' });
  }
});

/**
 * 获取当前登录用户信息。
 * 校验 Bearer Token 后返回用户完整资料；若携带 x-session-token 则同步刷新会话活跃时间。
 * @header Authorization Bearer Token
 * @header x-session-token 会话令牌（可选）
 */
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const user = await getUserById(decoded.userId);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 携带会话令牌时刷新 last_active_at，避免会话因长时间未操作而过期
    const sessionToken = req.headers['x-session-token'] as string;
    if (sessionToken) {
      await updateLastActive(sessionToken);
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url,
        bio: user.bio,
        phone: user.phone,
        website: user.website,
        location: user.location,
        // custom_fields 以 JSON 字符串存储，返回时解析为对象
        custom_fields: user.custom_fields ? JSON.parse(user.custom_fields) : null,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

/**
 * 更新当前登录用户资料。
 * 支持用户名、简介、电话、网站、所在地与自定义字段；custom_fields 序列化为 JSON 字符串存储。
 */
router.put('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const { username, bio, phone, website, location, custom_fields } = req.body;

    const updatedUser = await updateUser(decoded.userId, {
      username,
      bio,
      phone,
      website,
      location,
      // 自定义字段序列化为 JSON 字符串便于持久化
      custom_fields: custom_fields ? JSON.stringify(custom_fields) : null,
    });

    res.json({
      success: true,
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        avatar_url: updatedUser.avatar_url,
        bio: updatedUser.bio,
        phone: updatedUser.phone,
        website: updatedUser.website,
        location: updatedUser.location,
        custom_fields: updatedUser.custom_fields ? JSON.parse(updatedUser.custom_fields) : null,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '更新用户信息失败' });
  }
});

/**
 * 修改当前登录用户密码。
 * 需提供原密码与新密码，原密码校验通过后方可更新。
 */
router.put('/me/password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '原密码和新密码不能为空' });
    }

    await changePassword(decoded.userId, oldPassword, newPassword);

    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : '密码修改失败' });
  }
});

/**
 * 上传当前用户头像。
 * 接收 multipart 文件，保存至本地 uploads 目录后写入用户记录，
 * 头像 URL 通过 /uploads 静态目录对外提供。
 */
router.post('/me/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传图片' });
    }

    // 头像 URL 直接使用静态目录路径，前端通过 /uploads 访问
    const avatarUrl = `/uploads/${req.file.filename}`;
    const updatedUser = await updateAvatar(decoded.userId, avatarUrl);

    res.json({
      success: true,
      data: {
        id: updatedUser.id,
        avatar_url: updatedUser.avatar_url,
      },
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '头像上传失败' });
  }
});

/**
 * 退出登录。
 * 携带 x-session-token 时删除对应会话记录，使该会话令牌立即失效。
 */
router.post('/logout', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;
    if (sessionToken) {
      await deleteSession(sessionToken);
    }
    res.json({ success: true, message: '退出成功' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: '退出失败' });
  }
});

/**
 * 获取指定用户公开资料。
 * 仅返回公开字段（用户名、头像、简介、网站、所在地、注册时间），不含邮箱等敏感信息。
 * @param id 用户 ID
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username || '用户',
        avatar_url: user.avatar_url,
        bio: user.bio,
        website: user.website,
        location: user.location,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

/**
 * 获取指定用户的已审核照片列表（分页）。
 * 用于用户主页展示，仅返回已审核通过的照片。
 * @param id 用户 ID
 * @query page 页码（默认 1）
 * @query pageSize 每页数量（默认 20）
 */
router.get('/users/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, pageSize = 20 } = req.query;

    // 计算分页偏移量
    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);

    const photos = await db.all(
      'SELECT id, title, thumbnail_path, tags, width, height, created_at FROM photos WHERE user_id = ? AND status = "approved" ORDER BY created_at DESC LIMIT ? OFFSET ?',
      id,
      parseInt(pageSize as string),
      offset
    );

    const total = await db.get('SELECT COUNT(*) as count FROM photos WHERE user_id = ? AND status = "approved"', id);

    res.json({
      success: true,
      data: {
        photos: photos.map(photo => ({
          ...photo,
          // 缩略图地址转换为代理 URL，附带 photoId 供代理路由快速鉴权；tags JSON 反序列化为数组
          thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
          tags: photo.tags ? JSON.parse(photo.tags) : [],
        })),
        total: total?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get user photos error:', error);
    res.status(500).json({ success: false, message: '获取用户照片失败' });
  }
});

/**
 * 获取用户仪表盘统计数据。
 * 包含照片总数、各状态数量、审核通过率、总浏览量、总点赞数、最近 7 天上传数。
 * @param id 用户 ID
 */
router.get('/users/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // 校验用户存在
    const user = await db.get('SELECT id FROM users WHERE id = ?', id);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 一次性聚合各状态照片数量
    const stats = await db.get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM photos WHERE user_id = ?
    `, id);

    // 已审核照片的总浏览量与总点赞量
    const interactions = await db.get(`
      SELECT
        SUM(views) as total_views,
        SUM(likes) as total_likes
      FROM photos WHERE user_id = ? AND status = 'approved'
    `, id);

    // 最近 7 天上传数量
    const recentUploads = await db.get(`
      SELECT COUNT(*) as count
      FROM photos
      WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
    `, id);

    const total = stats?.total || 0;
    const approved = stats?.approved || 0;
    const pending = stats?.pending || 0;
    const rejected = stats?.rejected || 0;
    // 审核通过率：已审核通过数量 / 总数量，避免除零错误
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    res.json({
      success: true,
      data: {
        totalUploads: total,
        approved: approved,
        pending: pending,
        rejected: rejected,
        approvalRate: approvalRate,
        totalViews: interactions?.total_views || 0,
        totalLikes: interactions?.total_likes || 0,
        recentUploads: recentUploads?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ success: false, message: '获取用户统计失败' });
  }
});

/**
 * 获取当前登录用户的所有照片（含 pending/rejected 及驳回理由）。
 * 供用户在个人中心查看自己上传的所有照片及其审核状态。
 * @query status 可选的状态过滤：pending / approved / rejected，不传则返回全部
 */
router.get('/me/photos', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const { status } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;

    // 构建查询：可选状态过滤
    let query = 'SELECT * FROM photos WHERE user_id = ?';
    const params: any[] = [decoded.userId];

    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const photos = await db.all(query, params);

    // 计数查询
    let countQuery = 'SELECT COUNT(*) as count FROM photos WHERE user_id = ?';
    const countParams: any[] = [decoded.userId];
    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    const total = await db.get(countQuery, countParams);

    res.json({
      success: true,
      data: {
        photos: photos.map((photo: any) => {
          let tags: string[] = [];
          if (photo.tags) {
            try {
              tags = JSON.parse(photo.tags);
            } catch {
              tags = photo.tags.split(' ').filter(Boolean);
            }
          }
          return {
            ...photo,
            thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
            original_url: getProxyUrl(photo.original_url, photo.id),
            preview_url: photo.preview_url ? getProxyUrl(photo.preview_url, photo.id) : '',
            watermarked_url: photo.watermarked_url ? getProxyUrl(photo.watermarked_url, photo.id) : '',
            tags,
            rejection_reason: photo.rejection_reason || null,
          };
        }),
        total: total?.count || 0,
      },
    });
  } catch (error) {
    console.error('Get my photos error:', error);
    res.status(500).json({ success: false, message: '获取我的照片失败' });
  }
});

/**
 * 刷新 JWT 令牌。
 * 通过 Session Token 校验会话有效性，签发新的 JWT 并刷新会话活跃时间，
 * 实现 JWT 过期后的无感续签。
 * @body session_token 会话令牌
 * @returns 新的 JWT 与用户基础信息
 */
router.post('/refresh', async (req, res) => {
  try {
    const { session_token } = req.body;

    if (!session_token) {
      return res.status(400).json({ success: false, message: '会话令牌不能为空' });
    }

    // 校验会话是否存在且未过期
    const session = await getSession(session_token);

    if (!session) {
      return res.status(401).json({ success: false, message: '会话已过期或无效' });
    }

    const user = await getUserById(session.user_id);

    if (!user) {
      // 用户已被删除：清理孤儿会话
      await deleteSession(session_token);
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 签发新 JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 刷新会话活跃时间，避免会话因长时间未操作而过期
    await updateLastActive(session_token);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          avatar_url: user.avatar_url,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ success: false, message: '刷新令牌失败' });
  }
});

export default router;
