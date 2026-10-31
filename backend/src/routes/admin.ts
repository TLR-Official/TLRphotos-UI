/**
 * @file admin.ts
 * @description 管理后台路由模块。
 *              提供管理员登录、账户管理（增删改查）、照片审核（通过/拒绝）、
 *              站点用户管理（启用/禁用）、审计日志查询、仪表盘统计等接口。
 *              权限模型基于角色（super/zone_master/zone_auditor）与分区（zone）双重隔离。
 */
import express from 'express';
import crypto from 'crypto';
import { adminAuthMiddleware, requireRole } from '../middleware/adminAuth';
import { createRateLimiter } from '../middleware/rateLimit';
import {
  verifyAdminCredentials,
  signAdminToken,
  changeAdminPassword,
  createAdminUser,
  getAdminUsers,
  getAdminUserById,
  updateAdminUser,
  deleteAdminUser,
  logAdminAction,
  PHOTO_AUDIT_ROLES,
  type AdminRole,
} from '../services/adminService';
import { getLockRemaining, recordFailure, clearFailures } from '../services/adminLoginGuard';
import { isValidEmail } from '../services/authService';
import { db } from '../db';
import { tagsDb } from '../db/tagsDb';
import { getProxyUrl } from '../utils/url';
import { formatLocalDateTime } from '../utils/datetime';
import { deleteUserSessions } from '../services/cookieService';
import { createNotification } from '../services/notificationService';
import { PENALTY_CAPS } from '../services/penaltyService';
import { evaluateAlerts, takeMetricsSnapshot } from '../services/metricsService';
import {
  verifyTurnstileToken,
  saveVerification,
  getValidVerification,
  ensureHumanVerified,
  getVerificationIp,
  isTestBypass,
  type VerificationAction,
} from '../services/verificationService';

const router = express.Router();

/**
 * 登录入口限速：按真实客户端 IP，每分钟 10 次尝试，
 * 与失败锁定（adminLoginGuard）叠加：限速管频率，锁定管连续猜测。
 */
const adminLoginLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: '登录尝试过于频繁，请稍后再试',
});

/**
 * 管理员登录（V2.0.0：全角色单阶段，移除超管短信第二因素）：
 * IP 限速 → 严格输入校验 → Turnstile 人机验证 → 失败锁定检查 → 常量时间口令校验。
 * 密码校验通过即直接签发 JWT。
 * 成功清零失败计数并审计；失败写 login_failed 审计（命中已知账号时）。
 * @body username 用户名（1–64 字符）
 * @body password 密码（1–128 字符）
 * @body turnstile_token Turnstile 票据（action=admin_login）
 */
router.post('/login', adminLoginLimiter, async (req, res) => {
  try {
    // 登录响应禁止缓存，防止凭据页面被中间代理/浏览器缓存
    res.setHeader('Cache-Control', 'no-store');

    const { username, password, turnstile_token, tokens } = req.body;

    // 严格类型与长度校验：非字符串、空值、超长一律拒绝
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.trim().length === 0 ||
      username.length > 64 ||
      password.length === 0 ||
      password.length > 128
    ) {
      return res.status(400).json({ success: false, message: '请输入用户名和密码' });
    }

    const normalizedUsername = username.trim();
    const clientIp = req.ip ?? 'unknown';

    // 人机验证：非测试环境必须通过 action=admin_login 的 Turnstile 挑战
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, 'admin_login', clientIp);
      if (!verdict.ok) {
        return res.status(verdict.status).json({
          success: false,
          code: 'HUMAN_VERIFICATION_FAILED',
          message: verdict.message,
        });
      }
    }

    // 锁定检查：锁定期内不再执行口令校验
    const lockedMs = getLockRemaining(normalizedUsername, clientIp);
    if (lockedMs !== null) {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_LOGIN_LOCKED',
        message: '尝试次数过多，请稍后再试',
        data: { retry_after_seconds: Math.ceil(lockedMs / 1000) },
      });
    }

    const result = await verifyAdminCredentials(normalizedUsername, password);

    if (!result.success) {
      const failure = recordFailure(normalizedUsername, clientIp);

      // 命中已知账号时写失败审计（未知用户名无法满足外键，仅控制台告警）
      const target = await db.get<{ id: string; username: string }>(
        'SELECT id, username FROM admin_users WHERE username = ?',
        [normalizedUsername]
      );
      if (target) {
        await db.run(
          'INSERT INTO admin_logs (id, admin_id, admin_name, action, target_type, target_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            crypto.randomUUID(),
            target.id,
            target.username,
            'login_failed',
            'admin',
            target.id,
            JSON.stringify({ failures: failure.failures }),
            clientIp,
            new Date().toISOString(),
          ]
        );
      }
      console.warn(`[Admin] 登录失败 username=${normalizedUsername} ip=${clientIp} failures=${failure.failures}`);

      // 本次失败触发锁定
      if (failure.lockedMs !== null) {
        return res.status(403).json({
          success: false,
          code: 'ADMIN_LOGIN_LOCKED',
          message: '连续失败次数过多，账号已临时锁定',
          data: { retry_after_seconds: Math.ceil(failure.lockedMs / 1000) },
        });
      }

      return res.status(401).json(result);
    }

    const admin = result.admin!;

    // 全部角色：登录成功，清零失败计数、审计并直接签发 JWT
    clearFailures(normalizedUsername, clientIp);
    await logAdminAction(admin, 'login', 'admin', admin.id, undefined, clientIp);

    res.json({
      success: true,
      token: signAdminToken(admin),
      admin: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
        zone: admin.zone,
        must_change_password: admin.must_change_password,
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: '登录服务异常，请稍后重试' });
  }
});

/**
 * 获取当前登录管理员信息。
 * 由 adminAuthMiddleware 解析 Token 后直接返回 req.admin 数据。
 */
router.get('/me', adminAuthMiddleware, (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  
  res.json({
    success: true,
    admin: {
      id: req.admin.id,
      username: req.admin.username,
      name: req.admin.name,
      role: req.admin.role,
      zone: req.admin.zone,
      must_change_password: req.admin.must_change_password,
    },
  });
});

/**
 * 修改当前管理员密码。
 * 已登录管理员凭当前密码 + Turnstile（action=admin_change_password）设置新密码；
 * 成功后 password_hash 更新、token_version+1（旧 JWT 立即失效）、must_change_password=0，
 * 并签发新 JWT 随响应返回。
 * @body current_password 当前密码
 * @body new_password 新密码（≥12 位，强度口径与 validateSuperAdminPassword 一致）
 * @body confirm_password 确认新密码
 * @body turnstile_token Turnstile 令牌
 */
router.post('/me/password', adminAuthMiddleware, async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const { current_password, new_password, confirm_password, turnstile_token, tokens } = req.body;
    const clientIp = req.ip ?? 'unknown';

    if (
      typeof current_password !== 'string' ||
      typeof new_password !== 'string' ||
      typeof confirm_password !== 'string'
    ) {
      return res.status(400).json({ success: false, message: '请完整填写密码字段' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ success: false, message: '两次输入的新密码不一致' });
    }

    // 人机验证（测试环境可绕过）
    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, 'admin_change_password', clientIp);
      if (!verdict.ok) {
        return res.status(verdict.status).json({
          success: false,
          code: 'HUMAN_VERIFICATION_FAILED',
          message: verdict.message,
        });
      }
    }

    const result = await changeAdminPassword(req.admin.id, current_password, new_password);
    if (!result.success || !result.admin) {
      return res.status(400).json(result);
    }

    // 旧 JWT 因 tv+1 已失效，签发携带新版本号的新 JWT
    const token = signAdminToken(result.admin);

    await logAdminAction(result.admin, 'change_password', 'admin', result.admin.id, undefined, clientIp);

    res.json({
      success: true,
      message: '密码修改成功',
      token,
      admin: {
        id: result.admin.id,
        username: result.admin.username,
        name: result.admin.name,
        role: result.admin.role,
        zone: result.admin.zone,
        must_change_password: result.admin.must_change_password,
      },
    });
  } catch (error) {
    console.error('Admin change password error:', error);
    res.status(500).json({ success: false, message: '密码修改异常，请稍后重试' });
  }
});

/**
 * 获取分区列表。
 * 查询 tagsDb 的 tag_categories 表，返回全部分区（航空/铁路/汽车），
 * 用于管理后台下拉选择框（如创建账户、过滤照片时的分区选择）。
 */
router.get('/zones', adminAuthMiddleware, async (req, res) => {
  try {
    const zones = await tagsDb.all('SELECT * FROM tag_categories');
    res.json({ success: true, data: zones });
  } catch (error) {
    console.error('Error fetching zones:', error);
    res.status(500).json({ success: false, message: '获取分区列表失败' });
  }
});

/**
 * 创建管理员账户。
 * 仅 super 与 zone_master 角色可调用；zone_master 仅能创建本分区内的 zone_auditor 账户。
 * @body username 用户名
 * @body password 密码
 * @body email 邮箱
 * @body name 姓名
 * @body role 角色
 * @body zone 分区
 */
