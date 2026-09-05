/**
 * @file admin.ts
 * @description 管理后台路由模块。
 *              提供管理员登录、账户管理（增删改查）、照片审核（通过/拒绝）、
 *              站点用户管理（启用/禁用）、审计日志查询、仪表盘统计等接口。
 *              权限模型基于角色（super/zone_master/zone_auditor）与分区（zone）双重隔离。
 */
import express from 'express';
import { adminAuthMiddleware, requireRole } from '../middleware/adminAuth';
import {
  adminLogin,
  createAdminUser,
  getAdminUsers,
  getAdminUserById,
  updateAdminUser,
  deleteAdminUser,
  logAdminAction,
  getAdminLogs,
  type AdminRole,
} from '../services/adminService';
import { db } from '../db';
import { tagsDb } from '../db/tagsDb';
import { getProxyUrl } from '../utils/url';
import { deleteUserSessions } from '../services/cookieService';
import {
  verifyTurnstileToken,
  saveVerification,
  getValidVerification,
  ensureHumanVerified,
  getVerificationIp,
  isTestBypass,
  VERIFICATION_ACTIONS,
  type VerificationAction,
} from '../services/verificationService';

const router = express.Router();

/**
 * 管理员登录。
 * 校验账号密码后签发管理员专属 JWT，并记录登录审计日志。
 * @body username 用户名
 * @body password 密码
 * @returns JWT + 管理员基础信息
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '请输入用户名和密码' });
    }

    const result = await adminLogin(username, password);

    if (!result.success) {
      return res.status(401).json(result);
    }

    // 记录登录审计日志（包含 IP 用于追踪异常登录）
    await logAdminAction(result.admin!, 'login', 'admin', result.admin!.id, undefined, req.ip);

    res.json({
      success: true,
      token: result.token,
      admin: {
        id: result.admin!.id,
        username: result.admin!.username,
        name: result.admin!.name,
        role: result.admin!.role,
        zone: result.admin!.zone,
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
    },
  });
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
  let query = 'SELECT p.*, u.username as uploader_name, u.avatar_url as uploader_avatar FROM photos p LEFT JOIN users u ON p.user_id = u.id WHERE p.status = "pending"';
  const params: (string | number)[] = [];

  // 分区审核员与分区总审核仅可见本分区照片
  if (req.admin.role === 'zone_auditor' || req.admin.role === 'zone_master') {
    query += ' AND p.category = ?';
    params.push(req.admin.zone);
  }

  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const photos = await db.all(query, params);
  const total = await db.get('SELECT COUNT(*) as count FROM photos WHERE status = "pending"');

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
    SELECT p.*, u.username as uploader_name, u.avatar_url as uploader_avatar
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
 * @param id 照片 ID
 */
router.put('/photos/:id/approve', adminAuthMiddleware, async (req, res) => {
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

  // 通过审核时清除之前的驳回理由
  await db.run('UPDATE photos SET status = "approved", rejection_reason = NULL WHERE id = ?', [req.params.id]);
  await logAdminAction(req.admin, 'approve_photo', 'photo', req.params.id, { title: photo.title });
  
  res.json({ success: true, message: '审核通过' });
});

/**
 * 审核拒绝照片。
 * 仅对 pending 状态的照片生效，更新为 rejected 并记录拒绝原因。
 * @param id 照片 ID
 * @body reason 拒绝原因
 */
router.put('/photos/:id/reject', adminAuthMiddleware, async (req, res) => {
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

  // 存储驳回理由，供上传者查看
  await db.run('UPDATE photos SET status = "rejected", rejection_reason = ? WHERE id = ?', [reason.trim(), req.params.id]);
  await logAdminAction(req.admin, 'reject_photo', 'photo', req.params.id, { title: photo.title, reason });
  
  res.json({ success: true, message: '审核拒绝' });
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
 * 仅传需变更的字段；先取当前值计算变更项，UPDATE 仅变更字段，并记录每项 from→to 审计日志。
 * @param id 用户 ID
 * @body can_upload / can_view / can_download / can_like（0/1，可选）
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

  const user = await db.get<{ id: string; username: string | null; can_upload: number; can_view: number; can_download: number; can_like: number }>(
    'SELECT id, username, can_upload, can_view, can_download, can_like FROM users WHERE id = ?',
    [req.params.id]
  );
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  // 收集变更项：仅接受 0/1 整数，记录 from→to
  const fields = ['can_upload', 'can_view', 'can_download', 'can_like'] as const;
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
      data: { can_upload: user.can_upload, can_view: user.can_view, can_download: user.can_download, can_like: user.can_like },
    });
  }

  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(now, req.params.id);
  await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  await logAdminAction(req.admin, 'update_permissions', 'user', req.params.id, { username: user.username, changes }, req.ip);

  const updated = await db.get<{ can_upload: number; can_view: number; can_download: number; can_like: number }>(
    'SELECT can_upload, can_view, can_download, can_like FROM users WHERE id = ?',
    [req.params.id]
  );

  res.json({
    success: true,
    message: '权限已更新',
    data: updated,
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
  const zoneWhere = zoneFilter ? 'AND category = ?' : '';

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
