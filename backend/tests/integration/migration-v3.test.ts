/**
 * @file V3.0.0 评论体系全新库基线结构测试
 * @description 空数据库执行 initDb，验证 comments 通用三级结构、comment_likes/comment_heat/
 *              comment_archives 与索引、photos.comment_count 列均符合 V3 基线。
 *              旧库迁移测试见 migration-v3-legacy.test.ts（dbPath 在模块加载时固定，
 *              不同库路径必须分文件、先设置 DB_PATH 再导入模块）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(__dirname, '../../data');
const dbBase = path.join(dataDir, 'test-comments-fresh.db');

function cleanupArtifacts() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbBase + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeAll(async () => {
  cleanupArtifacts();
  process.env.DB_PATH = dbBase;
  process.env.JWT_SECRET = 'test-jwt-secret-v3';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-v3-0123456789abcdef';
  delete process.env.COMMENT_RETAIN_DAYS;

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
});

describe('V3.0.0 全新库基线结构', () => {
  it('comments 为通用三级结构，旧 article_id 列不存在', async () => {
    const { db } = await import('../../src/db');
    const cols = (await db.all('PRAGMA table_info(comments)')) as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    for (const required of [
      'id', 'subject_type', 'subject_id', 'root_id', 'parent_id', 'depth',
      'user_id', 'author', 'reply_to_user_id', 'reply_to_user_name',
      'content', 'like_count', 'created_at',
    ]) {
      expect(names).toContain(required);
    }
    expect(names).not.toContain('article_id');
  });

  it('comment_likes / comment_heat / comment_archives 与索引齐备', async () => {
    const { db } = await import('../../src/db');
    const tables = (await db.all(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )) as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('comment_likes');
    expect(tableNames).toContain('comment_heat');
    expect(tableNames).toContain('comment_archives');

    const indexes = (await db.all(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_comment%'"
    )) as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_comments_subject');
    expect(indexNames).toContain('idx_comments_root');
    expect(indexNames).toContain('idx_comments_parent');
    expect(indexNames).toContain('idx_comment_archives_subject');
  });

  it('photos 表含 comment_count 列', async () => {
    const { db } = await import('../../src/db');
    const cols = (await db.all('PRAGMA table_info(photos)')) as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'comment_count')).toBe(true);
  });
});

afterAll(async () => {
  const { db } = await import('../../src/db');
  await db.close();
  cleanupArtifacts();
});
