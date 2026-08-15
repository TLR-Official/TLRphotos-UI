/**
 * @file 管理后台路由集成测试
 * @description 测试管理员认证、权限控制、照片审核工作流等核心管理功能
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

let app: express.Application;
let superAdminToken: string;
let zoneAuditorToken: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();

  // 创建测试用管理员账户
  const bcrypt = (await import('bcrypt')).default;
  const superAdminId = 'test-super-admin';
  const superAdminHash = await bcrypt.hash('Admin123456', 10);

  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'super', NULL, 1, datetime('now'), datetime('now'))`,
    superAdminId, 'superadmin', superAdminHash, '超级管理员'
  );

  const zoneAuditorId = 'test-zone-auditor';
  const zoneAuditorHash = await bcrypt.hash('Auditor123456', 10);
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'zone_auditor', 'landscape', 1, datetime('now'), datetime('now'))`,
    zoneAuditorId, 'zoneauditor', zoneAuditorHash, '分区审核员'
  );

  const adminRoutes = (await import('../../src/routes/admin')).default;

  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);

  // 登录获取 token
  const superLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'superadmin', password: 'Admin123456' });
  superAdminToken = superLogin.body.token || '';

  const zoneLogin = await request(app)
    .post('/api/admin/login')
    .send({ username: 'zoneauditor', password: 'Auditor123456' });
  zoneAuditorToken = zoneLogin.body.token || '';
});

describe('POST /api/admin/login', () => {
  it('应成功登录超级管理员', async () => {
    expect(superAdminToken).toBeTruthy();
  });

  it('应成功登录分区审核员', async () => {
    expect(zoneAuditorToken).toBeTruthy();
  });

  it('应拒绝错误密码', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'superadmin', password: 'WrongPassword' });

    expect(res.body.success).toBe(false);
  });

  it('应拒绝不存在的管理员', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'nonexistent', password: 'password' });

    expect(res.body.success).toBe(false);
  });

  it('应拒绝缺少用户名', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'password' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/photos/pending 权限控制', () => {
  it('应在无 token 时返回 401', async () => {
    const res = await request(app).get('/api/admin/photos/pending');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('应在 token 无效时返回 401', async () => {
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
  });

  it('超级管理员应能查看待审核照片', async () => {
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('分区审核员应能查看待审核照片', async () => {
    const res = await request(app)
      .get('/api/admin/photos/pending')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/admin/photos/:id 权限控制', () => {
  it('应在无 token 时返回 401', async () => {
    const res = await request(app).get('/api/admin/photos/000001');

    expect(res.status).toBe(401);
  });

  it('应在照片不存在时返回 404', async () => {
    const res = await request(app)
      .get('/api/admin/photos/nonexistent-id')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/users 权限控制', () => {
  it('超级管理员应能查看用户列表', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('分区审核员不应能查看用户列表', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/admin/logs', () => {
  it('超级管理员应能查看操作日志', async () => {
    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('分区审核员不应能查看操作日志', async () => {
    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${zoneAuditorToken}`);

    expect(res.status).toBe(403);
  });
});