router.post('/users', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  const { username, password, email, name, role, zone } = req.body;
  
  if (!username || !password || !role || !zone) {
    return res.status(400).json({ success: false, message: '请填写必要信息' });
  }

  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // 权限隔离：zone_master 只能创建 zone_auditor 角色
  if (req.admin.role === 'zone_master' && role !== 'zone_auditor') {
    return res.status(403).json({ success: false, message: '分区总审核只能创建分区审核账户' });
  }

  // 权限隔离：zone_master 只能在自己分区内创建账户
  if (req.admin.role === 'zone_master' && zone !== req.admin.zone) {
    return res.status(403).json({ success: false, message: '只能在自己的分区内创建账户' });
  }

  const result = await createAdminUser({
    username,
    password,
    email,
    name,
    role: role as AdminRole,
    zone,
    created_by: req.admin.id,
  });

  if (!result.success) {
    return res.status(400).json(result);
  }

  await logAdminAction(req.admin, 'create_admin', 'admin', result.admin!.id, { username, role, zone });
  
  res.status(201).json({
    success: true,
    admin: {
      id: result.admin!.id,
      username: result.admin!.username,
      name: result.admin!.name,
      role: result.admin!.role,
      zone: result.admin!.zone,
    },
  });
});

/**
 * 查询管理员账户列表。
 * super 角色可查询全部并支持按 role/zone 过滤；zone_master 仅能查询本分区的 zone_auditor。
 */
router.get('/users', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  let role = req.query.role as AdminRole | undefined;
  let zone = req.query.zone as string | undefined;

  // zone_master 强制限定为本分区 + zone_auditor 角色，忽略前端传入的过滤参数
  if (req.admin.role === 'zone_master') {
    zone = req.admin.zone;
    role = 'zone_auditor';
  }

  const admins = await getAdminUsers(role, zone);
  
  res.json({
    success: true,
    data: admins.map(a => ({
      id: a.id,
      username: a.username,
      name: a.name,
      email: a.email,
      role: a.role,
      zone: a.zone,
      is_active: a.is_active,
      created_by: a.created_by,
      created_at: a.created_at,
    })),
  });
});

/**
 * 获取站点用户列表（分页，仅 super 可访问）。
 * 支持按用户名或邮箱关键词模糊搜索。
 *
 * 注意：本路由必须注册在 `/users/:id` 之前，否则 "list" 会被当作 :id
 * 参数匹配进详情路由，导致 404（与 /photos/stats 同样的顺序约束）。
 * @query page 页码
 * @query pageSize 每页数量
 * @query keyword 用户名或邮箱关键词
 */
router.get('/users/list', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;
  const keyword = req.query.keyword as string || '';

  let query = 'SELECT * FROM users';
  const params: (string | number)[] = [];

  // 关键词搜索：同时匹配用户名与邮箱
  if (keyword) {
    query += ' WHERE username LIKE ? OR email LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const users = await db.all(query, params);

  // 计数查询需与列表查询保持相同的 WHERE 条件
  let countQuery = 'SELECT COUNT(*) as count FROM users';
  if (keyword) {
    countQuery += ' WHERE username LIKE ? OR email LIKE ?';
  }
  const count = await db.get(countQuery, keyword ? [`%${keyword}%`, `%${keyword}%`] : []);

  res.json({
    success: true,
    data: users,
    pagination: {
      page,
      pageSize,
      total: count?.count || 0,
    },
  });
});

/**
 * 获取指定管理员账户详情。
 * zone_master 仅可查看本分区的 zone_auditor 账户。
 * @param id 管理员 ID
 */
router.get('/users/:id', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const admin = await getAdminUserById(req.params.id);
  
  if (!admin) {
    return res.status(404).json({ success: false, message: '管理员不存在' });
  }

  // 权限隔离：zone_master 仅能查看本分区 zone_auditor
  if (req.admin.role === 'zone_master' && admin.role !== 'zone_auditor') {
    return res.status(403).json({ success: false, message: '只能查看分区审核账户' });
  }

  if (req.admin.role === 'zone_master' && admin.zone !== req.admin.zone) {
    return res.status(403).json({ success: false, message: '只能查看自己分区的账户' });
  }

  res.json({
    success: true,
    admin: {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      zone: admin.zone,
      is_active: admin.is_active,
      created_by: admin.created_by,
      created_at: admin.created_at,
      updated_at: admin.updated_at,
    },
  });
});

/**
 * 更新管理员账户信息。
 * zone_master 仅可编辑本分区 zone_auditor，且不能变更角色与分区。
 * @param id 管理员 ID
 */
router.put('/users/:id', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { email, name, role, zone, is_active } = req.body;
  const targetAdmin = await getAdminUserById(req.params.id);
  
  if (!targetAdmin) {
    return res.status(404).json({ success: false, message: '管理员不存在' });
  }

  // zone_master 编辑权限的多重校验：仅本分区 zone_auditor、角色不可变更、分区不可变更
  if (req.admin.role === 'zone_master') {
    if (targetAdmin.role !== 'zone_auditor') {
      return res.status(403).json({ success: false, message: '只能编辑分区审核账户' });
    }
    if (targetAdmin.zone !== req.admin.zone) {
      return res.status(403).json({ success: false, message: '只能编辑自己分区的账户' });
    }
    if (role && role !== 'zone_auditor') {
      return res.status(403).json({ success: false, message: '只能设置为分区审核角色' });
    }
    if (zone && zone !== req.admin.zone) {
      return res.status(403).json({ success: false, message: '只能设置为自己的分区' });
    }
  }

  const result = await updateAdminUser(req.params.id, {
    email,
    name,
    role: role as AdminRole | undefined,
    zone,
    is_active,
  });

  if (!result.success) {
    return res.status(400).json(result);
  }

  await logAdminAction(req.admin, 'update_admin', 'admin', req.params.id, { email, name, role, zone, is_active });
  
  res.json({
    success: true,
    admin: {
      id: result.admin!.id,
      username: result.admin!.username,
      name: result.admin!.name,
      email: result.admin!.email,
      role: result.admin!.role,
      zone: result.admin!.zone,
      is_active: result.admin!.is_active,
    },
  });
});

/**
 * 删除管理员账户。
 * super 账户不可删除；zone_master 仅可删除本分区 zone_auditor。
 * @param id 管理员 ID
 */
router.delete('/users/:id', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const targetAdmin = await getAdminUserById(req.params.id);
  
  if (!targetAdmin) {
    return res.status(404).json({ success: false, message: '管理员不存在' });
  }

  // 保护超级管理员账户不可删除
  if (targetAdmin.role === 'super') {
    return res.status(403).json({ success: false, message: '无法删除最高账户' });
  }

  if (req.admin.role === 'zone_master') {
    if (targetAdmin.role !== 'zone_auditor') {
      return res.status(403).json({ success: false, message: '只能删除分区审核账户' });
    }
    if (targetAdmin.zone !== req.admin.zone) {
      return res.status(403).json({ success: false, message: '只能删除自己分区的账户' });
    }
  }

  await deleteAdminUser(req.params.id);
  await logAdminAction(req.admin, 'delete_admin', 'admin', req.params.id);
  
  res.json({ success: true, message: '删除成功' });
});

/**
 * 获取待审核照片列表（分页）。
 * zone_auditor 与 zone_master 仅可见本分区（category）的待审核照片，super 可查看全部。
 * @query page 页码
 * @query pageSize 每页数量
 */
router.get('/photos/pending', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;

  // LEFT JOIN users 携带上传者信息，便于审核时核对来源
  let query = 'SELECT p.*, u.username as uploader_name, u.avatar_url as uploader_avatar, u.user_title as uploader_title FROM photos p LEFT JOIN users u ON p.user_id = u.id WHERE p.status = "pending"';
  const params: (string | number)[] = [];

  // 分区审核员与分区总审核仅可见本分区照片
  const isZoneScoped = req.admin.role === 'zone_auditor' || req.admin.role === 'zone_master';
  if (isZoneScoped) {
    query += ' AND p.category = ?';
    params.push(req.admin.zone);
  }

  // 顺序审核（软约束）：按上传时间正序排队，最早待审照片优先展示；
  // 不阻断审核员选择其他照片，仅在响应中给出队首提示 next_photo_id
  query += ' ORDER BY p.created_at ASC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const photos = await db.all(query, params);

  // 总数按相同的分区条件统计，避免分区审核员看到全局待审总量
  const countQuery =
    'SELECT COUNT(*) as count FROM photos p WHERE p.status = "pending"' +
    (isZoneScoped ? ' AND p.category = ?' : '');
  const total = await db.get(countQuery, isZoneScoped ? [req.admin.zone] : []);

  // 队列队首（本分区最早待审照片 ID），前端据此标注「下一张」
  const queueHeadQuery =
    'SELECT p.id FROM photos p WHERE p.status = "pending"' +
    (isZoneScoped ? ' AND p.category = ?' : '') +
    ' ORDER BY p.created_at ASC LIMIT 1';
  const queueHead = await db.get(queueHeadQuery, isZoneScoped ? [req.admin.zone] : []);

  // 缩略图地址转换为代理 URL，附带 photoId 以支持代理路由快速鉴权；移除 altitude
  const mappedPhotos = photos.map((photo: any) => {
    delete photo.altitude;
    return {
      ...photo,
      thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
    };
  });

  res.json({
    success: true,
    data: mappedPhotos,
    pagination: {
      page,
      pageSize,
      total: total?.count || 0,
    },
    // 顺序审核软约束：本分区最早待审照片（队首），前端标注「下一张」
    next_photo_id: queueHead?.id || null,
  });
});

