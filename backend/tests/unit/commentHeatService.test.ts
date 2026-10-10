/**
 * @file commentHeatService 单元测试（V3.0.0）
 * @description 覆盖启发式热度服务的纯计算与 DB 辅助逻辑：
 *              1. 三组确定性信号 → normal/hot/viral 档位（TR-2.1）
 *              2. retain_until 精确计算：normal/viral 锚定发布时间、hot 滚动 +7 天（TR-2.1）
 *              3. pinned 线程不归档，边界时间判定（TR-2.1）
 *              4. 同输入重算结果稳定（纯函数）（TR-2.2）
 *              5. env 覆盖阈值后档位相应变化、非法配置回退（TR-2.2）
 *              6. DB 聚合重算、upsert 保留 pinned、pin/unpin、错误码
 *              DB 用例使用独立临时库（sqlite 直开），不触达生产库与真实 OSS。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import type { Database } from 'sqlite';
import {
  computeHeat,
  shouldArchive,
  heatConfigFromEnv,
  recalculateThreadHeat,
  setThreadPinned,
  DEFAULT_HEAT_CONFIG,
  type HeatSignals,
} from '../../src/services/commentHeatService';

const DAY = 86400000;
const NOW = new Date('2026-10-10T12:00:00.000Z');

/** 三组确定性信号：普通 / 达热门阈值（含增速）/ 达极热阈值（高增速） */
function buildSignalGroups(): Record<'normal' | 'hot' | 'viral', {
  signals: HeatSignals;
  rootCreatedAt: Date;
}> {
  return {
    normal: {
      signals: { replyCount: 1, likeCount: 0, recentReplyCount: 0, recentLikeCount: 0 },
      rootCreatedAt: new Date(NOW.getTime() - 5 * DAY),
    },
    hot: {
      signals: { replyCount: 3, likeCount: 2, recentReplyCount: 2, recentLikeCount: 2 },
      rootCreatedAt: new Date(NOW.getTime() - 1 * DAY),
    },
    viral: {
      signals: { replyCount: 10, likeCount: 20, recentReplyCount: 9, recentLikeCount: 18 },
      rootCreatedAt: new Date(NOW.getTime() - 12 * 3600000),
    },
  };
}

