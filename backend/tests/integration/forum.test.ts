/** 论坛模块集成测试（V3.1.0） */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dataDir = path.join(__dirname, '../../data');
const dbBase = path.join(dataDir, 'test-forum.db');

function buildFixture() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbBase + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const f = new Database(dbBase);
  f.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT NOT NULL, username TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, email_verified INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT NOT NULL, thumbnail_path TEXT NOT NULL, original_url TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, content_path TEXT NOT NULL, author TEXT NOT NULL, published_at TEXT DEFAULT CURRENT_TIMESTAMP, comment_count INTEGER DEFAULT 0);
  `);
  f.prepare('INSERT INTO users (id,email,password_hash,username) VALUES (?,?,?,?)').run('u1','u1@e.com','h','用户甲');
  f.prepare("INSERT INTO photos (id,title,thumbnail_path,original_url) VALUES ('p1','t','t','o')").run();
  f.prepare("INSERT INTO articles (id,title,content_path,author) VALUES ('a1','t','p','a')").run();
  f.close();
}
buildFixture();

let svc: typeof import('../../src/services/commentService');
let db: any;

beforeAll(async () => {
  process.env.DB_PATH = dbBase;
  process.env.NODE_ENV = 'test';
  svc = await import('../../src/services/commentService');
  const mod = await import('../../src/db');
  await mod.initDb();
  db = mod.db;
});

const actor1 = { userId: 'u1', author: '用户甲' };

describe('论坛板块', () => {
  it('seed 默认 3 个板块', async () => {
    const boards = await db.all('SELECT id FROM forum_boards ORDER BY sort_order');
    expect(boards.length).toBe(3);
    expect(boards.map((b: any) => b.id)).toEqual(['general', 'aerial-photo', 'tech-talk']);
  });
});

describe('帖子与评论同步', () => {
  it('发帖→评论同步 reply_count→级联清理', async () => {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO forum_threads (id,board_id,title,content_md,author_id,author_name,status,is_pinned,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ['thread-1', 'general', '标题一', '正文', 'u1', '用户甲', 'published', 0, now, now]
    );
    await db.run('UPDATE forum_boards SET thread_count = thread_count + 1 WHERE id = ?', ['general']);

    const list = await db.all('SELECT title FROM forum_threads WHERE board_id = ?', ['general']);
    expect(list.length).toBe(1);

    // 发表 L1 评论，验证 reply_count 同步
    await svc.createComment(db, { subjectType: 'thread', subjectId: 'thread-1', content: 'L1' }, actor1);
    const t = await db.get('SELECT reply_count FROM forum_threads WHERE id = ?', ['thread-1']);
    expect(t.reply_count).toBe(1);

    // 级联删除
    await db.run("DELETE FROM comments WHERE subject_type='thread' AND subject_id='thread-1'");
    await db.run("DELETE FROM comment_heat WHERE root_id IN (SELECT id FROM comments WHERE subject_type='thread' AND subject_id='thread-1')");
    await db.run("DELETE FROM forum_threads WHERE id='thread-1'");
    const cnt = await db.get("SELECT COUNT(*) AS c FROM forum_threads WHERE id='thread-1'");
    expect(cnt.c).toBe(0);
  });
});