/**
 * 获取照片审核状态统计。
 * 按状态分组聚合计数，返回总数、待审核、已通过、已拒绝数量。
 * zone_auditor 与 zone_master 仅统计本分区照片，super 统计全部分区。
 *
 * 注意：本路由必须注册在 `/photos/:id` 之前，否则 "stats" 会被当作 :id
 * 参数匹配进详情路由，导致 404。
 */
router.get('/photos/stats', adminAuthMiddleware, requireRole(['super', 'zone_master', 'zone_auditor']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // 分区审核员与分区总审核仅统计本分区照片
  const zoneFilter = (req.admin.role === 'zone_auditor' || req.admin.role === 'zone_master')
    ? req.admin.zone
    : null;

  let statsQuery = `
    SELECT
      status,
      COUNT(*) as count
    FROM photos
  `;
  const statsParams: (string | number)[] = [];

  if (zoneFilter) {
    statsQuery += ' WHERE category = ?';
    statsParams.push(zoneFilter);
  }

  statsQuery += ' GROUP BY status';

  // V1.5.0：直接 try/catch 替代 Promise.allSettled（避免类型推断问题）
  let stats: { status: string; count: number }[];
  try {
    // sqlite 包的 db.all 类型推断在某些 TS 版本下会丢数组语义，用 as 断言保证类型
    stats = (await db.all(statsQuery, statsParams)) as { status: string; count: number }[];
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: '审核统计查询失败',
      error: e instanceof Error ? e.message : 'unknown',
    });
  }

  // 转换为以状态为键的对象便于前端读取
  const statsMap: Record<string, number> = {};
  stats.forEach((s: { status: string; count: number }) => {
    statsMap[s.status] = s.count;
  });

  // V1.5.0 修复：原 `a + b + c || 0` 有运算符优先级歧义，改为每个字段显式兜底
  const pending = statsMap.pending || 0;
  const approved = statsMap.approved || 0;
  const rejected = statsMap.rejected || 0;

  res.json({
    success: true,
    data: {
      total: pending + approved + rejected,
      pending,
      approved,
      rejected,
      zoneName: zoneFilter || null,
    },
  });
});

/**
 * 获取照片详情（管理员专用）。
 * 返回完整照片信息：EXIF元数据、用户填写的标题/描述/标签、水印配置、
 * 上传者信息、以及所有图片的代理 URL。
 * @param id 照片 ID
 */
router.get('/photos/:id', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { id } = req.params;

  // 查询完整照片记录 + 上传者信息
  const photo = await db.get(`
    SELECT p.*, u.username as uploader_name, u.avatar_url as uploader_avatar, u.user_title as uploader_title
    FROM photos p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `, id);

  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  // 分区审核员与分区总审核仅能查看本分区照片
  if ((req.admin.role === 'zone_auditor' || req.admin.role === 'zone_master') && photo.category !== req.admin.zone) {
    return res.status(403).json({ success: false, message: '该图片不是你所负责的分区' });
  }

  // 解析标签 JSON
  let tags: string[] = [];
  if (photo.tags) {
    try {
      tags = JSON.parse(photo.tags);
    } catch {
      tags = photo.tags.split(' ').filter(Boolean);
    }
  }

  // 解析结构化标签 JSON
  let structuredTags: Record<string, any> = {};
  if (photo.structured_tags) {
    try {
      structuredTags = JSON.parse(photo.structured_tags);
    } catch {}
  }

  // 解析水印配置
  let watermarkConfig: any = null;
  if (photo.watermark_config) {
    try {
      watermarkConfig = JSON.parse(photo.watermark_config);
    } catch {}
  }

  delete photo.altitude;

  res.json({
    success: true,
    data: {
      ...photo,
      // 转换图片 URL 为代理 URL
      thumbnail_path: getProxyUrl(photo.thumbnail_path, photo.id),
      original_url: getProxyUrl(photo.original_url, photo.id),
      preview_url: photo.preview_url ? getProxyUrl(photo.preview_url, photo.id) : '',
      watermarked_url: photo.watermarked_url ? getProxyUrl(photo.watermarked_url, photo.id) : '',
      // 解析后的结构化数据
      tags,
      structured_tags: structuredTags,
      watermark_config: watermarkConfig,
      // 审核信息
      rejection_reason: photo.rejection_reason || null,
    },
  });
});

/**
 * 审核通过照片。
 * 仅对 pending 状态的照片生效，更新为 approved 并清除驳回理由，记录审计日志。
 * V4.0.0：角色白名单锁定为原有三角色（forum_moderator/news_editor 不得审核照片）。
 * @param id 照片 ID
 */
router.put('/photos/:id/approve', adminAuthMiddleware, requireRole(PHOTO_AUDIT_ROLES), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  // 分区权限校验：分区审核员与分区总审核仅能操作本分区照片
  if ((req.admin.role === 'zone_auditor' || req.admin.role === 'zone_master') && photo.category !== req.admin.zone) {
    return res.status(403).json({ success: false, message: '该图片不是你所负责的分区' });
  }

  // 状态校验：仅待审核照片可执行通过操作，避免重复审核
  if (photo.status !== 'pending') {
    return res.status(400).json({ success: false, message: '照片状态不是待审核' });
  }

  // 通过审核时清除之前的驳回理由；V4.0.0：记录审核人与审核时间（供召回权限判定与"我的审核"列表）
  await db.run(
    'UPDATE photos SET status = "approved", rejection_reason = NULL, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    [req.admin.id, new Date().toISOString(), req.params.id]
  );
  await logAdminAction(req.admin, 'approve_photo', 'photo', req.params.id, { title: photo.title });

  res.json({ success: true, message: '审核通过' });
});

/**
 * 审核拒绝照片。
 * 仅对 pending 状态的照片生效，更新为 rejected 并记录拒绝原因。
 * V4.0.0：角色白名单锁定为原有三角色（forum_moderator/news_editor 不得审核照片）。
 * @param id 照片 ID
 * @body reason 拒绝原因
 */
router.put('/photos/:id/reject', adminAuthMiddleware, requireRole(PHOTO_AUDIT_ROLES), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, message: '请填写驳回理由' });
  }

  const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  // 分区权限校验：分区审核员与分区总审核仅能操作本分区照片
  if ((req.admin.role === 'zone_auditor' || req.admin.role === 'zone_master') && photo.category !== req.admin.zone) {
    return res.status(403).json({ success: false, message: '该图片不是你所负责的分区' });
  }

  if (photo.status !== 'pending') {
    return res.status(400).json({ success: false, message: '照片状态不是待审核' });
  }

  // 存储驳回理由，供上传者查看；V4.0.0：同样记录审核人与审核时间
  await db.run(
    'UPDATE photos SET status = "rejected", rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    [reason.trim(), req.admin.id, new Date().toISOString(), req.params.id]
  );
  await logAdminAction(req.admin, 'reject_photo', 'photo', req.params.id, { title: photo.title, reason });

  res.json({ success: true, message: '审核拒绝' });
});

/**
 * 召回已通过的照片重新审核（V4.0.0 三分钟召回两级机制）。
 * 两级机制：
 * - 窗口内（RECALL_WINDOW_MINUTES，逐请求读取，默认 3 分钟）：静默召回，不发通知；
 * - 超窗：reason 必填，召回并通知所有者（type=photo_recalled）。
 * 权限：super/zone_master 可召回任意照片；zone_auditor 仅可召回本人审核
 * （reviewed_by=自己）的照片，reviewed_by 为空（历史数据）时一律拒绝。
 * 已确认热门（is_hot_confirmed=1）的照片不可召回，须先取消热门。
 * @param id 照片 ID
 * @body reason 召回原因（仅超窗时必填）
 */
