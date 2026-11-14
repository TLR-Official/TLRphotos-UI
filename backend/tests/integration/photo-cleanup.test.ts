/**
 * @file 未审核照片自动清理作业测试（V4.12.0，PRD 7.3 / A12）
 * @description
 *  覆盖「待审核超过 30 天自动清理」规则：
 *  1. 满 30 天的 pending 照片连同原图/缩略图/预览图/水印图/详情图与关联记录一并删除；
 *  2. 未满 30 天的 pending 与已过审的老照片不受影响；
 *  3. `PHOTO_CLEANUP_ENABLED=off` 时作业跳过且不触碰 OSS。
 *  DB 使用内存库，OSS 删除使用 mock，不触达生产库与真实对象存储。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import type { Database } from 'sqlite';
import { cleanupUnreviewedPhotos } from '../../src/services/photoCleanupService';

const { deleteFromOSS } = vi.hoisted(() => ({
  deleteFromOSS: vi.fn(async (_key: string) => {}),
}));

vi.mock('../../src/services/ossService', () => ({ deleteFromOSS }));

const DAY_MS = 24 * 60 * 60 * 1000;

let db: Database;

/** 建一张仅含清理作业所需列的照片表及关联记录表 */
async function initSchema(database: Database): Promise<void> {
  await database.exec(`
    CREATE TABLE photos (
      id TEXT PRIMARY KEY,
      title TEXT,
      thumbnail_path TEXT,
      original_url TEXT,
      preview_url TEXT,
      watermarked_url TEXT,
      detail_key TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE photo_likes (photo_id TEXT, user_id TEXT);
    CREATE TABLE photo_views (photo_id TEXT, viewer_key TEXT);
    CREATE TABLE comments (id TEXT, subject_type TEXT, subject_id TEXT);
    CREATE TABLE photo_tasks (id TEXT, photo_id TEXT, status TEXT);
  `);
}

/** 插入一张指定状态与上传时间的照片，返回其 OSS 对象 Key 列表 */
async function insertPhoto(id: string, status: string, daysAgo: number): Promise<string[]> {
  const keys = [
    `photos/originals/${id}.jpg`,
    `photos/thumbnails/${id}.webp`,
    `photos/previews/${id}.webp`,
    `photos/watermarked/${id}.webp`,
    `photos/detail/${id}.webp`,
  ];
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  await db.run(
    `INSERT INTO photos (id, title, thumbnail_path, original_url, preview_url, watermarked_url, detail_key, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    `作品 ${id}`,
    keys[1],
    keys[0],
    keys[2],
    keys[3],
    keys[4],
    status,
    createdAt,
  );
  return keys;
}

beforeEach(async () => {
  deleteFromOSS.mockClear();
  db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await initSchema(db);
});

afterEach(async () => {
  await db.close();
  delete process.env.PHOTO_CLEANUP_ENABLED;
});

describe('未审核照片自动清理（PRD 7.3）', () => {
  it('待审核满 30 天：删除照片、派生图对象与关联记录', async () => {
    const keys = await insertPhoto('old-pending', 'pending', 31);
    await db.run("INSERT INTO photo_likes (photo_id, user_id) VALUES ('old-pending', 'u1')");
    await db.run("INSERT INTO photo_views (photo_id, viewer_key) VALUES ('old-pending', 'ip:127.0.0.1')");
    await db.run("INSERT INTO comments (id, subject_type, subject_id) VALUES ('c1', 'photo', 'old-pending')");
    await db.run("INSERT INTO photo_tasks (id, photo_id, status) VALUES ('t1', 'old-pending', 'done')");

    const result = await cleanupUnreviewedPhotos(db);

    expect(result).toEqual({ photos: 1, objects: 5 });
    expect((await db.get('SELECT COUNT(*) AS c FROM photos'))?.c).toBe(0);
    expect((await db.get('SELECT COUNT(*) AS c FROM photo_likes'))?.c).toBe(0);
    expect((await db.get('SELECT COUNT(*) AS c FROM photo_views'))?.c).toBe(0);
    expect((await db.get('SELECT COUNT(*) AS c FROM comments'))?.c).toBe(0);
    expect((await db.get('SELECT COUNT(*) AS c FROM photo_tasks'))?.c).toBe(0);
    expect(deleteFromOSS.mock.calls.map((call) => call[0]).sort()).toEqual([...keys].sort());
  });

  it('未满 30 天的待审照片与已过审老照片均保留', async () => {
    await insertPhoto('recent-pending', 'pending', 29);
    await insertPhoto('old-approved', 'approved', 60);

    const result = await cleanupUnreviewedPhotos(db);

    expect(result).toEqual({ photos: 0, objects: 0 });
    expect((await db.get('SELECT COUNT(*) AS c FROM photos'))?.c).toBe(2);
    expect(deleteFromOSS).not.toHaveBeenCalled();
  });

  it('PHOTO_CLEANUP_ENABLED=off 时跳过清理', async () => {
    process.env.PHOTO_CLEANUP_ENABLED = 'off';
    await insertPhoto('old-pending', 'pending', 31);

    const result = await cleanupUnreviewedPhotos(db);

    expect(result).toEqual({ photos: 0, objects: 0 });
    expect((await db.get('SELECT COUNT(*) AS c FROM photos'))?.c).toBe(1);
    expect(deleteFromOSS).not.toHaveBeenCalled();
  });
});
