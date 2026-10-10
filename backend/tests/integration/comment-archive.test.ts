/**
 * @file comment-archive 集成测试（V3.0.0）
 * @description 归档/回迁生命周期全链路与故障注入：
 *              TR-4.1 超期线程归档（对象内容、索引、本地清理、计数），
 *                     hot/viral/pinned 不归档
 *              TR-4.2 回迁原样恢复（id/时间戳/点赞），真实评论服务追加回复
 *              TR-4.3 上传后中断重跑、损坏负载拒绝、并发作业锁
 *              以及归档签名 URL、已归档 L1 删除。
 *              存储全部使用内存假存储 + 故障开关，不触真实 OSS。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import type { ICommentArchiveStore, ArchivedThreadPayload } from '../../src/services/commentArchiveStore';
import type { CommentRow } from '../../src/services/commentService';

const dbBase = path.join(__dirname, '../../data/test-comments-archive.db');

function buildFixture() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbBase + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const fixture = new Database(dbBase);
  fixture.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      username TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      email_verified INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE photos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      original_url TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  fixture
    .prepare('INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)')
    .run('u1', 'u1@example.com', 'h', '用户甲');
  fixture
    .prepare('INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)')
    .run('u2', 'u2@example.com', 'h', '用户乙');
  fixture
    .prepare("INSERT INTO photos (id, title, thumbnail_path, original_url) VALUES ('p1', 't', 't', 'o')")
    .run();
  fixture.close();
}

buildFixture();

let db: import('../../src/db').Database;
let commentService: typeof import('../../src/services/commentService');
let { CommentArchiveService }: {
  CommentArchiveService: typeof import('../../src/services/commentArchiveService').CommentArchiveService;
} = {} as never;

beforeAll(async () => {
  process.env.DB_PATH = dbBase;
  process.env.JWT_SECRET = 'test-jwt-secret-archive';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-archive-0123456789abcdef';
  // ossService 在模块加载时构造 S3Client；签名 URL 测试需要最小 bucket/凭证（无网络调用）
  process.env.OSS_BUCKET = 'test-bucket';
  process.env.OSS_REGION = 'oss-cn-hongkong';
  process.env.OSS_ENDPOINT = 'https://oss-cn-hongkong.aliyuncs.com';
  process.env.OSS_ACCESS_KEY_ID = 'test-access-key';
  process.env.OSS_ACCESS_KEY_SECRET = 'test-access-secret';
  delete process.env.COMMENT_RETAIN_DAYS;

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;
  commentService = await import('../../src/services/commentService');
  ({ CommentArchiveService } = await import('../../src/services/commentArchiveService'));
});

const actor1 = { userId: 'u1', author: '用户甲' };
const actor2 = { userId: 'u2', author: '用户乙' };

async function photoCount(): Promise<number> {
  const row = (await db.get('SELECT comment_count AS c FROM photos WHERE id = ?', [
    'p1',
  ])) as { c: number };
  return row.c;
}

/** 内存归档存储 + 故障注入开关 */
class MemoryStore implements ICommentArchiveStore {
  objects = new Map<string, { payload: ArchivedThreadPayload; size: number }>();
  calls: string[] = [];
  failPut = false;
  failExistsOnce = false;
  delayPutMs = 0;
  delayGetMs = 0;

  async put(rootId: string, payload: ArchivedThreadPayload) {
    if (this.delayPutMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayPutMs));
    }
    if (this.failPut) throw new Error('PUT_FAILED');
    const buffer = Buffer.from(JSON.stringify(payload), 'utf-8');
    this.objects.set(rootId, { payload, size: buffer.byteLength });
    return { size: buffer.byteLength };
  }

  async get(rootId: string) {
    this.calls.push(`get:${rootId}`);
    if (this.delayGetMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayGetMs));
    }
    return this.objects.get(rootId)?.payload ?? null;
  }

  async delete(rootId: string) {
    this.objects.delete(rootId);
  }

  async exists(rootId: string) {
    if (this.failExistsOnce) {
      this.failExistsOnce = false;
      throw new Error('SIMULATED_CRASH_AFTER_PUT');
    }
    const obj = this.objects.get(rootId);
    return obj ? { exists: true as const, size: obj.size } : { exists: false as const };
  }
}