router.put('/photos/:id/recall', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const photo = await db.get<any>('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }
  if (photo.status !== 'approved') {
    return res.status(400).json({ success: false, message: '仅已通过的照片可召回' });
  }
  if (photo.is_hot_confirmed === 1) {
    return res.status(400).json({
      success: false,
      code: 'HOT_NOT_RECALLABLE',
      message: '热门作品不可召回，请先取消热门标记',
    });
  }

  // zone_auditor 仅可召回本人审核的照片；无审核记录（reviewed_by 为空）一律拒绝
  if (req.admin.role === 'zone_auditor') {
    if (!photo.reviewed_by) {
      return res.status(403).json({ success: false, message: '该照片无本人审核记录，无权召回' });
    }
    if (photo.reviewed_by !== req.admin.id) {
      return res.status(403).json({ success: false, message: '仅可召回本人审核的照片' });
    }
  }

  // 召回窗口逐请求读取环境变量（默认 3 分钟），支持不重启热调
  const rawWindow = process.env.RECALL_WINDOW_MINUTES;
  const parsedWindow = rawWindow !== undefined && rawWindow !== '' ? Number(rawWindow) : NaN;
  const windowMinutes = Number.isFinite(parsedWindow) ? parsedWindow : 3;

  const reviewedAtMs = photo.reviewed_at ? new Date(photo.reviewed_at).getTime() : 0;
  const inWindow = Date.now() - reviewedAtMs <= windowMinutes * 60 * 1000;

  if (inWindow) {
    // 第一级：窗口内静默召回，仅回 pending 并清空审核留痕，不通知所有者
    await db.run(
      'UPDATE photos SET status = "pending", reviewed_by = NULL, reviewed_at = NULL WHERE id = ?',
      req.params.id
    );
    await logAdminAction(req.admin, 'recall_photo', 'photo', req.params.id, {
      title: photo.title,
      silent: true,
      window_minutes: windowMinutes,
    });
    return res.json({
      success: true,
      message: '照片已召回至待审核（窗口内静默）',
      data: { silent: true },
    });
  }

  // 第二级：超窗召回，必须填写原因并通知所有者
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: '超出召回时限，请填写召回原因' });
  }
  const trimmedReason = String(reason).trim();

  await db.run(
    'UPDATE photos SET status = "pending", reviewed_by = NULL, reviewed_at = NULL WHERE id = ?',
    req.params.id
  );

  if (photo.user_id) {
    const owner = await db.get<{ username: string | null }>(
      'SELECT username FROM users WHERE id = ?',
      photo.user_id
    );
    const now = new Date();
    const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日${now.getHours()}时${now.getMinutes()}分`;
    await createNotification({
      user_id: photo.user_id,
      type: 'photo_recalled',
      title: '作品被召回重新审核',
      content: `${owner?.username ?? ''} 您好，您的作品《${photo.title}》于 ${timeStr} 被召回重新审核，原因：${trimmedReason}。详情请见「待审核」页面。`,
      related_type: 'photo',
      related_id: photo.id,
    });
  }

  await logAdminAction(req.admin, 'recall_photo', 'photo', req.params.id, {
    title: photo.title,
    reason: trimmedReason,
    silent: false,
  });

  res.json({ success: true, message: '照片已召回至待审核', data: { silent: false } });
});

/**
 * 确认照片为热门（V4.0.0）。
 * 写入 is_hot_confirmed=1（区别于用户上传时的 is_hot 意愿标记），
 * 已确认热门的照片不可被召回。重复确认幂等返回，不重复通知。
 * @param id 照片 ID
 */
router.put('/photos/:id/hot', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const photo = await db.get<any>('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  if (photo.is_hot_confirmed === 1) {
    return res.json({ success: true, message: '该作品已是热门作品', data: { is_hot_confirmed: 1 } });
  }

  await db.run('UPDATE photos SET is_hot_confirmed = 1 WHERE id = ?', req.params.id);

  if (photo.user_id) {
    await createNotification({
      user_id: photo.user_id,
      type: 'photo_hot',
      title: '作品被评为热门',
      content: `您的作品《${photo.title}》已被评为热门作品，将在热门位展示。`,
      related_type: 'photo',
      related_id: photo.id,
    });
  }

  await logAdminAction(req.admin, 'confirm_photo_hot', 'photo', req.params.id, { title: photo.title });

  res.json({ success: true, message: '已确认为热门作品', data: { is_hot_confirmed: 1 } });
});

/**
 * 将照片分配给指定审核员（V4.0.0 管理端分配优化）。
 * 分配对象必须是存在且启用的 zone_auditor / zone_master 角色管理员，
 * 写入 photos.assigned_to 并记录审计日志。
 * @param id 照片 ID
 * @body assignee_id 审核员管理员 ID
 */
router.put('/photos/:id/assign', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const photo = await db.get<any>('SELECT id, title FROM photos WHERE id = ?', [req.params.id]);
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  const { assignee_id } = req.body;
  if (!assignee_id || typeof assignee_id !== 'string') {
    return res.status(400).json({ success: false, message: '请指定分配的审核员' });
  }

  const assignee = await db.get<{
    id: string;
    username: string;
    name: string | null;
    role: string;
    zone: string | null;
    is_active: number;
  }>('SELECT id, username, name, role, zone, is_active FROM admin_users WHERE id = ?', [assignee_id]);

  if (!assignee || (assignee.role !== 'zone_auditor' && assignee.role !== 'zone_master')) {
    return res.status(400).json({ success: false, message: '分配对象必须是分区审核员或分区总审核' });
  }
  if (!assignee.is_active) {
    return res.status(400).json({ success: false, message: '分配对象已被停用' });
  }

  await db.run('UPDATE photos SET assigned_to = ? WHERE id = ?', [assignee_id, req.params.id]);
  await logAdminAction(req.admin, 'assign_photo', 'photo', req.params.id, {
    title: photo.title,
    assignee_id,
    assignee_name: assignee.username,
  });

  res.json({
    success: true,
    message: '照片已分配',
    data: { assigned_to: assignee_id, assignee_name: assignee.username },
  });
});

/**
 * 我的审核记录（V4.0.0）：当前登录审核员经手（reviewed_by=自己）的照片列表。
 * 供审核员回溯个人审核历史，支持分页与状态筛选。
 * @query page 页码
 * @query pageSize 每页数量
 * @query status 可选，按状态过滤（pending/approved/rejected）
 */
router.get('/my-audits', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM photos WHERE reviewed_by = ?';
  let countQuery = 'SELECT COUNT(*) AS count FROM photos WHERE reviewed_by = ?';
  const params: (string | number)[] = [req.admin.id];

  const status = req.query.status as string | undefined;
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    query += ' AND status = ?';
    countQuery += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY reviewed_at DESC, id DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const photos = await db.all(query, params);
  // 计数查询复用筛选参数（去掉末尾的 LIMIT/OFFSET 两个占位符参数）
  const countParams = params.slice(0, Math.max(1, params.length - 2));
  const total = await db.get<{ count: number }>(countQuery, countParams);

  const mappedPhotos = (photos as any[]).map((photo) => {
    const mapped = { ...photo };
    delete mapped.altitude;
    mapped.thumbnail_path = getProxyUrl(photo.thumbnail_path, photo.id);
    return mapped;
  });

  res.json({
    success: true,
    data: mappedPhotos,
    pagination: {
      page,
      pageSize,
      total: total?.count || 0,
    },
  });
});

/**
 * 切换站点用户启用/禁用状态（仅 super 可访问）。
 * 取当前 is_active 反值并写入，同时记录审计日志。
 * @param id 用户 ID
 */
router.put('/users/:id/toggle', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  // 取当前状态的反值：1 → 0 禁用，0 → 1 启用
  const newStatus = user.is_active ? 0 : 1;
  await db.run('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);
  await logAdminAction(req.admin, newStatus ? 'activate_user' : 'deactivate_user', 'user', req.params.id, { username: user.username });
  
  res.json({
    success: true,
    message: newStatus ? '用户已启用' : '用户已禁用',
    data: { is_active: newStatus },
  });
});

/**
 * 封禁站点用户（仅 super 可访问）。
 * V1.7.0：设置 is_active=0 + banned_at=时间戳，并删除所有"记住我"会话实现强制下线。
 * 被封禁用户重新登录时收到"该账号已被封禁"提示；现有 JWT 因 loadAuthUser 检查 banned_at 立即失效。
 * @param id 用户 ID
 */
router.post('/users/:id/ban', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // V1.8.0：封禁用户为高危操作，需管理员人机验证状态（168h 内同 IP 有效）
  const denied = await ensureHumanVerified('admin', req.admin.id, req);
  if (denied) {
    return res.status(denied.status).json(denied.payload);
  }

  const user = await db.get('SELECT id, username, email, banned_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }
  if (user.banned_at) {
    return res.status(400).json({ success: false, message: '该用户已被封禁' });
  }

  const now = new Date().toISOString();
  await db.run('UPDATE users SET is_active = 0, banned_at = ?, updated_at = ? WHERE id = ?', [now, now, req.params.id]);
  // 强制下线：删除所有"记住我"会话；现有 JWT 由 loadAuthUser 在需鉴权接口拦截
  await deleteUserSessions(req.params.id);
  await logAdminAction(req.admin, 'ban_user', 'user', req.params.id, { username: user.username, email: user.email, banned_at: now }, req.ip);

  res.json({ success: true, message: '用户已封禁' });
});

/**
 * 解封站点用户（仅 super 可访问）。
 * 清除 banned_at 标记并恢复 is_active=1。解封后用户可重新登录。
 * @param id 用户 ID
 */
router.post('/users/:id/unban', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // V1.8.0：解封用户为高危操作，需管理员人机验证状态（168h 内同 IP 有效）
  const denied = await ensureHumanVerified('admin', req.admin.id, req);
  if (denied) {
    return res.status(denied.status).json(denied.payload);
  }

  const user = await db.get('SELECT id, username, email, banned_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }
  if (!user.banned_at) {
    return res.status(400).json({ success: false, message: '该用户未被封禁' });
  }

  const now = new Date().toISOString();
  await db.run('UPDATE users SET is_active = 1, banned_at = NULL, updated_at = ? WHERE id = ?', [now, req.params.id]);
  await logAdminAction(req.admin, 'unban_user', 'user', req.params.id, { username: user.username, email: user.email }, req.ip);

  res.json({ success: true, message: '用户已解封' });
});

/**
 * 更新站点用户功能权限（仅 super 可访问）。
 * V1.7.0：精细化权限控制 — 单独禁用上传/查看/下载/点赞。
 * V4.1.0 Wave 3A：权限项扩展至七项 — 新增 can_comment（评论）与 can_forum_post（论坛发帖）；
 * can_ban_manage 为封禁管理权限项（仅存储与展示，无普通用户执法点）。
 * 仅传需变更的字段；先取当前值计算变更项，UPDATE 仅变更字段，并记录每项 from→to 审计日志。
 * @param id 用户 ID
 * @body can_upload / can_view / can_download / can_like / can_comment / can_forum_post / can_ban_manage（0/1，可选）
 */
router.put('/users/:id/permissions', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // V1.8.0：权限变更为高危操作，需管理员人机验证状态（168h 内同 IP 有效）
  const denied = await ensureHumanVerified('admin', req.admin.id, req);
  if (denied) {
    return res.status(denied.status).json(denied.payload);
  }

  const user = await db.get<{ id: string; username: string | null; can_upload: number; can_view: number; can_download: number; can_like: number; can_comment: number; can_forum_post: number; can_ban_manage: number }>(
    'SELECT id, username, can_upload, can_view, can_download, can_like, can_comment, can_forum_post, can_ban_manage FROM users WHERE id = ?',
    [req.params.id]
  );
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  // 收集变更项：仅接受 0/1 整数，记录 from→to
  const fields = ['can_upload', 'can_view', 'can_download', 'can_like', 'can_comment', 'can_forum_post', 'can_ban_manage'] as const;
  const changes: Record<string, { from: number; to: number }> = {};
  const updates: string[] = [];
  const params: (string | number)[] = [];

  for (const f of fields) {
    const incoming = req.body[f];
    if (incoming === 0 || incoming === 1) {
      const current = user[f];
      if (current !== incoming) {
        changes[f] = { from: current, to: incoming };
        updates.push(`${f} = ?`);
        params.push(incoming);
      }
    }
  }

  if (updates.length === 0) {
    return res.json({
      success: true,
      message: '权限未变更',
      data: {
        can_upload: user.can_upload, can_view: user.can_view, can_download: user.can_download, can_like: user.can_like,
        can_comment: user.can_comment, can_forum_post: user.can_forum_post, can_ban_manage: user.can_ban_manage,
      },
    });
  }

  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(now, req.params.id);
  await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  await logAdminAction(req.admin, 'update_permissions', 'user', req.params.id, { username: user.username, changes }, req.ip);

  const updated = await db.get<{ can_upload: number; can_view: number; can_download: number; can_like: number; can_comment: number; can_forum_post: number; can_ban_manage: number }>(
    'SELECT can_upload, can_view, can_download, can_like, can_comment, can_forum_post, can_ban_manage FROM users WHERE id = ?',
    [req.params.id]
  );

  res.json({
    success: true,
    message: '权限已更新',
    data: updated,
  });
});

/**
 * 变更站点用户邮箱（V2.0.0，仅 super 可访问）。
 * 超管为用户设置新邮箱后置 email_verified=0，用户下次登录须完成邮箱验证码确权。
 * @param id 用户 ID
 * @body email 新邮箱地址
 */
router.put('/users/:id/email', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // 高危操作，需管理员人机验证状态（168h 内同 IP 有效）
  const denied = await ensureHumanVerified('admin', req.admin.id, req);
  if (denied) {
    return res.status(denied.status).json(denied.payload);
  }

  const incomingEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!incomingEmail || !isValidEmail(incomingEmail)) {
    return res.status(400).json({ success: false, message: '请输入正确的邮箱地址' });
  }

  const user = await db.get<{ id: string; username: string | null; email: string | null }>(
    'SELECT id, username, email FROM users WHERE id = ?',
    [req.params.id]
  );
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  // 邮箱已被其他账号占用
  const conflict = await db.get<{ id: string }>('SELECT id FROM users WHERE email = ? AND id != ?', [
    incomingEmail,
    req.params.id,
  ]);
  if (conflict) {
    return res.status(409).json({ success: false, code: 'ALREADY_REGISTERED', message: '该邮箱已被其他账号绑定' });
  }

  if (user.email === incomingEmail) {
    return res.json({ success: true, message: '邮箱未变更', data: { email: incomingEmail } });
  }

  await db.run('UPDATE users SET email = ?, email_verified = 0, updated_at = ? WHERE id = ?', [
    incomingEmail,
    new Date().toISOString(),
    req.params.id,
  ]);

  await logAdminAction(
    req.admin,
    'update_user_email',
    'user',
    req.params.id,
    { username: user.username },
    req.ip
  );

  res.json({
    success: true,
    message: '邮箱已更新，用户须在下次登录时完成邮箱验证',
    data: { email: incomingEmail, email_verified: 0 },
  });
});

/**
 * 对站点用户实施三级处罚（V4.1.0，仅 super/zone_master 可访问）。
 * - 一级（level=1）：警告 — 仅 penalties 留痕（capabilities='[]'），不限制任何能力、不改 users 表；
 * - 二级（level=2）：功能封禁 — capabilities 必填（PENALTY_CAPS 非空子集），days 必填 30~360，
 *   expires_at = now + days；执法由各业务路由经 checkPenaltyCap 动态判断，不写 users 表；
 * - 三级（level=3）：账号封禁 — 写 users.banned_at + banned_until（days 缺省=永久），
 *   停用账号并强制下线所有会话（沿用原二级处罚口径）。
 * 三级均写 penalties（L3 capabilities='["all"]'）并通知被处罚用户（type=penalty）。
 * 权限口径：super 可罚任何站点用户；zone_master 可罚站点用户，
 * 对管理员目标（zone_auditor）仅限本区且仅留痕不落效果；
 * role 为 super/zone_master 的管理员不可被处罚。
 * 高危操作：挂管理员人机验证门（与封禁端点同口径）。
 * @param id 被处罚者 ID（站点用户或 zone_auditor 管理员）
 * @body level 1 | 2 | 3
 * @body reason 处罚原因（必填，≤500 字）
 * @body capabilities 二级必填：能力数组（upload/comment/forum_post/download 的非空子集）
 * @body days 二级必填 30~360；三级可选（缺省永久，提供时 30~360）
 */
router.post('/users/:id/penalty', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // 高危操作：管理员人机验证门（照抄 ban 端点挂法）
  const denied = await ensureHumanVerified('admin', req.admin.id, req);
  if (denied) {
    return res.status(denied.status).json(denied.payload);
  }

  const { level, reason, days, capabilities } = req.body;

  // 公共校验：level 仅 1/2/3，reason 必填且 ≤500 字
  if (level !== 1 && level !== 2 && level !== 3) {
    return res.status(400).json({ success: false, message: '处罚级别必须为 1、2 或 3' });
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ success: false, message: '请填写处罚原因' });
  }
  if (reason.trim().length > 500) {
    return res.status(400).json({ success: false, message: '处罚原因不可超过 500 字' });
  }

  // 二级校验：capabilities 必须为 PENALTY_CAPS 非空子集（快照存储，'all' 仅为 L3 保留值）
  let capsJson = '[]';
  if (level === 2) {
    const caps = Array.isArray(capabilities) ? (capabilities as unknown[]) : null;
    if (!caps || caps.length === 0 || !caps.every((c) => typeof c === 'string' && (PENALTY_CAPS as readonly string[]).includes(c))) {
      return res.status(400).json({
        success: false,
        code: 'PENALTY_CAPS_INVALID',
        message: '功能封禁能力项必须为 上传/评论/论坛发帖/下载 的非空子集',
      });
    }
    capsJson = JSON.stringify(caps);
  }

  // 期限校验与到期时间计算：二级必填 30~360；三级可选（缺省永久）
  const now = new Date();
  const nowIso = now.toISOString();
  let daysNum: number | null = null;
  let expiresAt: string | null = null;
  if (level === 2) {
    daysNum = Number(days);
    if (!Number.isInteger(daysNum) || daysNum < 30 || daysNum > 360) {
      return res.status(400).json({ success: false, code: 'PENALTY_DAYS_INVALID', message: '功能封禁天数需为 30-360 的整数' });
    }
    expiresAt = new Date(now.getTime() + daysNum * 86400000).toISOString();
  } else if (level === 3 && days !== undefined && days !== null && days !== '') {
    daysNum = Number(days);
    if (!Number.isInteger(daysNum) || daysNum < 30 || daysNum > 360) {
      return res.status(400).json({ success: false, code: 'PENALTY_DAYS_INVALID', message: '账号封禁天数需为 30-360 的整数（缺省为永久）' });
    }
    expiresAt = new Date(now.getTime() + daysNum * 86400000).toISOString();
  }

  // 目标解析：优先站点用户，其次管理员（仅 zone_auditor 可被处罚）
  const targetUser = await db.get<{
    id: string;
    username: string | null;
    email: string | null;
    banned_at: string | null;
  }>('SELECT id, username, email, banned_at FROM users WHERE id = ?', [req.params.id]);
  let targetAdmin: {
    id: string;
    username: string;
    role: string;
    zone: string | null;
  } | null = null;

  if (!targetUser) {
    // db.get 无匹配行时返回 undefined，归一化为 null 便于后续判空
    targetAdmin =
      (await db.get<{ id: string; username: string; role: string; zone: string | null }>(
        'SELECT id, username, role, zone FROM admin_users WHERE id = ?',
        [req.params.id]
      )) ?? null;
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    // 不允许对 super/zone_master 实施处罚
    if (targetAdmin.role === 'super' || targetAdmin.role === 'zone_master') {
      return res.status(403).json({ success: false, message: '不允许对超级管理员或分区总审核实施处罚' });
    }
    // zone_master 对管理员目标仅限本区 zone_auditor
    if (
      req.admin.role === 'zone_master' &&
      (targetAdmin.role !== 'zone_auditor' || targetAdmin.zone !== req.admin.zone)
    ) {
      return res.status(403).json({ success: false, message: '分区总审核仅可处罚本分区的分区审核账户' });
    }
  }

  // 落效果：仅三级写 users 表（banned_at/banned_until/is_active + 强制下线）；
  // 一级/二级不改 users 任何字段（二级执法由各业务路由动态判断）；管理员目标仅留痕
  if (targetUser && level === 3) {
    if (targetUser.banned_at) {
      return res.status(400).json({ success: false, message: '该用户已被封禁' });
    }
    await db.run(
      'UPDATE users SET banned_at = ?, banned_until = ?, is_active = 0, updated_at = ? WHERE id = ?',
      [nowIso, expiresAt, nowIso, targetUser.id]
    );
    await deleteUserSessions(targetUser.id);
  }

  // 写处罚记录（三级均必写 capabilities 快照：L1='[]'，L2=勾选快照，L3='["all"]'）
  const penaltyId = crypto.randomUUID();
  const finalCaps = level === 3 ? '["all"]' : capsJson;
  await db.run(
    'INSERT INTO penalties (id, user_id, level, reason, days, expires_at, capabilities, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      penaltyId,
      req.params.id,
      level,
      reason.trim(),
      daysNum,
      expiresAt,
      finalCaps,
      req.admin.id,
      nowIso,
    ]
  );

  // 通知被处罚者（标题/正文含等级名、原因与期限）
  const levelName = level === 1 ? '警告' : level === 2 ? '功能封禁' : '账号封禁';
  const CAP_LABELS: Record<string, string> = {
    upload: '上传',
    comment: '评论',
    forum_post: '论坛发帖',
    download: '下载',
  };
  let penaltyContent: string;
  if (level === 1) {
    penaltyContent = `因「${reason.trim()}」，您收到一次警告。请遵守社区规范，如有异议请联系管理员。`;
  } else if (level === 2) {
    const capsLabel = (JSON.parse(finalCaps) as string[])
      .map((c) => CAP_LABELS[c] ?? c)
      .join('、');
    penaltyContent = `因「${reason.trim()}」，您的${capsLabel}功能被封禁 ${daysNum} 天，将于 ${formatLocalDateTime(expiresAt!)} 自动恢复。`;
  } else {
    penaltyContent = expiresAt
      ? `因「${reason.trim()}」，您的账号被封禁 ${daysNum} 天，将于 ${formatLocalDateTime(expiresAt)} 自动解封。`
      : `因「${reason.trim()}」，您的账号已被永久封禁。如有异议请联系管理员。`;
  }
  await createNotification({
    user_id: req.params.id,
    type: 'penalty',
    title: `处罚通知：${levelName}`,
    content: penaltyContent,
    related_type: 'penalty',
    related_id: penaltyId,
  });

  await logAdminAction(req.admin, 'penalty_user', 'user', req.params.id, {
    level,
    reason: reason.trim(),
    ...(level === 2 ? { capabilities } : {}),
    ...(level !== 1 ? { days: daysNum, expires_at: expiresAt } : {}),
    target_type: targetUser ? 'user' : 'admin',
  }, req.ip);

  res.json({
    success: true,
    message: level === 1 ? '已发出警告' : level === 2 ? '已实施功能封禁' : '已封禁账号',
    data: {
      id: penaltyId,
      user_id: req.params.id,
      level,
      reason: reason.trim(),
      days: daysNum,
      expires_at: expiresAt,
      capabilities: JSON.parse(finalCaps),
      created_by: req.admin.id,
      created_at: nowIso,
      revoked_at: null,
      revoked_by: null,
    },
  });
});

/**
 * 撤销/解除处罚（V4.1.0）。
 * 权限按处罚等级判定：L1 撤销仅 super；L2/L3 解除需 super/zone_master；其他角色一律 403 BAN_MANAGE_DENIED。
 * 已撤销 400 PENALTY_ALREADY_REVOKED；记录不存在 404。
 * L3 解除时若为当前生效封禁来源（users.banned_at 非空且无其他活跃 L3 记录），
 * 清 banned_at/banned_until 并恢复 is_active（与三级处罚落效果对称）；二级无 users 表效果无需清理。
 * 高危操作：挂管理员人机验证门（与处罚端点同口径）。
 * @param id 处罚记录 ID
 */
router.post('/penalties/:id/revoke', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // 高危操作：管理员人机验证门（照抄 ban 端点挂法）
  const denied = await ensureHumanVerified('admin', req.admin.id, req);
  if (denied) {
    return res.status(denied.status).json(denied.payload);
  }

  const penalty = await db.get<{
    id: string;
    user_id: string;
    level: number;
    reason: string;
    revoked_at: string | null;
  }>('SELECT id, user_id, level, reason, revoked_at FROM penalties WHERE id = ?', [req.params.id]);
  if (!penalty) {
    return res.status(404).json({ success: false, message: '处罚记录不存在' });
  }
  if (penalty.revoked_at) {
    return res.status(400).json({ success: false, code: 'PENALTY_ALREADY_REVOKED', message: '该处罚已撤销' });
  }

  // 权限按等级判定：L1 仅 super；L2/L3 super/zone_master；其他角色 403
  const role = req.admin.role;
  const allowed = penalty.level === 1 ? role === 'super' : role === 'super' || role === 'zone_master';
  if (!allowed) {
    return res.status(403).json({ success: false, code: 'BAN_MANAGE_DENIED', message: '无权撤销该处罚' });
  }

  const nowIso = new Date().toISOString();
  await db.run('UPDATE penalties SET revoked_at = ?, revoked_by = ? WHERE id = ?', [
    nowIso,
    req.admin.id,
    penalty.id,
  ]);

  // 三级解除：若该记录是当前生效封禁来源（banned_at 非空且无其他活跃 L3），清封禁标记并恢复启用
  if (penalty.level === 3) {
    const user = await db.get<{ banned_at: string | null }>(
      'SELECT banned_at FROM users WHERE id = ?',
      [penalty.user_id]
    );
    if (user?.banned_at) {
      const otherActiveL3 = await db.get<{ id: string }>(
        'SELECT id FROM penalties WHERE user_id = ? AND id != ? AND level = 3 AND revoked_at IS NULL LIMIT 1',
        [penalty.user_id, penalty.id]
      );
      if (!otherActiveL3) {
        await db.run(
          'UPDATE users SET banned_at = NULL, banned_until = NULL, is_active = 1, updated_at = ? WHERE id = ?',
          [nowIso, penalty.user_id]
        );
      }
    }
  }

  // 通知被处罚用户（管理员目标的留痕记录同样通知，无 FK 依赖）
  await createNotification({
    user_id: penalty.user_id,
    type: 'penalty',
    title: '处罚已撤销',
    content: `您收到的处罚（原因：${penalty.reason}）已被管理员撤销，相关限制已解除。`,
    related_type: 'penalty',
    related_id: penalty.id,
  });

  await logAdminAction(req.admin, 'revoke_penalty', 'penalty', penalty.id, {
    level: penalty.level,
    reason: penalty.reason,
    user_id: penalty.user_id,
  }, req.ip);

  res.json({
    success: true,
    message: '处罚已撤销',
    data: {
      id: penalty.id,
      user_id: penalty.user_id,
      level: penalty.level,
      revoked_at: nowIso,
      revoked_by: req.admin.id,
    },
  });
});

/**
 * 查询指定用户的处罚历史（V4.0.0；V4.1.0 扩展三级字段）。
 * 联创建者管理员用户名，按时间倒序，供管理后台用户详情页展示。
 * capabilities 快照解析为 JSON 数组返回（存储为字符串）；撤销留痕 revoked_at/revoked_by 一并返回。
 * @param id 用户 ID
 */
router.get('/users/:id/penalties', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const user = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  const penalties = await db.all(
    `SELECT p.*, a.username AS created_by_name
     FROM penalties p
     LEFT JOIN admin_users a ON p.created_by = a.id
     WHERE p.user_id = ?
     ORDER BY p.created_at DESC`,
    req.params.id
  );

  const data = (penalties ?? []).map((p: any) => {
    let caps: unknown = null;
    try {
      caps = p.capabilities ? JSON.parse(p.capabilities) : null;
    } catch {
      caps = null;
    }
    return { ...p, capabilities: Array.isArray(caps) ? caps : [] };
  });

  res.json({ success: true, data });
});

/**
 * 申诉列表（V4.0.0，管理侧）：支持按状态筛选，联照片标题与申诉人用户名。
 * @query status 可选：pending/approved/rejected/withdrawn，缺省返回全部
 * @query page 页码
 * @query pageSize 每页数量
 */
router.get('/appeals', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;

  let where = '';
  const params: (string | number)[] = [];
  const status = req.query.status as string | undefined;
  if (status && ['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) {
    where = 'WHERE a.status = ?';
    params.push(status);
  }

  const appeals = await db.all(
    `SELECT a.*, p.title AS photo_title, p.status AS photo_status, p.reviewed_by AS original_reviewer_id,
            r.username AS reviewer_name, u.username AS appellant_name, u.user_title AS appellant_title
     FROM appeals a
     LEFT JOIN photos p ON a.photo_id = p.id
     LEFT JOIN users u ON a.user_id = u.id
     LEFT JOIN admin_users r ON p.reviewed_by = r.id
     ${where}
     ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const total = await db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM appeals a ${where}`,
    params
  );

  res.json({
    success: true,
    data: appeals,
    pagination: {
      page,
      pageSize,
      total: total?.c || 0,
    },
  });
});

/**
 * 申诉裁决（V4.0.0，管理侧）：双向回执。
 * - approve：照片恢复为 approved（reviewed_by 更新为裁决人），通知所有者 type=appeal_approved；
 * - reject：维持照片 rejected，通知所有者 type=appeal_rejected（回执含答复内容）。
 * 仅 pending 状态的申诉可裁决；裁决写 decided_by/decided_at 并审计。
 * 注意：裁决不触碰精修图/预览图等 OSS 对象（既有规则保证）。
 * @param id 申诉 ID
 * @body decision 'approve' | 'reject'
 * @body response 裁决答复（必填，作为回执内容）
 */
router.put('/appeals/:id/decide', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { decision, response, reviewer_fault } = req.body;
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ success: false, message: '裁决结论必须为 approve 或 reject' });
  }
  if (!response || typeof response !== 'string' || !response.trim()) {
    return res.status(400).json({ success: false, message: '请填写裁决答复' });
  }
  const trimmedResponse = response.trim();
  // 审核员责任判定（V4.1.2-beta.3）：none=无责（默认）| mistake=审核失误 | violation=审核违规
  const fault: 'none' | 'mistake' | 'violation' =
    reviewer_fault === 'mistake' || reviewer_fault === 'violation' ? reviewer_fault : 'none';
  // 判定审核员有责时，申诉视为成立：作品直接恢复为通过
  const effectiveDecision: 'approve' | 'reject' = fault === 'none' ? decision : 'approve';

  const appeal = await db.get<any>('SELECT * FROM appeals WHERE id = ?', [req.params.id]);
  if (!appeal) {
    return res.status(404).json({ success: false, message: '申诉不存在' });
  }
  if (appeal.status !== 'pending') {
    return res.status(400).json({ success: false, message: '该申诉已处理完毕' });
  }

  const nowIso = new Date().toISOString();
  const photo = await db.get<any>('SELECT id, title, status, user_id, reviewed_by FROM photos WHERE id = ?', [
    appeal.photo_id,
  ]);

  if (effectiveDecision === 'approve') {
    if (!photo) {
      return res.status(400).json({ success: false, message: '关联照片已不存在，无法恢复' });
    }
    // 照片恢复为 approved，reviewed_by 更新为裁决人
    await db.run(
      'UPDATE photos SET status = "approved", rejection_reason = NULL, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
      [req.admin.id, nowIso, appeal.photo_id]
    );
    if (appeal.user_id) {
      await createNotification({
        user_id: appeal.user_id,
        type: 'appeal_approved',
        title: '申诉已通过',
        content: `您对作品《${photo.title}》的申诉已通过，作品已恢复为「已通过」状态。答复：${trimmedResponse}`,
        related_type: 'appeal',
        related_id: appeal.id,
      });
    }
  } else {
    // 申诉驳回：照片维持 rejected，回执含答复内容
    if (appeal.user_id) {
      const title = photo?.title ?? appeal.photo_id;
      await createNotification({
        user_id: appeal.user_id,
        type: 'appeal_rejected',
        title: '申诉未通过',
        content: `您对作品《${title}》的申诉未通过，作品维持「未通过」状态。答复：${trimmedResponse}`,
        related_type: 'appeal',
        related_id: appeal.id,
      });
    }
  }

  // 判定审核员有责：写入处分记录（mistake=警告，violation=违规待处罚）
  if (fault !== 'none' && photo?.reviewed_by && photo.reviewed_by !== req.admin.id) {
    await db.run(
      `INSERT INTO admin_warnings (id, admin_id, appeal_id, photo_id, severity, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        photo.reviewed_by,
        appeal.id,
        appeal.photo_id,
        fault === 'violation' ? 'penalty' : 'warning',
        trimmedResponse,
        req.admin.id,
        nowIso,
      ]
    );
  }

  await db.run(
    'UPDATE appeals SET status = ?, response = ?, decided_by = ?, decided_at = ?, reviewer_fault = ?, reviewer_admin_id = ? WHERE id = ?',
    [
      effectiveDecision === 'approve' ? 'approved' : 'rejected',
      trimmedResponse,
      req.admin.id,
      nowIso,
      fault,
      photo?.reviewed_by || null,
      appeal.id,
    ]
  );

  await logAdminAction(req.admin, 'decide_appeal', 'appeal', appeal.id, {
    decision: effectiveDecision,
    requested_decision: decision,
    reviewer_fault: fault,
    reviewed_by_admin: photo?.reviewed_by || null,
    photo_id: appeal.photo_id,
    response: trimmedResponse,
  });

  res.json({
    success: true,
    message: effectiveDecision === 'approve' ? '申诉已通过，照片已恢复' : '申诉已驳回',
    data: {
      appeal_id: appeal.id,
      status: effectiveDecision === 'approve' ? 'approved' : 'rejected',
      reviewer_fault: fault,
    },
  });
});

