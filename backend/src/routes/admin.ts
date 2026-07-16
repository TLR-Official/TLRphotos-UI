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

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '请输入用户名和密码' });
  }

  const result = await adminLogin(username, password);
  
  if (!result.success) {
    return res.status(401).json(result);
  }

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

router.post('/users', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  const { username, password, email, name, role, zone } = req.body;
  
  if (!username || !password || !role || !zone) {
    return res.status(400).json({ success: false, message: '请填写必要信息' });
  }

  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  if (req.admin.role === 'zone_master' && role !== 'zone_auditor') {
    return res.status(403).json({ success: false, message: '分区总审核只能创建分区审核账户' });
  }

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

router.get('/users', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  let role = req.query.role as AdminRole | undefined;
  let zone = req.query.zone as string | undefined;

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

router.get('/users/:id', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const admin = await getAdminUserById(req.params.id);
  
  if (!admin) {
    return res.status(404).json({ success: false, message: '管理员不存在' });
  }

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

router.put('/users/:id', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { email, name, role, zone, is_active } = req.body;
  const targetAdmin = await getAdminUserById(req.params.id);
  
  if (!targetAdmin) {
    return res.status(404).json({ success: false, message: '管理员不存在' });
  }

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

router.delete('/users/:id', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const targetAdmin = await getAdminUserById(req.params.id);
  
  if (!targetAdmin) {
    return res.status(404).json({ success: false, message: '管理员不存在' });
  }

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

router.get('/photos/pending', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;

  let query = 'SELECT p.*, u.username as uploader_name, u.avatar_url as uploader_avatar FROM photos p LEFT JOIN users u ON p.user_id = u.id WHERE p.status = "pending"';
  const params: (string | number)[] = [];

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

router.put('/photos/:id/approve', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  if (photo.status !== 'pending') {
    return res.status(400).json({ success: false, message: '照片状态不是待审核' });
  }

  await db.run('UPDATE photos SET status = "approved" WHERE id = ?', [req.params.id]);
  await logAdminAction(req.admin, 'approve_photo', 'photo', req.params.id, { title: photo.title });
  
  res.json({ success: true, message: '审核通过' });
});

router.put('/photos/:id/reject', adminAuthMiddleware, async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { reason } = req.body;
  const photo = await db.get('SELECT * FROM photos WHERE id = ?', [req.params.id]);
  
  if (!photo) {
    return res.status(404).json({ success: false, message: '照片不存在' });
  }

  if (photo.status !== 'pending') {
    return res.status(400).json({ success: false, message: '照片状态不是待审核' });
  }

  await db.run('UPDATE photos SET status = "rejected" WHERE id = ?', [req.params.id]);
  await logAdminAction(req.admin, 'reject_photo', 'photo', req.params.id, { title: photo.title, reason });
  
  res.json({ success: true, message: '审核拒绝' });
});

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

router.get('/users/list', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const offset = (page - 1) * pageSize;
  const keyword = req.query.keyword as string || '';

  let query = 'SELECT * FROM users';
  const params: (string | number)[] = [];

  if (keyword) {
    query += ' WHERE username LIKE ? OR email LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const users = await db.all(query, params);
  
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

router.put('/users/:id/toggle', adminAuthMiddleware, requireRole(['super']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  const newStatus = user.is_active ? 0 : 1;
  await db.run('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);
  await logAdminAction(req.admin, newStatus ? 'activate_user' : 'deactivate_user', 'user', req.params.id, { username: user.username });
  
  res.json({
    success: true,
    message: newStatus ? '用户已启用' : '用户已禁用',
    data: { is_active: newStatus },
  });
});

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

  if (req.admin.role === 'zone_master') {
    query += ' WHERE admin_id = ?';
    countQuery += ' WHERE admin_id = ?';
    params.push(req.admin.id);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

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

router.get('/stats', adminAuthMiddleware, requireRole(['super', 'zone_master']), async (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

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