describe('TR-4.1 归档作业', () => {
  it('超期 normal 线程：对象内容一致、索引写入、本地清零、计数扣减', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    // 构造 3 节点线程，u2 赞 L1
    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '即将超期' },
      actor1
    );
    const reply2 = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: root.id, content: 'L2' },
      actor2
    );
    await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: reply2.id, content: 'L3' },
      actor1
    );
    await commentService.setCommentLike(db, root.id, 'u2', true);

    // 归档前快照
    const beforeComments = (await db.all(
      'SELECT * FROM comments WHERE root_id = ? ORDER BY created_at ASC',
      [root.id]
    )) as CommentRow[];
    const beforeLikes = (await db.all(
      'SELECT comment_id, user_id, created_at FROM comment_likes WHERE comment_id IN (?, ?, ?)',
      beforeComments.map((c) => c.id)
    )) as Array<Record<string, unknown>>;
    const countBefore = await photoCount();

    // 置为超期 normal（显式固定 tier，模拟冷却后的到期线程）
    await db.run('UPDATE comment_heat SET tier = ?, retain_until = ? WHERE root_id = ?', [
      'normal',
      new Date(Date.now() - 86400000).toISOString(),
      root.id,
    ]);

    const result = await service.runArchiveJob(db, { store });
    expect(result.archivedRootIds).toEqual([root.id]);

    // 对象内容
    const archived = store.objects.get(root.id)!;
    expect(archived.payload.formatVersion).toBe(1);
    expect(archived.payload.subject).toEqual({ type: 'photo', id: 'p1' });
    expect(archived.payload.comments).toEqual(beforeComments);
    expect(archived.payload.likes).toHaveLength(beforeLikes.length);
    expect(archived.size).toBe(Buffer.byteLength(JSON.stringify(archived.payload), 'utf-8'));

    // 索引
    const index = (await db.get('SELECT * FROM comment_archives WHERE root_id = ?', [
      root.id,
    ])) as Record<string, unknown>;
    expect(index.oss_key).toBe(`comments-archive/${root.id}.json`);
    expect(index.reply_count).toBe(2);
    expect(index.heat_tier).toBe('normal');
    expect(index.last_reply_at).toBe(beforeComments[beforeComments.length - 1].created_at);

    // 本地清零
    expect((await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [root.id]))[0]).toEqual({ c: 0 });
    expect(await photoCount()).toBe(countBefore - 3);
  });

  it('hot/viral（未到期）与 pinned（已到期）均不归档', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    const hotRoot = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: 'hot' },
      actor1
    );
    // 默认 retain_until 即未来；再显式置 hot
    await db.run('UPDATE comment_heat SET tier = ? WHERE root_id = ?', ['hot', hotRoot.id]);

    const viralRoot = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: 'viral' },
      actor1
    );
    await db.run(
      'UPDATE comment_heat SET tier = ?, retain_until = ? WHERE root_id = ?',
      ['viral', new Date(Date.now() + 365 * 86400000).toISOString(), viralRoot.id]
    );

    const pinnedRoot = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: 'pinned' },
      actor1
    );
    await db.run(
      'UPDATE comment_heat SET pinned = 1, retain_until = ? WHERE root_id = ?',
      [new Date(Date.now() - 86400000).toISOString(), pinnedRoot.id]
    );

    const result = await service.runArchiveJob(db, { store });
    expect(result.scanned).toBe(0);
    expect(store.objects.size).toBe(0); // 本 store 内无任何归档写入
    for (const id of [hotRoot.id, viralRoot.id, pinnedRoot.id]) {
      const rows = (await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [id]))[0] as { c: number };
      expect(rows.c).toBe(1);
    }
  });
});

