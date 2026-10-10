/**
 * @file comments 集成测试（V3.0.0）
 * @description 评论领域服务全链路：
 *              TR-3.1 三级封顶（连续 5 次再回复 depth≤3、root/parent/reply_to 正确、
 *                     跨主题/不存在 parent/非法内容/不存在主题拒绝）
 *              TR-3.2 L1 分页、最新/最热排序、单楼 100 条截断与二次加载
 *              TR-3.3 点赞/重复/取消计数与热度联动
 *              TR-3.4 非作者拒绝、本人单条/整楼删除、管理员删除旧迁移评论、
 *                     归档楼删除联动云对象、归档楼回复回迁网关
 *              测试库经 DB_PATH 隔离；归档云操作以注入的假网关验证，不触真实 OSS。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dataDir = path.join(__dirname, '../../data');
const dbBase = path.join(dataDir, 'test-comments-domain.db');

/** 构造最小存量库（users 已是 V2 形态），使 seedMockData 跳过 */
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
    CREATE TABLE articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content_path TEXT NOT NULL,
      author TEXT NOT NULL,
      published_at TEXT DEFAULT CURRENT_TIMESTAMP,
      comment_count INTEGER DEFAULT 0
    );
  `);
  const insUser = fixture.prepare(
    'INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)'
  );
  insUser.run('u1', 'u1@example.com', 'h', '用户甲');
  insUser.run('u2', 'u2@example.com', 'h', '用户乙');
  insUser.run('u3', 'u3@example.com', 'h', '用户丙');
  fixture
    .prepare("INSERT INTO photos (id, title, thumbnail_path, original_url) VALUES ('p1', ?, 't', 'o')")
    .run('测试照片');
  fixture
    .prepare("INSERT INTO articles (id, title, content_path, author) VALUES ('a1', ?, 'p', '作者')")
    .run('测试文章');
  fixture.close();
}

buildFixture();

let svc: typeof import('../../src/services/commentService');
let db: import('../../src/db').Database;

beforeAll(async () => {
  process.env.DB_PATH = dbBase;
  process.env.JWT_SECRET = 'test-jwt-secret-comments';
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-comments-0123456789abcdef';
  delete process.env.COMMENT_RETAIN_DAYS;

  const dbModule = await import('../../src/db');
  await dbModule.initDb();
  db = dbModule.db;
  svc = await import('../../src/services/commentService');
});

const actor1 = { userId: 'u1', author: '用户甲' };
const actor2 = { userId: 'u2', author: '用户乙' };
const actor3 = { userId: 'u3', author: '用户丙' };

async function photoCount(): Promise<number> {
  const row = (await db.get('SELECT comment_count AS c FROM photos WHERE id = ?', [
    'p1',
  ])) as { c: number };
  return row.c;
}
async function articleCount(): Promise<number> {
  const row = (await db.get('SELECT comment_count AS c FROM articles WHERE id = ?', [
    'a1',
  ])) as { c: number };
  return row.c;
}

describe('TR-3.1 三级深度封顶', () => {
  const chain: string[] = [];

  it('L1→L2→L3 后连续再回复 5 次，所有节点 depth≤3 且 reply_to 指向上一节点作者', async () => {
    const c1 = await svc.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: 'L1 主评论' },
      actor1
    );
    chain.push(c1.id);

    const c2 = await svc.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: c1.id, content: 'L2 回复' },
      actor2
    );
    chain.push(c2.id);
    expect(c2.depth).toBe(2);
    expect(c2.reply_to_user_name).toBeNull();

    const c3 = await svc.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: c2.id, content: 'L3 回复' },
      actor3
    );
    chain.push(c3.id);
    expect(c3.depth).toBe(3);
    expect(c3.reply_to_user_id).toBe('u2');
    expect(c3.reply_to_user_name).toBe('用户乙');

    // 连续 5 次对最新节点再回复：depth 始终 3，reply_to 指向被回复者
    const actors = [actor1, actor2, actor1, actor2, actor1];
    const expectedAuthors = ['用户丙', '用户甲', '用户乙', '用户甲', '用户乙'];
    let parentId = c3.id;
    for (let i = 0; i < 5; i++) {
      const next = await svc.createComment(
        db,
        { subjectType: 'photo', subjectId: 'p1', parentId, content: `平铺再回复 ${i}` },
        actors[i]
      );
      chain.push(next.id);
      expect(next.depth).toBe(3);
      expect(next.root_id).toBe(c1.id);
      expect(next.parent_id).toBe(parentId);
      expect(next.reply_to_user_name).toBe(expectedAuthors[i]);
      parentId = next.id;
    }

    // 全库不存在 depth>3
    const over = (await db.get('SELECT COUNT(*) AS c FROM comments WHERE depth > 3')) as {
      c: number;
    };
    expect(over.c).toBe(0);
    expect(await photoCount()).toBe(8);
  });

  it('跨主题 parent 拒绝（PARENT_SUBJECT_MISMATCH）', async () => {
    await expect(
      svc.createComment(
        db,
        { subjectType: 'article', subjectId: 'a1', parentId: chain[1], content: '跨主题' },
        actor1
      )
    ).rejects.toMatchObject({ code: 'PARENT_SUBJECT_MISMATCH' });
  });

  it('不存在 parent 拒绝（PARENT_NOT_FOUND）', async () => {
    await expect(
      svc.createComment(
        db,
        { subjectType: 'photo', subjectId: 'p1', parentId: 'no-such-id', content: 'x' },
        actor1
      )
    ).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' });
  });

  it('空内容/超 1000 字拒绝', async () => {
    await expect(
      svc.createComment(
        db,
        { subjectType: 'photo', subjectId: 'p1', content: '   ' },
        actor1
      )
    ).rejects.toMatchObject({ code: 'COMMENT_CONTENT_EMPTY' });

    await expect(
      svc.createComment(
        db,
        { subjectType: 'photo', subjectId: 'p1', content: '字'.repeat(1001) },
        actor1
      )
    ).rejects.toMatchObject({ code: 'COMMENT_CONTENT_TOO_LONG' });
  });

  it('不存在主题拒绝（SUBJECT_NOT_FOUND）', async () => {
    await expect(
      svc.createComment(
        db,
        { subjectType: 'photo', subjectId: 'ghost', content: 'x' },
        actor1
      )
    ).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
  });
});

describe('TR-3.2 分页/排序/回复截断', () => {
  it('25 条 L1：第 1 页 20 条、第 2 页 5 条，total/totalPages 正确', async () => {
    for (let i = 0; i < 25; i++) {
      await svc.createComment(
        db,
        { subjectType: 'article', subjectId: 'a1', content: `文章主评论 ${i}` },
        actor1
      );
    }
    const p1List = await svc.listRootComments(
      db,
      { subjectType: 'article', subjectId: 'a1', page: 1, pageSize: 20, sort: 'latest' },
      'u1'
    );
    expect(p1List.items).toHaveLength(20);
    expect(p1List.total).toBe(25);
    expect(p1List.totalPages).toBe(2);
    const p2List = await svc.listRootComments(
      db,
      { subjectType: 'article', subjectId: 'a1', page: 2, pageSize: 20 },
      'u1'
    );
    expect(p2List.items).toHaveLength(5);
    // 最新排序：第 1 页首条为最新
    expect(p1List.items[0].content).toBe('文章主评论 24');
  });

  it('最热排序：被点赞的旧线程排在无热度新线程之前', async () => {
    const threadX = await svc.createComment(
      db,
      { subjectType: 'article', subjectId: 'a1', content: 'X 较早' },
      actor1
    );
    const threadY = await svc.createComment(
      db,
      { subjectType: 'article', subjectId: 'a1', content: 'Y 较新' },
      actor1
    );
    await svc.setCommentLike(db, threadX.id, 'u2', true);

    const hot = await svc.listRootComments(
      db,
      { subjectType: 'article', subjectId: 'a1', sort: 'hottest' },
      null
    );
    const ix = hot.items.findIndex((i) => i.id === threadX.id);
    const iy = hot.items.findIndex((i) => i.id === threadY.id);
    expect(ix).toBeLessThan(iy);
  });

  it('单楼 101 条回复：随 L1 携带 100 条、has_more_replies=true，二次加载取剩余 1 条', async () => {
    const capRoot = await svc.createComment(
      db,
      { subjectType: 'article', subjectId: 'a1', content: '截断测试楼' },
      actor1
    );
    // 批量直接构造 101 条 L2（避免百次热度重算拖慢测试）
    const baseTs = Date.now();
    for (let i = 1; i <= 101; i++) {
      await db.run(
        `INSERT INTO comments
           (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
            content, like_count, created_at)
         VALUES (?, 'article', 'a1', ?, ?, 2, 'u1', '用户甲', 'r', 0, ?)`,
        [
          `capr_${i}`,
          capRoot.id,
          capRoot.id,
          new Date(baseTs - (102 - i) * 60000).toISOString(),
        ]
      );
    }
    await db.run('UPDATE articles SET comment_count = comment_count + 101 WHERE id = ?', ['a1']);

    const list = await svc.listRootComments(
      db,
      { subjectType: 'article', subjectId: 'a1', sort: 'latest' },
      null
    );
    const root = list.items.find((i) => i.id === capRoot.id)!;
    expect(root.replies).toHaveLength(100);
    expect(root.has_more_replies).toBe(true);
    expect(root.total_reply_count).toBe(101);

    const more = await svc.listThreadReplies(db, capRoot.id, { offset: 100, limit: 100 }, null);
    expect(more.items).toHaveLength(1);
    expect(more.total).toBe(101);
    expect(more.items[0].id).toBe('capr_101');
  });
});

describe('TR-3.3 评论点赞', () => {
  it('点赞→重复点赞→取消→重复取消：计数正确、不出现负数', async () => {
    // 复用三级链条首条 L1
    const list = await svc.listRootComments(
      db,
      { subjectType: 'photo', subjectId: 'p1', sort: 'latest' },
      null
    );
    // p1 下只有一个线程
    const target = list.items[0];

    const liked = await svc.setCommentLike(db, target.id, 'u3', true);
    expect(liked.likeCount).toBe(1);
    expect(liked.isLiked).toBe(true);

    const again = await svc.setCommentLike(db, target.id, 'u3', true);
    expect(again.likeCount).toBe(1);

    const undone = await svc.setCommentLike(db, target.id, 'u3', false);
    expect(undone.likeCount).toBe(0);
    const twice = await svc.setCommentLike(db, target.id, 'u3', false);
    expect(twice.likeCount).toBe(0);
  });

  it('点赞触发该楼热度重算（heat 行存在且信号含点赞）', async () => {
    const list = await svc.listRootComments(
      db,
      { subjectType: 'photo', subjectId: 'p1' },
      null
    );
    const rootId = list.items[0].id;
    await svc.setCommentLike(db, rootId, 'u2', true);
    const heat = (await db.get('SELECT * FROM comment_heat WHERE root_id = ?', [
      rootId,
    ])) as Record<string, unknown>;
    expect(heat.like_count).toBeGreaterThanOrEqual(1);
    expect(heat.last_calc_at).not.toBeNull();
  });
});

describe('TR-3.4 删除权限与整楼处理', () => {
  it('非作者删除被拒（COMMENT_DELETE_FORBIDDEN）', async () => {
    const list = await svc.listRootComments(
      db,
      { subjectType: 'photo', subjectId: 'p1' },
      null
    );
    await expect(
      svc.deleteComment(db, list.items[0].id, { userId: 'u2', isAdmin: false })
    ).rejects.toMatchObject({ code: 'COMMENT_DELETE_FORBIDDEN' });
  });

  it('本人删除 L3 单条：仅删该条、计数 -1，其余节点保留', async () => {
    const before = await photoCount();
    const list = await svc.listRootComments(
      db,
      { subjectType: 'photo', subjectId: 'p1', sort: 'latest' },
      null
    );
    const thread = list.items[0];
    // 末条平铺节点由 u1 发布（链条构造时最后一棒是 actor1）
    const lastReply = thread.replies[thread.replies.length - 1];
    const result = await svc.deleteComment(db, lastReply.id, { userId: 'u1', isAdmin: false });
    expect(result).toEqual({ deletedThread: false, removedCount: 1 });
    const exists = await db.get('SELECT id FROM comments WHERE id = ?', [lastReply.id]);
    expect(exists).toBeUndefined();
    expect(await photoCount()).toBe(before - 1);
  });

  it('本人删除 L1：整楼清除、heat 行删除、计数减去整楼条数', async () => {
    const t1 = await svc.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '待删整楼' },
      actor1
    );
    await svc.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', parentId: t1.id, content: '楼中回复' },
      actor1
    );
    const before = await photoCount();

    const result = await svc.deleteComment(db, t1.id, { userId: 'u1', isAdmin: false });
    expect(result.deletedThread).toBe(true);
    expect(result.removedCount).toBe(2);
    const rows = await db.all('SELECT COUNT(*) AS c FROM comments WHERE root_id = ?', [t1.id]);
    expect((rows[0] as { c: number }).c).toBe(0);
    const heat = await db.get('SELECT root_id FROM comment_heat WHERE root_id = ?', [t1.id]);
    expect(heat).toBeUndefined();
    expect(await photoCount()).toBe(before - 2);
  });

  it('旧迁移评论（user_id 为空）：普通用户拒删，管理员可删', async () => {
    const before = await articleCount();
    await db.run(
      `INSERT INTO comments
         (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
          content, like_count, created_at)
       VALUES ('leg1', 'article', 'a1', 'leg1', NULL, 1, NULL, '老作者', '旧评论', 0, ?)`,
      [new Date().toISOString()]
    );
    await db.run("INSERT INTO comment_heat (root_id, retain_until) VALUES ('leg1', ?)", [
      new Date(Date.now() + 86400000).toISOString(),
    ]);
    await db.run('UPDATE articles SET comment_count = comment_count + 1 WHERE id = ?', ['a1']);

    await expect(
      svc.deleteComment(db, 'leg1', { userId: 'u1', isAdmin: false })
    ).rejects.toMatchObject({ code: 'COMMENT_DELETE_FORBIDDEN' });

    await svc.deleteComment(db, 'leg1', { userId: 'admin-1', isAdmin: true });
    expect(await articleCount()).toBe(before);
  });

  it('归档楼删除：先调云对象删除网关，成功后清索引与本地行；网关失败则数据保留', async () => {
    // z1：本地行 + 归档索引
    await db.run(
      `INSERT INTO comments
         (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
          content, like_count, created_at)
       VALUES ('z1', 'photo', 'p1', 'z1', NULL, 1, 'u1', '用户甲', '归档L1', 0, ?)`,
      [new Date().toISOString()]
    );
    await db.run(
      `INSERT INTO comments
         (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
          content, like_count, created_at)
       VALUES ('z1r1', 'photo', 'p1', 'z1', 'z1', 2, 'u1', '用户甲', '归档L2', 0, ?)`,
      [new Date().toISOString()]
    );
    await db.run(
      `INSERT INTO comment_archives
         (root_id, subject_type, subject_id, oss_key, archived_at, root_created_at,
          reply_count, heat_tier, last_reply_at)
       VALUES ('z1', 'photo', 'p1', 'comments-archive/z1.json', ?, ?, 1, 'normal', ?)`,
      [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
    );
    const before = await photoCount();

    const calls: string[] = [];
    const okGateway = {
      deleteArchivedObject: async (rootId: string) => {
        calls.push(rootId);
      },
    };
    const result = await svc.deleteComment(
      db,
      'z1',
      { userId: 'u1', isAdmin: false },
      { archiveGateway: okGateway }
    );
    expect(result.removedCount).toBe(2);
    expect(calls).toEqual(['z1']);
    const index = await db.get('SELECT root_id FROM comment_archives WHERE root_id = ?', ['z1']);
    expect(index).toBeUndefined();
    expect(await photoCount()).toBe(before - 2);

    // z2：网关抛错 → 拒绝，本地行与索引保留
    await db.run(
      `INSERT INTO comments (id, subject_type, subject_id, root_id, parent_id, depth, user_id,
        author, content, like_count, created_at)
       VALUES ('z2', 'photo', 'p1', 'z2', NULL, 1, 'u1', '用户甲', 'z2', 0, ?)`,
      [new Date().toISOString()]
    );
    await db.run(
      `INSERT INTO comment_archives
         (root_id, subject_type, subject_id, oss_key, archived_at, root_created_at,
          reply_count, heat_tier, last_reply_at)
       VALUES ('z2', 'photo', 'p1', 'k', ?, ?, 0, 'normal', ?)`,
      [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
    );
    const failGateway = {
      deleteArchivedObject: async () => {
        throw new Error('OSS_DOWN');
      },
    };
    await expect(
      svc.deleteComment(db, 'z2', { userId: 'u1', isAdmin: false }, { archiveGateway: failGateway })
    ).rejects.toThrow('OSS_DOWN');
    const stillThere = await db.get('SELECT id FROM comments WHERE id = ?', ['z2']);
    expect(stillThere).not.toBeUndefined();
    const indexStill = await db.get(
      'SELECT root_id FROM comment_archives WHERE root_id = ?',
      ['z2']
    );
    expect(indexStill).not.toBeUndefined();
  });
});

describe('归档线程回复回迁（FR-10）', () => {
  it('对归档线程发表回复：先回迁再追加，网关仅调用一次；再回复不再触发回迁', async () => {
    // 仅有归档索引，无本地评论行
    await db.run(
      `INSERT INTO comment_archives
         (root_id, subject_type, subject_id, oss_key, archived_at, root_created_at,
          reply_count, heat_tier, last_reply_at)
       VALUES ('q1', 'article', 'a1', 'comments-archive/q1.json', ?, ?, 1, 'normal', ?)`,
      [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
    );
    const countBefore = await articleCount();

    const rehydrateCalls: string[] = [];
    const rehydrateGateway = {
      rehydrateThread: async (rootId: string) => {
        rehydrateCalls.push(rootId);
        // 模拟回迁：原样写回 L1 + L2，标记 rehydrated_at
        await db.run(
          `INSERT INTO comments
             (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
              content, like_count, created_at)
           VALUES ('q1', 'article', 'a1', 'q1', NULL, 1, 'u1', '用户甲', '楼主', 0, ?)`,
          [new Date(Date.now() - 3 * 86400000).toISOString()]
        );
        await db.run(
          `INSERT INTO comments
             (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
              content, like_count, created_at)
           VALUES ('q1r1', 'article', 'a1', 'q1', 'q1', 2, 'u2', '用户乙', '楼中回复', 0, ?)`,
          [new Date(Date.now() - 2 * 86400000).toISOString()]
        );
        await db.run('UPDATE comment_archives SET rehydrated_at = ? WHERE root_id = ?', [
          new Date().toISOString(),
          rootId,
        ]);
      },
    };

    const newReply = await svc.createComment(
      db,
      {
        subjectType: 'article',
        subjectId: 'a1',
        parentId: 'q1r1',
        rootId: 'q1',
        content: '回迁后的新回复',
      },
      actor3,
      { rehydrateGateway }
    );
    expect(rehydrateCalls).toEqual(['q1']);
    expect(newReply.depth).toBe(3);
    expect(newReply.reply_to_user_name).toBe('用户乙');

    const localRows = (await db.all(
      'SELECT id FROM comments WHERE root_id = ? ORDER BY created_at',
      ['q1']
    )) as Array<{ id: string }>;
    expect(localRows.map((r) => r.id)).toEqual(['q1', 'q1r1', newReply.id]);
    // 仅新回复计入主题计数增量（回迁行计数由真实回迁服务恢复）
    expect(await articleCount()).toBe(countBefore + 1);
    const index = (await db.get(
      'SELECT rehydrated_at AS r FROM comment_archives WHERE root_id = ?',
      ['q1']
    )) as { r: string };
    expect(index.r).not.toBeNull();

    // 再次回复：父评论已在本地，回迁网关不应再被调用（抛错网关证明零调用）
    const throwingGateway = {
      rehydrateThread: async () => {
        throw new Error('SHOULD_NOT_BE_CALLED');
      },
    };
    const another = await svc.createComment(
      db,
      {
        subjectType: 'article',
        subjectId: 'a1',
        parentId: newReply.id,
        rootId: 'q1',
        content: '活跃线程再回复',
      },
      actor1,
      { rehydrateGateway: throwingGateway }
    );
    expect(another.depth).toBe(3);
  });
});

describe('查看者点赞态（is_liked）', () => {
  it('列表仅标记当前用户已赞的评论', async () => {
    // 新建独立线程，u2 赞 L1
    const t = await svc.createComment(
      db,
      { subjectType: 'photo', subjectId: 'p1', content: '点赞态线程' },
      actor1
    );
    await svc.setCommentLike(db, t.id, 'u2', true);

    const asU2 = await svc.listRootComments(
      db,
      { subjectType: 'photo', subjectId: 'p1' },
      'u2'
    );
    const item = asU2.items.find((i) => i.id === t.id)!;
    expect(item.is_liked).toBe(true);

    const asU3 = await svc.listRootComments(
      db,
      { subjectType: 'photo', subjectId: 'p1' },
      'u3'
    );
    const item3 = asU3.items.find((i) => i.id === t.id)!;
    expect(item3.is_liked).toBe(false);
  });
});