describe('computeHeat — 三档划分（TR-2.1）', () => {
  const groups = buildSignalGroups();

  it('三组确定性信号分别得到 normal / hot / viral', () => {
    expect(computeHeat(groups.normal.signals, groups.normal.rootCreatedAt, { now: NOW }).tier).toBe(
      'normal'
    );
    expect(computeHeat(groups.hot.signals, groups.hot.rootCreatedAt, { now: NOW }).tier).toBe(
      'hot'
    );
    expect(computeHeat(groups.viral.signals, groups.viral.rootCreatedAt, { now: NOW }).tier).toBe(
      'viral'
    );
  });

  it('normal：retain_until = 发布时间 + 10 天', () => {
    const heat = computeHeat(groups.normal.signals, groups.normal.rootCreatedAt, { now: NOW });
    expect(heat.retainUntil.getTime()).toBe(groups.normal.rootCreatedAt.getTime() + 10 * DAY);
  });

  it('hot：retain_until = 当前时间 + 7 天（滚动续期）', () => {
    const heat = computeHeat(groups.hot.signals, groups.hot.rootCreatedAt, { now: NOW });
    expect(heat.retainUntil.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  it('viral：retain_until = 发布时间 + 365 天（长期留存）', () => {
    const heat = computeHeat(groups.viral.signals, groups.viral.rootCreatedAt, { now: NOW });
    expect(heat.retainUntil.getTime()).toBe(groups.viral.rootCreatedAt.getTime() + 365 * DAY);
  });

  it('hot 每日复算仍达标时 retain_until 向前滚动；降档后回锚发布时间', () => {
    const day0 = NOW;
    const h0 = computeHeat(groups.hot.signals, groups.hot.rootCreatedAt, { now: day0 });
    const day1 = new Date(day0.getTime() + DAY);
    const h1 = computeHeat(groups.hot.signals, groups.hot.rootCreatedAt, { now: day1 });
    expect(h1.tier).toBe('hot');
    expect(h1.retainUntil.getTime()).toBe(day1.getTime() + 7 * DAY);
    expect(h1.retainUntil.getTime()).toBeGreaterThan(h0.retainUntil.getTime());

    // 信号全部移出 48h 窗口且总量不再达标 → normal，retain_until 回到发布锚点
    const cooled: HeatSignals = {
      replyCount: 3,
      likeCount: 2,
      recentReplyCount: 0,
      recentLikeCount: 0,
    };
    const later = new Date(day1.getTime() + 4 * DAY);
    const hCool = computeHeat(cooled, groups.hot.rootCreatedAt, { now: later });
    expect(hCool.tier).toBe('normal');
    expect(hCool.retainUntil.getTime()).toBe(groups.hot.rootCreatedAt.getTime() + 10 * DAY);
  });
});

describe('computeHeat — 确定性（TR-2.2）', () => {
  it('同输入重算结果完全一致', () => {
    const groups = buildSignalGroups();
    for (const key of ['normal', 'hot', 'viral'] as const) {
      const a = computeHeat(groups[key].signals, groups[key].rootCreatedAt, { now: NOW });
      const b = computeHeat(groups[key].signals, groups[key].rootCreatedAt, { now: NOW });
      expect(b).toEqual(a);
    }
  });

  it('env 覆盖阈值：降低 hot 阈值后普通信号变 hot；降低 viral 阈值后变 viral', () => {
    const groups = buildSignalGroups();
    const hotConfig = heatConfigFromEnv({ ...process.env, COMMENT_HOT_THRESHOLD: '0.5' });
    expect(computeHeat(groups.normal.signals, groups.normal.rootCreatedAt, {
      now: NOW,
      config: hotConfig,
    }).tier).toBe('hot');

    const viralConfig = heatConfigFromEnv({ ...process.env, COMMENT_VIRAL_THRESHOLD: '0.5' });
    expect(computeHeat(groups.normal.signals, groups.normal.rootCreatedAt, {
      now: NOW,
      config: viralConfig,
    }).tier).toBe('viral');
  });

  it('env 覆盖保留天数：retain_until 随 COMMENT_RETAIN_DAYS 变化', () => {
    const config = heatConfigFromEnv({ ...process.env, COMMENT_RETAIN_DAYS: '21' });
    const groups = buildSignalGroups();
    const heat = computeHeat(groups.normal.signals, groups.normal.rootCreatedAt, {
      now: NOW,
      config,
    });
    expect(heat.retainUntil.getTime()).toBe(groups.normal.rootCreatedAt.getTime() + 21 * DAY);
  });

  it('非法/空白 env 值回退默认配置', () => {
    const config = heatConfigFromEnv({
      ...process.env,
      COMMENT_RETAIN_DAYS: 'not-a-number',
      COMMENT_HOT_THRESHOLD: '  ',
    });
    expect(config.retainDays).toBe(DEFAULT_HEAT_CONFIG.retainDays);
    expect(config.hotScoreThreshold).toBe(DEFAULT_HEAT_CONFIG.hotScoreThreshold);
  });
});

describe('shouldArchive — pinned 与到期判定（TR-2.1）', () => {
  it('pinned 线程即使已过期也不归档；取消置顶后按 retain_until 判定', () => {
    const past = new Date(NOW.getTime() - DAY).toISOString();
    expect(shouldArchive({ pinned: 1, retainUntil: past }, NOW)).toBe(false);
    expect(shouldArchive({ pinned: true, retainUntil: past }, NOW)).toBe(false);
    expect(shouldArchive({ pinned: 0, retainUntil: past }, NOW)).toBe(true);
  });

  it('未到期不归档；恰好到期（<=）归档', () => {
    const future = new Date(NOW.getTime() + DAY).toISOString();
    const exact = NOW.toISOString();
    expect(shouldArchive({ pinned: 0, retainUntil: future }, NOW)).toBe(false);
    expect(shouldArchive({ pinned: 0, retainUntil: exact }, NOW)).toBe(true);
  });
});

describe('DB 辅助：recalculateThreadHeat / setThreadPinned', () => {
  const dbBase = path.join(__dirname, '../../data/test-heat-service.db');
  let database: Database;

  beforeAll(async () => {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbBase + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    database = await open({ filename: dbBase, driver: sqlite3.Database });
    await database.exec(`
      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        depth INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT
      );
      CREATE TABLE comment_likes (
        comment_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (comment_id, user_id)
      );
      CREATE TABLE comment_heat (
        root_id TEXT PRIMARY KEY,
        reply_count INTEGER NOT NULL DEFAULT 0,
        like_count INTEGER NOT NULL DEFAULT 0,
        score REAL NOT NULL DEFAULT 0,
        velocity REAL NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'normal',
        last_calc_at TEXT,
        retain_until TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0
      );
    `);

    // h1：hot 型线程 —— 3 回复（2 条在 48h 内），4 赞（3 个在 48h 内）
    await database.run(
      "INSERT INTO comments (id, root_id, depth, content, created_at) VALUES ('h1', 'h1', 1, 'root', ?)",
      [new Date(NOW.getTime() - DAY).toISOString()]
    );
    const replies: Array<[string, string, number, number]> = [
      ['h1r1', 'h1', 2, 3 * DAY],
      ['h1r2', 'h1', 2, DAY],
      ['h1r3', 'h1', 3, 3600000],
    ];
    for (const [id, rootId, depth, ageMs] of replies) {
      await database.run(
        'INSERT INTO comments (id, root_id, depth, content, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, rootId, depth, 'reply', new Date(NOW.getTime() - ageMs).toISOString()]
      );
    }
    const likes: Array<[string, string, number]> = [
      ['h1', 'u1', 3 * DAY],
      ['h1', 'u2', DAY],
      ['h1r2', 'u3', 3600000],
      ['h1r3', 'u4', 1800000],
    ];
    for (const [commentId, userId, ageMs] of likes) {
      await database.run(
        'INSERT INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)',
        [commentId, userId, new Date(NOW.getTime() - ageMs).toISOString()]
      );
    }

    // h2：用于 pinned 保留验证
    await database.run(
      "INSERT INTO comments (id, root_id, depth, content, created_at) VALUES ('h2', 'h2', 1, 'root', ?)",
      [new Date(NOW.getTime() - 2 * DAY).toISOString()]
    );
  });

  afterAll(async () => {
    await database.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbBase + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('recalculateThreadHeat 聚合信号、定档并写入 comment_heat', async () => {
    const heat = await recalculateThreadHeat(database, 'h1', { now: NOW });
    // 信号：3 回复（近窗 2）、4 赞（近窗 3）
    expect(heat.velocity).toBe((2 * 2 + 3 * 1) / 2);
    expect(heat.tier).toBe('hot');

    const row = (await database.get('SELECT * FROM comment_heat WHERE root_id = ?', [
      'h1',
    ])) as Record<string, unknown>;
    expect(row.tier).toBe('hot');
    expect(row.reply_count).toBe(3);
    expect(row.like_count).toBe(4);
    expect(row.pinned).toBe(0);
    expect(row.retain_until).toBe(heat.retainUntil.toISOString());
  });

  it('置顶后重算：档位更新但 pinned 保留为 1', async () => {
    await setThreadPinned(database, 'h1', true);
    const heat = await recalculateThreadHeat(database, 'h1', { now: NOW });
    const row = (await database.get('SELECT pinned FROM comment_heat WHERE root_id = ?', [
      'h1',
    ])) as { pinned: number };
    expect(row.pinned).toBe(1);
    expect(heat.tier).toBe('hot');

    await setThreadPinned(database, 'h1', false);
    const row2 = (await database.get('SELECT pinned FROM comment_heat WHERE root_id = ?', [
      'h1',
    ])) as { pinned: number };
    expect(row2.pinned).toBe(0);
  });

  it('不存在的 root/heat 行抛对应错误码', async () => {
    await expect(
      recalculateThreadHeat(database, 'missing', { now: NOW })
    ).rejects.toThrow('COMMENT_ROOT_NOT_FOUND');
    await expect(setThreadPinned(database, 'h2', true)).rejects.toThrow(
      'COMMENT_HEAT_NOT_FOUND'
    );
  });
});