describe('TR-4.2 回迁', () => {
  it('原样恢复评论/点赞/计数，索引标记 rehydrated；真实评论服务可追加回复', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    // 本测试自包含：构造 3 节点线程 + 1 赞 → 归档 → 回迁
    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '回迁楼L1' },
      actor1
    );
    const reply2 = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: root.id, content: '回迁楼L2' },
      actor2
    );
    await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: reply2.id, content: '回迁楼L3' },
      actor1
    );
    await commentService.setCommentLike(db, root.id, 'u2', true);

    const snapshotComments = (await db.all(
      'SELECT * FROM comments WHERE root_id = ? ORDER BY created_at ASC',
      [root.id]
    )) as CommentRow[];

    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);
    await service.runArchiveJob(db, { store });

    // 回迁
    const countAfterArchive = await photoCount();
    await service.rehydrateThread(db, root.id, { store });

    const restored = (await db.all(
      'SELECT * FROM comments WHERE root_id = ? ORDER BY created_at ASC',
      [root.id]
    )) as CommentRow[];
    expect(restored).toEqual(snapshotComments);
    expect(await photoCount()).toBe(countAfterArchive + snapshotComments.length);

    const heat = (await db.get('SELECT * FROM comment_heat WHERE root_id = ?', [
      root.id,
    ])) as Record<string, unknown>;
    expect(heat).not.toBeUndefined();

    const index = (await db.get(
      'SELECT rehydrated_at AS r FROM comment_archives WHERE root_id = ?',
      [root.id]
    )) as { r: string | null };
    expect(index.r).not.toBeNull();

    // 经真实评论服务追加回复（网关接归档服务）
    const rehydrateGateway = {
      rehydrateThread: async (id: string) => service.rehydrateThread(db, id, { store }),
    };
    const appended = await commentService.createComment(
      db,
      {
        subjectType: 'photo',
        subjectId: 'p1',
        parentId: restored[restored.length - 1].id,
        rootId: root.id,
        content: '回迁后的新回复',
      },
      actor2,
      { rehydrateGateway }
    );
    expect(appended.root_id).toBe(root.id);
    const finalRows = (await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [
      root.id,
    ]))[0] as { c: number };
    expect(finalRows.c).toBe(snapshotComments.length + 1);
  });

  it('回迁幂等：线程已在本地时再次调用不报错、不重复', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();
    const [archived] = (await db.all(
      'SELECT root_id FROM comment_archives WHERE rehydrated_at IS NOT NULL LIMIT 1'
    )) as Array<{ root_id: string }>;
    const before = (await db.all(
      'SELECT COUNT(*) AS c FROM comments WHERE root_id = ?',
      [archived.root_id]
    ))[0] as { c: number };
    await service.rehydrateThread(db, archived.root_id, { store });
    const after = (await db.all(
      'SELECT COUNT(*) AS c FROM comments WHERE root_id = ?',
      [archived.root_id]
    ))[0] as { c: number };
    expect(after.c).toBe(before.c);
  });
});

describe('TR-4.3 故障恢复与并发', () => {
  it('上传成功后校验阶段崩溃：本地保留，重跑归档成功，三跑无副作用', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '中断恢复' },
      actor1
    );
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);
    const countBefore = await photoCount();

    store.failExistsOnce = true;
    await expect(service.runArchiveJob(db, { store })).rejects.toThrow('SIMULATED_CRASH_AFTER_PUT');
    // 对象已写、本地完好
    expect(store.objects.has(root.id)).toBe(true);
    expect((await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [root.id]))[0]).toEqual({ c: 1 });
    expect(service.isLocked()).toBe(false);

    // 重跑成功
    const rerun = await service.runArchiveJob(db, { store });
    expect(rerun.archivedRootIds).toEqual([root.id]);
    expect((await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [root.id]))[0]).toEqual({ c: 0 });
    expect(await photoCount()).toBe(countBefore - 1);

    // 三跑：无超期线程
    const third = await service.runArchiveJob(db, { store });
    expect(third.scanned).toBe(0);
  });

  it('上传失败：本地无任何变更、锁已释放', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();
    store.failPut = true;

    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '上传失败楼' },
      actor1
    );
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);

    await expect(service.runArchiveJob(db, { store })).rejects.toThrow('PUT_FAILED');
    expect(store.objects.has(root.id)).toBe(false);
    expect((await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [root.id]))[0]).toEqual({ c: 1 });
    expect(service.isLocked()).toBe(false);
  });

  it('损坏/篡改负载回迁被拒（ARCHIVE_PAYLOAD_INVALID），本地无写入', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    // 建线程、归档
    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '待篡改' },
      actor1
    );
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);
    await service.runArchiveJob(db, { store });

    // 篡改：主题改成 article
    const obj = store.objects.get(root.id)!;
    obj.payload.subject = { type: 'article', id: 'p1' };
    store.objects.set(root.id, obj);

    await expect(service.rehydrateThread(db, root.id, { store })).rejects.toMatchObject({
      code: 'ARCHIVE_PAYLOAD_INVALID',
    });
    expect((await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [root.id]))[0]).toEqual({ c: 0 });
  });

  it('并发归档：第二个作业被 ARCHIVE_JOB_LOCKED 拒绝', async () => {
    const service = new CommentArchiveService();
    const storeA = new MemoryStore();
    const storeB = new MemoryStore();
    storeA.delayPutMs = 150;
    storeB.delayPutMs = 150;

    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '并发锁' },
      actor1
    );
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);

    const results = await Promise.allSettled([
      service.runArchiveJob(db, { store: storeA }),
      service.runArchiveJob(db, { store: storeB }),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'ARCHIVE_JOB_LOCKED',
    });
    // 首个作业完成
    expect(storeA.objects.has(root.id) || storeB.objects.has(root.id)).toBe(true);
    expect(service.isLocked()).toBe(false);
  });

  it('并发回迁：第二个回迁被 ARCHIVE_JOB_LOCKED 拒绝且计数不重复', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();
    store.delayGetMs = 150;

    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '并发回迁' },
      actor1
    );
    const countBefore = await photoCount();
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);
    await service.runArchiveJob(db, { store });

    const results = await Promise.allSettled([
      service.rehydrateThread(db, root.id, { store }),
      service.rehydrateThread(db, root.id, { store }),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'ARCHIVE_JOB_LOCKED',
    });
    // 归档扣 1、回迁补 1：净值不变即计数未翻倍，评论只有一份
    expect(await photoCount()).toBe(countBefore);
    const rows = (await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [
      root.id,
    ]))[0] as { c: number };
    expect(rows.c).toBe(1);
    expect(service.isLocked()).toBe(false);
  });
});