/**
 * 审核员处分记录（V4.1.2-beta.3，管理侧）：super 查看由申诉裁决产生的审核员警告/违规记录。
 * @query admin_id 可选，按审核员过滤
 * @query page 页码
 * @query pageSize 每页数量（默认 20）
 */
router.get('/warnings', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;
  const adminId = req.query.admin_id as string | undefined;

  const where = adminId ? 'WHERE w.admin_id = ?' : '';
  const params: (string | number)[] = adminId ? [adminId] : [];

  const warnings = await db.all(
    `SELECT w.*, a.username AS admin_name, c.username AS created_by_name, p.title AS photo_title
     FROM admin_warnings w
     LEFT JOIN admin_users a ON w.admin_id = a.id
     LEFT JOIN admin_users c ON w.created_by = c.id
     LEFT JOIN photos p ON w.photo_id = p.id
     ${where}
     ORDER BY w.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const total = await db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM admin_warnings w ${where}`,
    params
  );

  res.json({
    success: true,
    data: warnings,
    pagination: { page, pageSize, total: total?.c || 0 },
  });
});

/**
 * 查询审计日志（分页）。
 * super 可查看全部日志；zone_master 仅能查看自己的操作日志。
 * @query page 页码
 * @query pageSize 每页数量（默认 50）
 */
