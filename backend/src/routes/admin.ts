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
import { getProxyUrl } from '../utils/url';

const router = express.Router();

/**
 * 管理员登录。
 * 校验账号密码后签发管理员专属 JWT，并记录登录审计日志。
 * @body username 用户名
 * @body password 密码
 * @returns JWT + 管理员基础信息
 */
router.post('/login', async (req, res) => {
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
 * zone_auditor 仅可见本分区（category）的待审核照片，其他角色可查看全部。
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

  // 分区审核员仅可见本分区照片
  if (req.admin.role === 'zone_auditor') {
    query += ' AND p.category = ?';
    params.push(req.admin.zone);
  }

  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const photos = await db.all(query, params);
  const total = await db.get('SELECT COUNT(*) as count FROM photos WHERE status = "pending"');

  res.json({
    success: true,
    data: photos,
    pagination: {
      page,
      pageSize,
      total: total?.count || 0,
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

  // 分区审核员仅能查看本分区照片
  if (req.admin.role === 'zone_auditor' && photo.category !== req.admin.zone) {
    return res.status(403).json({ success: false, message: '无权查看该分区照片' });
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

  if (photo.status !== 'pending') {
    return res.status(400).json({ success: false, message: '照片状态不是待审核' });
  }

  // 存储驳回理由，供上传者查看
  await db.run('UPDATE photos SET status = "rejected", rejection_reason = ? WHERE id = ?', [reason.trim(), req.params.id]);
  await logAdminAction(req.admin, 'reject_photo', 'photo', req.params.id, { title: photo.title, reason });
  
  res.json({ success: true, message: '审核拒绝' });
});

/**
 * 获取照片审核状态统计。
 * 按状态分组聚合计数，返回总数、待审核、已通过、已拒绝数量。
 */
router.get('/photos/stats', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const stats = await db.all(`
    SELECT 
      status, 
      COUNT(*) as count 
    FROM photos 
    GROUP BY status
  `);

  // 转换为以状态为键的对象便于前端读取
  const statsMap: Record<string, number> = {};
  stats.forEach(s => {
    statsMap[s.status] = s.count;
  });

  res.json({
    success: true,
    data: {
      total: statsMap.pending + statsMap.approved + statsMap.rejected || 0,
      pending: statsMap.pending || 0,
      approved: statsMap.approved || 0,
      rejected: statsMap.rejected || 0,
    },
  });
});

/**
 * 获取站点用户列表（分页，仅 super 可访问）。
 * 支持按用户名或邮箱关键词模糊搜索。
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
 */
router.get('/stats', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  // 五个独立统计查询并行执行，减少总响应耗时
  const [userCount, photoCount, adminCount, todayUploads, pendingCount] = await Promise.all([
    db.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1'),
    db.get('SELECT COUNT(*) as count FROM photos'),
    db.get('SELECT COUNT(*) as count FROM admin_users WHERE is_active = 1'),
    db.get("SELECT COUNT(*) as count FROM photos WHERE DATE(created_at) = DATE('now')"),
    db.get("SELECT COUNT(*) as count FROM photos WHERE status = 'pending'"),
  ]);

  res.json({
    success: true,
    data: {
      userCount: userCount?.count || 0,
      photoCount: photoCount?.count || 0,
      adminCount: adminCount?.count || 0,
      todayUploads: todayUploads?.count || 0,
      pendingCount: pendingCount?.count || 0,
    },
  });
});

export default router;
