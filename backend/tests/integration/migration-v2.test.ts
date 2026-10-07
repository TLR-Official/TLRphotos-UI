/**
 * @file V2.0.0 数据库迁移测试
 * @description 构造 V1.13.1 旧结构库（含 phone/phone_verified 列、探测账号、短信验证码记录），
 *              执行 initDb 验证：表重建去手机列、垃圾账号清理、短信码清空、数据完整性与幂等性。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

let fixturePath: string;

/**
 * 构造 V1.13.1 时代旧结构数据库：
 * - users 含 phone/phone_verified，无 email_verified
 * - admin_users 含 phone/phone_verified
 * - 2 个 agent.probe 探测账号（无关联数据，应被删除）
 * - 3 条短信验证码 + 若干邮箱验证码
 * - 真实用户 5 人，含照片/点赞/浏览关联
 */
async function buildLegacyFixture(target: string) {
  if (fs.existsSync(target)) fs.unlinkSync(target);
  const legacy = new Database(target);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      bio TEXT,
      website TEXT,
      location TEXT,
      custom_fields TEXT,
      phone TEXT,
      phone_verified INTEGER DEFAULT 0,
      wechat_openid TEXT,
      qq_openid TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      banned_at TEXT,
      can_upload INTEGER DEFAULT 1,
      can_view INTEGER DEFAULT 1,
      can_download INTEGER DEFAULT 1,
      can_like INTEGER DEFAULT 1
    );
    CREATE TABLE photos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      original_url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      user_id TEXT,
      category TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE photo_likes (
      photo_id TEXT NOT NULL,
      user_id TEXT DEFAULT 'anonymous',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (photo_id, user_id),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    );
    CREATE TABLE photo_views (
      photo_id TEXT NOT NULL,
      viewer_key TEXT NOT NULL,
      last_viewed_at INTEGER NOT NULL,
      PRIMARY KEY (photo_id, viewer_key),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    );
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'zone_auditor',
      zone TEXT DEFAULT 'default',
      is_active INTEGER DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      phone TEXT,
      phone_verified INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE verification_codes (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      channel TEXT NOT NULL,
      scene TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      ip TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const now = new Date().toISOString();
  const insertUser = legacy.prepare(
    `INSERT INTO users (id, email, password_hash, username, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, 'x', ?, ?, ?, ?, ?)`
  );
  // 5 个真实老用户（模拟生产库：2026-09-26 前注册、全部无验证标记）
  insertUser.run('u1', 'user1@example.com', '老用户一', '13800000001', 1, now, now);
  insertUser.run('u2', 'user2@example.com', '老用户二', '13800000002', 0, now, now);
  insertUser.run('u3', 'user3@example.com', '老用户三', null, 0, now, now);
  // 手机-only 历史用户：email 为空，迁移后必须强制绑定邮箱
  insertUser.run('u4', null, '手机注册用户', '13800000004', 1, now, now);
  insertUser.run('u5', 'user5@example.com', '老用户五', null, 0, now, now);

  // 2 个探测垃圾账号
  insertUserRun('p1', 'agent.probe.9f2@example.com', 'agent.probe.9f2', null, 0);
  insertUserRun('p2', 'agent.probe.role.a7@example.com', 'agent.probe.role.a7', null, 0);
  function insertUserRun(id: string, email: string, username: string, phone: string | null, pv: number) {
    insertUser.run(id, email, username, phone, pv, now, now);
  }

  // 照片 / 点赞 / 浏览（属于 u1/u2，迁移后须完整保留）
  legacy
    .prepare(
      `INSERT INTO photos (id, title, thumbnail_path, original_url, status, user_id, created_at)
       VALUES (?, ?, 't', 'o', 'approved', ?, ?)`
    )
    .run('photo1', '照片一', 'u1', now);
  legacy
    .prepare(
      `INSERT INTO photos (id, title, thumbnail_path, original_url, status, user_id, created_at)
       VALUES (?, ?, 't', 'o', 'pending', ?, ?)`
    )
    .run('photo2', '照片二', 'u2', now);
  legacy.prepare('INSERT INTO photo_likes (photo_id, user_id) VALUES (?, ?)').run('photo1', 'u2');
  legacy
    .prepare('INSERT INTO photo_views (photo_id, viewer_key, last_viewed_at) VALUES (?, ?, ?)')
    .run('photo1', 'user:u1', Date.now());

  // 管理员：超管 + 审核员，均带手机号
  legacy
    .prepare(
      `INSERT INTO admin_users (id, username, password_hash, name, role, zone, phone, phone_verified)
       VALUES (?, ?, 'x', ?, 'super', NULL, ?, 1)`
    )
    .run('a1', 'superadmin', '超管', '13900000001');
  legacy
    .prepare(
      `INSERT INTO admin_users (id, username, password_hash, name, role, zone, phone, phone_verified)
       VALUES (?, ?, 'x', ?, 'zone_auditor', 'landscape', ?, 0)`
    )
    .run('a2', 'zoneauditor', '审核员', '13900000002');

  // 3 条短信验证码 + 2 条邮箱验证码
  const insertCode = legacy.prepare(
    `INSERT INTO verification_codes (id, target, channel, scene, code_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'h', ?, ?)`
  );
  insertCode.run('c1', '13800000001', 'sms', 'login', now, now);
  insertCode.run('c2', '13800000002', 'sms', 'register', now, now);
  insertCode.run('c3', '13900000001', 'sms', 'login', now, now);
  insertCode.run('c4', 'user1@example.com', 'mail', 'login', now, now);
  insertCode.run('c5', 'user2@example.com', 'mail', 'register', now, now);

  legacy.close();
}

