/**
 * @file V3.0.0 旧单层评论迁移测试
 * @description 构造含旧 comments（article_id 结构）的库，执行 initDb，验证：
 *              旧评论逐条迁移为 article 型 L1（字段/时间一致）、热度初始化、
 *              文章计数回填、旧表删除、.bak-v3 备份生成、重复执行幂等。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dataDir = path.join(__dirname, '../../data');
const dbBase = path.join(dataDir, 'test-comments-legacy.db');

/** 清理某个数据库的全部产物（主库/WAL/SHM/备份） */
function cleanupArtifacts() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbBase + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  for (const f of fs.readdirSync(dataDir)) {
    if (f.startsWith(`${path.basename(dbBase)}.bak-v3-`)) {
      fs.unlinkSync(path.join(dataDir, f));
    }
  }
}

/**
 * 构造 V2 时代库（users/admin_users 为 V2 形态），但评论仍是旧单层结构。
 * photos/articles 预置记录使 seedMockData 跳过，保证评论完全由迁移产生。
 */
function buildLegacyFixture() {
  cleanupArtifacts();
  const legacy = new Database(dbBase);
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
      custom_fields,
      wechat_openid TEXT,
      qq_openid TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      banned_at TEXT,
      can_upload INTEGER DEFAULT 1,
      can_view INTEGER DEFAULT 1,
      can_download INTEGER DEFAULT 1,
      can_like INTEGER DEFAULT 1,
      email_verified INTEGER NOT NULL DEFAULT 0
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
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE photos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      original_url TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      excerpt TEXT,
      content_path TEXT NOT NULL,
      cover_image TEXT,
      author TEXT NOT NULL,
      published_at TEXT DEFAULT CURRENT_TIMESTAMP,
      read_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      tags TEXT
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
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

  legacy.prepare("INSERT INTO photos (id, title, thumbnail_path, original_url) VALUES ('p1', ?, 't', 'o')").run('占位照片');
  const insertArticle = legacy.prepare(
    'INSERT INTO articles (id, title, content_path, author) VALUES (?, ?, ?, ?)'
  );
  insertArticle.run('a1', '文章一', 'articles/a1.md', '作者甲');
  insertArticle.run('a2', '文章二', 'articles/a2.md', '作者乙');

  const insertComment = legacy.prepare(
    'INSERT INTO comments (id, article_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  insertComment.run(
    'oldc_1', 'a1', '老评论员', '这是十五天前的评论。',
    new Date(Date.now() - 15 * 86400000).toISOString()
  );
  insertComment.run(
    'oldc_2', 'a1', '新评论员', '这是两天前的评论。',
    new Date(Date.now() - 2 * 86400000).toISOString()
  );
  insertComment.run(
    'oldc_3', 'a2', '路过的人', '这是五天前的评论。',
    new Date(Date.now() - 5 * 86400000).toISOString()
  );

  legacy.close();
}

buildLegacyFixture();

beforeAll(async () => {
  process.env.DB_PATH = dbBase;
  process.env.JWT_SECRET = 'test-jwt-secret-v3';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-v3-0123456789abcdef';
  delete process.env.COMMENT_RETAIN_DAYS;

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
});

describe('V3.0.0 旧单层评论迁移', () => {
  it('3 条旧评论全部迁移为 article 型 L1，字段逐条一致', async () => {
    const { db } = await import('../../src/db');
    const rows = (await db.all(
      'SELECT id, subject_type, subject_id, root_id, parent_id, depth, user_id, author, content, created_at FROM comments ORDER BY created_at'
    )) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.subject_type).toBe('article');
      expect(row.depth).toBe(1);
      expect(row.root_id).toBe(row.id);
      expect(row.parent_id).toBeNull();
      expect(row.user_id).toBeNull();
    }

    const c1 = rows.find((r) => r.id === 'oldc_1');
    expect(c1).toMatchObject({
      subject_id: 'a1',
      author: '老评论员',
      content: '这是十五天前的评论。',
    });
    const c3 = rows.find((r) => r.id === 'oldc_3');
    expect(c3).toMatchObject({ subject_id: 'a2', author: '路过的人' });
  });

  it('每楼初始化 comment_heat：normal 档、retain_until=发布+10天', async () => {
    const { db } = await import('../../src/db');
    const heats = (await db.all('SELECT * FROM comment_heat')) as Array<{
      root_id: string;
      tier: string;
      retain_until: string;
      pinned: number;
    }>;
    expect(heats).toHaveLength(3);

    const h1 = heats.find((h) => h.root_id === 'oldc_1')!;
    expect(h1.tier).toBe('normal');
    expect(h1.pinned).toBe(0);
    const expected = new Date(
      new Date(Date.now() - 15 * 86400000).getTime() + 10 * 86400000
    ).getTime();
    expect(Math.abs(new Date(h1.retain_until).getTime() - expected)).toBeLessThan(2000);
  });

  it('文章评论计数按新表回填（a1=2, a2=1）', async () => {
    const { db } = await import('../../src/db');
    const a1 = (await db.get('SELECT comment_count FROM articles WHERE id = ?', ['a1'])) as {
      comment_count: number;
    };
    const a2 = (await db.get('SELECT comment_count FROM articles WHERE id = ?', ['a2'])) as {
      comment_count: number;
    };
    expect(a1.comment_count).toBe(2);
    expect(a2.comment_count).toBe(1);
  });

  it('旧表 comments_legacy 已删除，.bak-v3 备份已生成', async () => {
    const { db } = await import('../../src/db');
    const legacyTable = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='comments_legacy'"
    );
    expect(legacyTable).toBeUndefined();

    const backups = fs
      .readdirSync(dataDir)
      .filter((f) => f.startsWith(`${path.basename(dbBase)}.bak-v3-`));
    expect(backups.length).toBeGreaterThan(0);
  });

  it('迁移幂等：再次 initDb 不重复迁移、数据不变', async () => {
    const dbModule = await import('../../src/db');
    await dbModule.initDb();
    const count = (await dbModule.db.get('SELECT COUNT(*) AS c FROM comments')) as { c: number };
    expect(count.c).toBe(3);
    const heatCount = (await dbModule.db.get('SELECT COUNT(*) AS c FROM comment_heat')) as {
      c: number;
    };
    expect(heatCount.c).toBe(3);
  });
});
