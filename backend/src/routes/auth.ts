import express from 'express';
import { register, login, verifyToken, getUserById } from '../services/authService';

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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '邮箱和密码不能为空' });
    }

    const result = await login(email, password);

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

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    res.json({ success: true, message: '退出成功' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: '退出失败' });
  }
});

export default router;