describe('归档签名 URL 与已归档删除', () => {
  it('getArchiveReadUrl：存在返回 URL，不存在返回 null', async () => {
    const service = new CommentArchiveService();
    const [archived] = (await db.all(
      'SELECT root_id FROM comment_archives LIMIT 1'
    )) as Array<{ root_id: string }>;
    const result = await service.getArchiveReadUrl(db, archived.root_id);
    expect(result).not.toBeNull();
    expect(result!.url.startsWith('http')).toBe(true);

    expect(await service.getArchiveReadUrl(db, 'missing-root')).toBeNull();
  });

  it('已归档 L1 删除：经网关删云对象并清索引', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    // 造线程并归档到该 store
    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '归档后删除' },
      actor1
    );
    await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: root.id, content: 'L2' },
      actor2
    );
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);
    await service.runArchiveJob(db, { store });
    expect(store.objects.has(root.id)).toBe(true);

    const gateway = {
      deleteArchivedObject: async (id: string) => {
        await store.delete(id);
      },
      readArchivedThreadOwner: async (id: string) => {
        const payload = await store.get(id);
        if (!payload) return null;
        const r = payload.comments.find((c) => c.depth === 1);
        return { rootUserId: r ? r.user_id : null };
      },
    };
    const result = await commentService.deleteComment(
      db,
      root.id,
      { userId: 'u1', isAdmin: false },
      { archiveGateway: gateway }
    );
    expect(result.deletedThread).toBe(true);
    expect(result.removedCount).toBe(2);
    expect(store.objects.has(root.id)).toBe(false);
    const index = await db.get('SELECT root_id FROM comment_archives WHERE root_id = ?', [root.id]);
    expect(index).toBeUndefined();
  });

  it('非楼主删他人归档楼：403 COMMENT_DELETE_FORBIDDEN，云对象与索引保留', async () => {
    const service = new CommentArchiveService();
    const store = new MemoryStore();

    const root = await commentService.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '他人归档楼' },
      actor1
    );
    await db.run('UPDATE comment_heat SET retain_until = ? WHERE root_id = ?', [
      new Date(Date.now() - 3600000).toISOString(),
      root.id,
    ]);
    await service.runArchiveJob(db, { store });
    const countBefore = await photoCount();

    const gateway = {
      deleteArchivedObject: async (id: string) => {
        await store.delete(id);
      },
      readArchivedThreadOwner: async (id: string) => {
        const payload = await store.get(id);
        if (!payload) return null;
        const r = payload.comments.find((c) => c.depth === 1);
        return { rootUserId: r ? r.user_id : null };
      },
    };
    await expect(
      commentService.deleteComment(
        db,
        root.id,
        { userId: 'u2', isAdmin: false },
        { archiveGateway: gateway }
      )
    ).rejects.toMatchObject({ code: 'COMMENT_DELETE_FORBIDDEN' });
    expect(store.objects.has(root.id)).toBe(true);
    const index = await db.get('SELECT root_id FROM comment_archives WHERE root_id = ?', [root.id]);
    expect(index).not.toBeUndefined();
    expect(await photoCount()).toBe(countBefore);
  });
});