router.get('/logs', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 50;
  const offset = (page - 1) * pageSize;

  let query = 'SELECT * FROM admin_logs';
  let countQuery = 'SELECT COUNT(*) as total FROM admin_logs';
  const params: (string | number)[] = [];

  // zone_master 权限隔离：仅能查看本人的操作日志
  if (req.admin.role === 'zone_master') {
    query += ' WHERE admin_id = ?';
    countQuery += ' WHERE admin_id = ?';
    params.push(req.admin.id);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  // 列表查询与计数查询并行执行，提升响应速度
  const [logs, count] = await Promise.all([
    db.all(query, params),
    db.get(countQuery, req.admin.role === 'zone_master' ? [req.admin.id] : [])
  ]);

  res.json({
    success: true,
    data: logs,
    pagination: {
      page,
      pageSize,
      total: count?.total || 0,
    },
  });
});

/**
 * 获取后台仪表盘统计数据。
 * 并行查询用户数、照片数、管理员数、今日上传数、待审核数，
 * 用于后台首页关键指标展示。
 * zone_master/zone_auditor 仅统计本分区照片（V1.5.0 修复：原 today/pending 无 zone 过滤导致数据不一致）。
 * V1.5.0：改用 Promise.allSettled 隔离单查询失败，返回 partial_error 字段供前端调试。
 */
