/**
 * @file 站点内容（合作伙伴 / 规则文件）集成测试（V4.15.0，Q13/Q14）
 * @description 覆盖公开读取仅返回上线内容、管理端 CRUD/上下线与权限门禁。
 *              使用独立临时库，不触达生产数据。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';

let app: express.Application;
let superToken: string;
let auditorToken: string;

beforeAll(async () => {
  const testDbPath = path.join(__dirname, '../../data/test-site-content.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  process.env.DB_PATH = testDbPath;
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  const { signAdminToken } = await import('../../src/services/adminService');

  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES ('sc-super', 'sc-super', 'hash', '超级管理员', 'super', NULL, 1, 0, 0, datetime('now'), datetime('now'))`
  );
  await dbModule.db.run(
    `INSERT OR REPLACE INTO admin_users (id, username, password_hash, name, role, zone, is_active, must_change_password, token_version, created_at, updated_at)
     VALUES ('sc-auditor', 'sc-auditor', 'hash', '分区审核员', 'zone_auditor', 'aviation', 1, 0, 0, datetime('now'), datetime('now'))`
  );

  const superRow = await dbModule.db.get<any>('SELECT * FROM admin_users WHERE id = ?', 'sc-super');
  const auditorRow = await dbModule.db.get<any>('SELECT * FROM admin_users WHERE id = ?', 'sc-auditor');
  superToken = signAdminToken(superRow);
  auditorToken = signAdminToken(auditorRow);

  const siteContent = await import('../../src/routes/siteContent');
  app = express();
  app.use(express.json());
  app.use('/api/admin/site-content', siteContent.adminSiteContentRouter);
  app.use('/api', siteContent.default);
});

describe('站点内容（Q13/Q14）', () => {
  it('公开接口返回种子数据：AAF 合作伙伴与两份规则文件', async () => {
    const partners = await request(app).get('/api/partners');
    expect(partners.status).toBe(200);
    expect(partners.body.data).toHaveLength(1);
    expect(partners.body.data[0].name).toBe('AAF 航空摄影组');

    const rules = await request(app).get('/api/rule-files');
    expect(rules.status).toBe(200);
    expect(rules.body.data).toHaveLength(2);
    expect(rules.body.data[0].url).toBe('/rule-files/upload-rules.pdf');
  });

  it('合作伙伴可新建、下线后公开接口不再返回、可删除', async () => {
    const created = await request(app)
      .post('/api/admin/site-content/partners')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: '测试合作方', description: '简介', logo_text: 'TEST', sort_order: 5 });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const list = await request(app).get('/api/partners');
    expect(list.body.data.some((p: any) => p.id === id)).toBe(true);

    const toggled = await request(app)
      .put(`/api/admin/site-content/partners/${id}/toggle`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(toggled.body.data.is_active).toBe(0);

    const afterOff = await request(app).get('/api/partners');
    expect(afterOff.body.data.some((p: any) => p.id === id)).toBe(false);

    const deleted = await request(app)
      .delete(`/api/admin/site-content/partners/${id}`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(deleted.status).toBe(200);
  });

  it('规则文件可新建并在下线后从前端链接列表移除', async () => {
    const created = await request(app)
      .post('/api/admin/site-content/rule-files')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ title: '临时规则', url: '/rule-files/temp.pdf', version_text: '测试版' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    let rules = await request(app).get('/api/rule-files');
    expect(rules.body.data.some((r: any) => r.id === id)).toBe(true);

    await request(app)
      .put(`/api/admin/site-content/rule-files/${id}/toggle`)
      .set('Authorization', `Bearer ${superToken}`);
    rules = await request(app).get('/api/rule-files');
    expect(rules.body.data.some((r: any) => r.id === id)).toBe(false);

    await request(app)
      .delete(`/api/admin/site-content/rule-files/${id}`)
      .set('Authorization', `Bearer ${superToken}`);
  });

  it('非内容管理角色访问管理接口返回 403 SITE_CONTENT_DENIED', async () => {
    const res = await request(app)
      .get('/api/admin/site-content/partners')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SITE_CONTENT_DENIED');
  });

  it('非法链接被拒绝', async () => {
    const res = await request(app)
      .post('/api/admin/site-content/rule-files')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ title: '非法链接', url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RULE_FILE_FIELDS_INVALID');
  });
});
