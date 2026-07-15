import express from 'express';
import jwt from 'jsonwebtoken';
import { register, login, verifyToken, getUserById, updateUser, changePassword, updateAvatar } from '../services/authService';
import { getSession, updateLastActive, deleteSession } from '../services/cookieService';
import { db } from '../db';
import multer from 'multer';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

function getProxyUrl(key: string) {
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
    if (key.startsWith(ossDomain)) {
      const filePath = key.replace(ossDomain, '').split('?')[0];
      return `/api/photos/image/${encodeURIComponent(filePath)}`;
    }
    return key;
  }
  return `/api/photos/image/${encodeURIComponent(key)}`;
}

function getClientIp(req: express.Request): string {
  const ip = req.headers['x-forwarded-for'] || 
             req.headers['x-real-ip'] || 
             req.socket.remoteAddress || 
             'unknown';
  return Array.isArray(ip) ? ip[0] : ip;
}

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
        custom_fields: user.custom_fields ? JSON.parse(user.custom_fields) : null,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

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

router.get('/users/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, pageSize = 20 } = req.query;

    const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);

    const photos = await db.all(
      'SELECT id, title, thumbnail_path, tags, width, height, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      id,
      parseInt(pageSize as string),
      offset
    );

    const total = await db.get('SELECT COUNT(*) as count FROM photos WHERE user_id = ?', id);

    res.json({
      success: true,
      data: {
        photos: photos.map(photo => ({
          ...photo,
          thumbnail_path: getProxyUrl(photo.thumbnail_path),
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

router.post('/refresh', async (req, res) => {
  try {
    const { session_token } = req.body;

    if (!session_token) {
      return res.status(400).json({ success: false, message: '会话令牌不能为空' });
    }

    const session = await getSession(session_token);

    if (!session) {
      return res.status(401).json({ success: false, message: '会话已过期或无效' });
    }

    const user = await getUserById(session.user_id);

    if (!user) {
      await deleteSession(session_token);
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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