beforeAll(async () => {
  fixturePath = path.join(__dirname, '../../data/test-migration-v2.db');
  await buildLegacyFixture(fixturePath);
  process.env.DB_PATH = fixturePath;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-0123456789abcdef';

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
});

describe('V2.0.0 users 表重建', () => {
  it('phone / phone_verified 列已物理移除', async () => {
    const { db } = await import('../../src/db');
    const cols = (await db.all('PRAGMA table_info(users)')) as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'phone')).toBe(false);
    expect(cols.some((c) => c.name === 'phone_verified')).toBe(false);
  });

  it('新增 email_verified NOT NULL 列，老用户默认 0（须重新验邮）', async () => {
    const { db } = await import('../../src/db');
    const cols = (await db.all('PRAGMA table_info(users)')) as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const ev = cols.find((c) => c.name === 'email_verified');
    expect(ev).toBeDefined();
    expect(ev?.notnull).toBe(1);
    expect(ev?.dflt_value).toBe('0');

    const rows = (await db.all('SELECT id, email_verified FROM users')) as Array<{
      id: string;
      email_verified: number;
    }>;
    for (const row of rows) expect(row.email_verified).toBe(0);
  });

  it('email 列允许 NULL（解除老库 NOT NULL 约束）', async () => {
    const { db } = await import('../../src/db');
    const cols = (await db.all('PRAGMA table_info(users)')) as Array<{ name: string; notnull: number }>;
    expect(cols.find((c) => c.name === 'email')?.notnull).toBe(0);
  });
});

describe('V2.0.0 探测账号清理', () => {
  it('两个 agent.probe 账号已删除，真实用户保留', async () => {
    const { db } = await import('../../src/db');
    const probes = (await db.all(
      "SELECT id FROM users WHERE email LIKE 'agent.probe.%'"
    )) as Array<{ id: string }>;
    expect(probes).toHaveLength(0);

    const count = (await db.get('SELECT COUNT(*) AS c FROM users')) as { c: number };
    expect(count.c).toBe(5);
  });

  it('被删探测账号不存在孤儿关联残留', async () => {
    const { db } = await import('../../src/db');
    const orphanPhotos = (await db.get(
      "SELECT COUNT(*) AS c FROM photos WHERE user_id IN ('p1','p2')"
    )) as { c: number };
    expect(orphanPhotos.c).toBe(0);
  });
});

describe('V2.0.0 短信验证码清理', () => {
  it("channel='sms' 记录已清空，mail 记录保留", async () => {
    const { db } = await import('../../src/db');
    const sms = (await db.get("SELECT COUNT(*) AS c FROM verification_codes WHERE channel='sms'")) as {
      c: number;
    };
    expect(sms.c).toBe(0);
    const mail = (await db.get("SELECT COUNT(*) AS c FROM verification_codes WHERE channel='mail'")) as {
      c: number;
    };
    expect(mail.c).toBe(2);
  });
});

describe('V2.0.0 admin_users 表重建', () => {
  it('phone / phone_verified 列已移除，管理员数据完整', async () => {
    const { db } = await import('../../src/db');
    const cols = (await db.all('PRAGMA table_info(admin_users)')) as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'phone')).toBe(false);
    expect(cols.some((c) => c.name === 'phone_verified')).toBe(false);

    const count = (await db.get('SELECT COUNT(*) AS c FROM admin_users')) as { c: number };
    expect(count.c).toBe(2);
    const superAdmin = await db.get('SELECT username, role FROM admin_users WHERE id = ?', ['a1']);
    expect(superAdmin).toMatchObject({ username: 'superadmin', role: 'super' });
  });
});

describe('V2.0.0 迁移数据完整性', () => {
  it('照片、点赞、浏览记录完整保留并正确归属', async () => {
    const { db } = await import('../../src/db');
    expect((await db.get('SELECT COUNT(*) AS c FROM photos')) as { c: number }).toMatchObject({ c: 2 });
    expect((await db.get('SELECT COUNT(*) AS c FROM photo_likes')) as { c: number }).toMatchObject({
      c: 1,
    });
    expect((await db.get('SELECT COUNT(*) AS c FROM photo_views')) as { c: number }).toMatchObject({
      c: 1,
    });

    const photo1 = await db.get('SELECT user_id, status FROM photos WHERE id = ?', ['photo1']);
    expect(photo1).toMatchObject({ user_id: 'u1', status: 'approved' });
  });

  it('破坏性操作前生成了 .bak-v2-* 备份文件', () => {
    const dir = path.dirname(fixturePath);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith(`${path.basename(fixturePath)}.bak-v2-`));
    expect(backups.length).toBeGreaterThan(0);
  });
});

describe('V2.0.0 迁移幂等性', () => {
  it('重复执行 initDb 不再重建/删数据，结构保持 V2 形态', async () => {
    const dbModule = await import('../../src/db');
    await dbModule.initDb();
    const { db } = dbModule;

    expect((await db.get('SELECT COUNT(*) AS c FROM users')) as { c: number }).toMatchObject({ c: 5 });
    expect((await db.get('SELECT COUNT(*) AS c FROM admin_users')) as { c: number }).toMatchObject({
      c: 2,
    });
    const userCols = (await db.all('PRAGMA table_info(users)')) as Array<{ name: string }>;
    expect(userCols.some((c) => c.name === 'phone')).toBe(false);
    expect(userCols.some((c) => c.name === 'email_verified')).toBe(true);
  });
});