router.get('/stats', adminAuthMiddleware, requireRole(['super', 'zone_master', 'zone_auditor']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // zone_master/zone_auditor 仅统计本分区照片；super 看全部分区
  const zoneFilter = (req.admin.role === 'zone_master' || req.admin.role === 'zone_auditor')
    ? req.admin.zone
    : null;

  // 五个独立统计查询并行执行，allSettled 隔离失败避免整体 500
  const queries: { key: string; sql: string; params: (string | number)[] }[] = [
    { key: 'userCount', sql: 'SELECT COUNT(*) as count FROM users WHERE is_active = 1', params: [] },
    { key: 'photoCount', sql: zoneFilter
      ? 'SELECT COUNT(*) as count FROM photos WHERE category = ?'
      : 'SELECT COUNT(*) as count FROM photos',
      params: zoneFilter ? [zoneFilter] : [] },
    { key: 'adminCount', sql: 'SELECT COUNT(*) as count FROM admin_users WHERE is_active = 1', params: [] },
    { key: 'todayUploads', sql: zoneFilter
      ? "SELECT COUNT(*) as count FROM photos WHERE DATE(created_at) = DATE('now') AND category = ?"
      : "SELECT COUNT(*) as count FROM photos WHERE DATE(created_at) = DATE('now')",
      params: zoneFilter ? [zoneFilter] : [] },
    { key: 'pendingCount', sql: zoneFilter
      ? "SELECT COUNT(*) as count FROM photos WHERE status = 'pending' AND category = ?"
      : "SELECT COUNT(*) as count FROM photos WHERE status = 'pending'",
      params: zoneFilter ? [zoneFilter] : [] },
  ];

  const results = await Promise.allSettled(queries.map(q => db.get<{ count: number }>(q.sql, q.params)));

  const data: Record<string, number> = {};
  const errors: string[] = [];

  results.forEach((r, i) => {
    const { key } = queries[i];
    if (r.status === 'fulfilled') {
      data[key] = r.value?.count ?? 0;
    } else {
      data[key] = 0;
      errors.push(`${key}: ${r.reason instanceof Error ? r.reason.message : 'unknown'}`);
    }
  });

  // 附带当前管理员的 zone 名（zone_master/zone_auditor 时供前端显示"当前分区：xxx"）
  const zoneName = zoneFilter || null;

  res.json({
    success: true,
    data: { ...data, zoneName },
    ...(errors.length ? { partial_error: errors.join('; ') } : {}),
  });
});

