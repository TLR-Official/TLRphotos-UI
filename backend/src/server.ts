/**
 * @file server.ts
 * @description TLRphotos 后端服务入口文件。
 *              负责 Express 应用装配：加载环境变量、注册全局中间件、
 *              挂载业务路由、暴露静态资源、启动定时清理任务，
 *              并在启动时按序初始化数据库、标签库、超级管理员。
 */
import dotenv from 'dotenv';
// 加载 .env 文件中的环境变量到 process.env
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import photosRouter from './routes/photos';
import articlesRouter from './routes/articles';
import columnRouter from './routes/column';
import authRouter from './routes/auth';
import tagsRouter from './routes/tags';
import adminRouter from './routes/admin';
import verificationRouter from './routes/verification';
import { initDb } from './db';
import { initTagsDb } from './db/tagsDb';
import { cleanupExpired } from './services/cookieService';
import { cleanupExpiredVerifications } from './services/verificationService';
import { initSuperAdmin } from './services/adminService';
import { memoryManager } from './services/memoryManager';

const app = express();
// 服务端口：优先读取环境变量，默认 3001
const PORT = parseInt(process.env.PORT || '3001', 10);

// 全局中间件：跨域、JSON 解析（50MB 上限兼容大图 Base64 上传）、URL 编码解析
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 请求超时中间件：120 秒后强制返回 504，避免长耗时请求占用连接
app.use((req, res, next) => {
  res.setTimeout(120000, () => {
    console.error('Request timeout:', req.method, req.originalUrl);
    res.status(504).json({ success: false, message: '请求超时，请重试' });
  });
  next();
});

// 业务路由挂载：每个路由对应一组 /api/* 接口（含 V1.8.0 人机验证路由）
app.use('/api/auth', authRouter);
app.use('/api/photos', photosRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/column', columnRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/verification', verificationRouter);

// 静态资源：文章 Markdown 原文与上传文件目录
app.use('/articles', express.static(path.join(__dirname, '../../articles')));
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// 健康检查端点：用于负载均衡与监控探活
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'TLRphotos API is running', timestamp: new Date().toISOString() });
});

// 内存状态快照：仅管理员可访问，用于管理后台展示
app.get('/api/admin/memory/snapshot', async (req: any, res) => {
  // 直接复用管理员鉴权
  try {
    const { verifyAdminToken } = require('./services/adminService');
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const admin = await verifyAdminToken(token);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    res.json({ success: true, data: memoryManager.takeSnapshot() });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// 手动触发内存释放：仅管理员可访问
app.post('/api/admin/memory/release', express.json(), async (req: any, res) => {
  try {
    const { verifyAdminToken } = require('./services/adminService');
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const admin = await verifyAdminToken(token);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const forced = (req.body?.level as 'soft' | 'medium' | 'hard') || undefined;
    const level = memoryManager.triggerRelease(forced);
    res.json({ success: true, data: { triggered: level, snapshot: memoryManager.takeSnapshot() } });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// 定时清理任务句柄：保存以便进程退出时清理，避免句柄泄漏阻止优雅退出
let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * 调度过期会话清理任务。
 * 启动时立即执行一次，之后对齐到下一个午夜 0 点，
 * 再以 24 小时为周期循环执行，保证过期 Cookie 及时清理。
 */
function scheduleCleanup() {
  const runCleanup = async () => {
    try {
      const deletedCount = await cleanupExpired();
      console.log(`[Cleanup] Deleted ${deletedCount} expired sessions at ${new Date().toISOString()}`);
      // 同步清理已过期的人机验证状态记录，防止 user_verifications 表无限膨胀
      const verifiedDeleted = await cleanupExpiredVerifications();
      if (verifiedDeleted > 0) {
        console.log(`[Cleanup] Deleted ${verifiedDeleted} expired verifications at ${new Date().toISOString()}`);
      }
    } catch (error) {
      console.error('[Cleanup] Failed to clean up expired sessions:', error);
    }
  };

  // 启动时立即清理一次，避免服务重启后过期数据残留
  runCleanup();

  // 计算距离下一个午夜 0 点的毫秒数，作为首次定时任务的延迟
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const delay = midnight.getTime() - now.getTime();

  // 延迟对齐到午夜后，再以 24 小时为周期循环执行
  cleanupTimer = setTimeout(() => {
    runCleanup();
    cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }, delay);
}

/**
 * 优雅退出：清理定时任务句柄后退出进程。
 * 避免句柄残留导致 process.exit 无法正常退出。
 */
function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * 启动服务器主流程。
 * 按序完成：主数据库初始化 → 标签库初始化 → 超级管理员初始化 →
 * 过期会话清理调度 → HTTP 服务监听。
 * 任一前置步骤失败则立即退出进程，避免服务在不完整状态下运行。
 */
const startServer = async () => {
  try {
    await initDb();
    await initTagsDb();
    await initSuperAdmin();
    scheduleCleanup();
    // 启动内存自动释放管理器（30s 采样，分级触发 GC / sharp缓存清理 / 自重启）
    memoryManager.start();
    // 仅监听 127.0.0.1：外部访问统一经由 Nginx 反向代理（HTTPS + Cloudflare Zero Trust），
    // 避免后端 API 直接暴露在公网，绕过管理后台的访问控制
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`TLRphotos backend server running on http://127.0.0.1:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