/**
 * 仪表盘健康检查接口（V1.5.0 新增）。
 * 检查关键数据一致性，返回 healthy 状态与 issues 列表，供前端告警条轮询。
 * 检查项：匿名照片数、anonymous 点赞残留、异常状态照片数、近 1h 告警数。
 */
router.get('/dashboard/health', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const checks = await Promise.allSettled([
    db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM photos WHERE user_id IS NULL'),
    db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM photo_likes WHERE user_id = 'anonymous'"),
    db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM article_likes WHERE user_id = 'anonymous'"),
    db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM photos WHERE status NOT IN ('approved', 'pending', 'rejected')"),
    db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM admin_logs WHERE action = 'dashboard_alert' AND created_at > datetime('now', '-1 hour')"),
  ]);

  const values = checks.map(r => r.status === 'fulfilled' ? (r.value?.cnt ?? 0) : -1); // -1 表示查询失败
  const [anonPhotos, anonLikes, anonArtLikes, badStatus, recentAlerts] = values;

  const issues: string[] = [];
  if (anonPhotos > 0) issues.push(`匿名照片: ${anonPhotos}`);
  if (anonLikes > 0) issues.push(`anonymous 点赞: ${anonLikes}`);
  if (anonArtLikes > 0) issues.push(`anonymous 文章点赞: ${anonArtLikes}`);
  if (badStatus > 0) issues.push(`异常状态照片: ${badStatus}`);
  if (recentAlerts > 0) issues.push(`近 1h 告警: ${recentAlerts}`);
  // V4.9.0：注册/上传成功率与 CPU/内存多级告警合入健康检查，管理端告警条直接展示
  for (const alert of evaluateAlerts()) {
    issues.push(`${alert.level === 'critical' ? '严重' : '警告'}：${alert.message}`);
  }
  checks.forEach((r, i) => {
    if (r.status === 'rejected') issues.push(`检查项 ${i} 查询失败: ${r.reason instanceof Error ? r.reason.message : 'unknown'}`);
  });

  res.json({
    success: true,
    data: {
      healthy: issues.length === 0,
      issues,
      checked_at: new Date().toISOString(),
    },
  });
});

/**
 * 核心链路实时指标（V4.9.0）。
 * 返回注册/上传 5 分钟窗口的成功率与延迟分位、CPU/RSS、告警评估与降级状态。
 * 仅 super / zone_master 可访问。
 */
router.get('/metrics', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (_req, res) => {
  res.json({ success: true, data: takeMetricsSnapshot() });
});

// ── 仪表盘健康监控定时任务（V1.5.0 新增） ─────────────────────────────────
// 每 5 分钟检查关键数据一致性，异常时直接 INSERT INTO admin_logs（action='dashboard_alert'）
// + console.error 输出。前端 DashboardPage 30s 轮询 /dashboard/health 读取告警。
setInterval(async () => {
  try {
    const checks = await Promise.allSettled([
      db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM photos WHERE user_id IS NULL'),
      db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM photo_likes WHERE user_id = 'anonymous'"),
      db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM photos WHERE status NOT IN ('approved', 'pending', 'rejected')"),
    ]);

    const [anonPhotosR, anonLikesR, badStatusR] = checks;
    const anonPhotos = anonPhotosR.status === 'fulfilled' ? (anonPhotosR.value?.cnt ?? 0) : 0;
    const anonLikes = anonLikesR.status === 'fulfilled' ? (anonLikesR.value?.cnt ?? 0) : 0;
    const badStatus = badStatusR.status === 'fulfilled' ? (badStatusR.value?.cnt ?? 0) : 0;

    const detected: string[] = [];
    if (anonPhotos > 0) detected.push(`anon_photos=${anonPhotos}`);
    if (anonLikes > 0) detected.push(`anon_likes=${anonLikes}`);
    if (badStatus > 0) detected.push(`bad_status=${badStatus}`);

    if (detected.length > 0) {
      const issueDetails = JSON.stringify({ issues: detected, timestamp: new Date().toISOString() });
      // 直接 INSERT 不依赖 logAdminAction（无 AdminUser 实例）
      await db.run(
        'INSERT INTO admin_logs (id, admin_id, admin_name, action, target_type, target_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        `health-monitor-${Date.now()}`,
        'system_health_monitor',
        'Health Monitor',
        'dashboard_alert',
        'system',
        'health',
        issueDetails,
        '127.0.0.1',
        new Date().toISOString()
      );
      console.error(`[HealthMonitor] 检测到异常: ${detected.join(', ')}`);
    }
  } catch (e) {
    console.error('[HealthMonitor] 检查失败:', e);
  }
}, 5 * 60 * 1000); // 5 分钟

/**
 * 管理员人机验证提交（V1.8.0 新增）。
 * 管理后台高危操作（封禁/解封/权限变更）被 403 拦截后，
 * 管理员完成 Turnstile 挑战，携带 token 调用本接口建立 168h 验证状态。
 * @body turnstile_token Turnstile 挑战令牌
 * @body action 固定为 admin_user_admin
 * @body tokens 测试环境专用绕过参数（NODE_ENV=test 且匹配 TEST_BYPASS_TOKEN）
 */
router.post('/verification/verify', adminAuthMiddleware, async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const { turnstile_token, tokens } = req.body;
    const action: VerificationAction = 'admin_user_admin';
    const ip = getVerificationIp(req);

    if (!isTestBypass(tokens)) {
      const verdict = await verifyTurnstileToken(turnstile_token, action, ip);
      if (!verdict.ok) {
        return res.status(verdict.status).json({ success: false, code: 'HUMAN_VERIFICATION_FAILED', message: verdict.message });
      }
    }

    await saveVerification('admin', req.admin.id, ip, action);
    const state = await getValidVerification('admin', req.admin.id, ip);

    res.json({ success: true, data: { verified: true, verified_at: state?.verifiedAt, expires_at: state?.expiresAt } });
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({ success: false, message: '人机验证失败，请重试' });
  }
});

/**
 * 查询管理员当前人机验证状态（V1.8.0 新增）。
 * 前端用于决定是否需要弹出验证组件。
 */
router.get('/verification/status', adminAuthMiddleware, async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: '未授权' });
    }
    const state = await getValidVerification('admin', req.admin.id, getVerificationIp(req));
    res.json({ success: true, data: { verified: !!state, verified_at: state?.verifiedAt, expires_at: state?.expiresAt } });
  } catch (error) {
    console.error('Admin verification status error:', error);
    res.status(500).json({ success: false, message: '查询验证状态失败' });
  }
});

export default router;
