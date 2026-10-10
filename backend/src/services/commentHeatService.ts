/**
 * @file commentHeatService.ts
 * @description V3.0.0 评论热度评分服务（启发式规则 + 增速预测，非 ML 模型）。
 *
 *              评分模型（权重/阈值全部可配置、可注入）：
 *              1. 基础分 = 回复数×replyWeight + 全楼点赞数×likeWeight，
 *                 按线程年龄做指数时间衰减（半衰期 decayHalfLifeDays）；
 *              2. 增速 velocity：近 48h 新增回复/点赞折算为"每日加权信号速率"，
 *                 线性外推 predictionDays 天得到预测分；
 *              3. 总分 = 衰减后基础分 + 预测分，按阈值划分 normal/hot/viral。
 *
 *              留存规则（保留期锚点为 L1 的 created_at，续期只改 retain_until）：
 *              - normal：root_created_at + retainDays（默认 10 天）；
 *              - hot：每日复算仍达标时 retain_until 滚动为 now + hotExtraDays（默认 +7 天）；
 *              - viral：root_created_at + viralDays（默认 365 天，长期留存）；
 *              - pinned：不受到期影响（归档作业经 shouldArchive 一律跳过），直至管理员取消。
 *
 *              纯计算部分为无副作用纯函数（确定性可测）；DB 辅助函数负责信号聚合与
 *              comment_heat 行的 upsert（pinned 状态在冲突更新时保留）。
 */
import type { Database } from 'sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 热度档位：普通 / 热门 / 极热 */
export type HeatTier = 'normal' | 'hot' | 'viral';

/** 热度算法配置（保留天数、热度阈值、权重、时间窗口均可注入） */
export interface HeatConfig {
  /** normal 档基础保留天数（环境变量 COMMENT_RETAIN_DAYS，默认 10） */
  retainDays: number;
  /** hot 档每次复算的滚动续期天数（默认 7） */
  hotExtraDays: number;
  /** viral 档长期留存天数（默认 365） */
  viralDays: number;
  /** 增速统计窗口天数（默认 2，即近 48 小时） */
  velocityWindowDays: number;
  /** 增速线性外推天数（默认 7） */
  predictionDays: number;
  /** 基础分时间衰减半衰期天数（默认 7） */
  decayHalfLifeDays: number;
  /** 单个回复的权重（默认 2） */
  replyWeight: number;
  /** 单个点赞的权重（默认 1） */
  likeWeight: number;
  /** hot 档总分阈值（默认 10） */
  hotScoreThreshold: number;
  /** viral 档总分阈值（默认 50） */
  viralScoreThreshold: number;
}

/** 默认配置：与 .env.example 注释保持一致 */
export const DEFAULT_HEAT_CONFIG: HeatConfig = {
  retainDays: 10,
  hotExtraDays: 7,
  viralDays: 365,
  velocityWindowDays: 2,
  predictionDays: 7,
  decayHalfLifeDays: 7,
  replyWeight: 2,
  likeWeight: 1,
  hotScoreThreshold: 10,
  viralScoreThreshold: 50,
};

/** 读取环境变量数字值；缺省或非法时回退默认值（保证服务不会因配置笔误启动失败） */
function envNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 由环境变量构造配置；未设置的项使用默认值 */
export function heatConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HeatConfig {
  const d = DEFAULT_HEAT_CONFIG;
  return {
    retainDays: envNumber(env, 'COMMENT_RETAIN_DAYS', d.retainDays),
    hotExtraDays: envNumber(env, 'COMMENT_HOT_EXTRA_DAYS', d.hotExtraDays),
    viralDays: envNumber(env, 'COMMENT_VIRAL_DAYS', d.viralDays),
    velocityWindowDays: envNumber(env, 'COMMENT_VELOCITY_WINDOW_DAYS', d.velocityWindowDays),
    predictionDays: envNumber(env, 'COMMENT_PREDICTION_DAYS', d.predictionDays),
    decayHalfLifeDays: envNumber(env, 'COMMENT_DECAY_HALFLIFE_DAYS', d.decayHalfLifeDays),
    replyWeight: envNumber(env, 'COMMENT_REPLY_WEIGHT', d.replyWeight),
    likeWeight: envNumber(env, 'COMMENT_LIKE_WEIGHT', d.likeWeight),
    hotScoreThreshold: envNumber(env, 'COMMENT_HOT_THRESHOLD', d.hotScoreThreshold),
    viralScoreThreshold: envNumber(env, 'COMMENT_VIRAL_THRESHOLD', d.viralScoreThreshold),
  };
}

/** 热度输入信号：累计口径 + 近窗口口径 */
export interface HeatSignals {
  /** 线程回复总数（depth > 1 的评论数） */
  replyCount: number;
  /** 全楼获赞总数（comment_likes 行数） */
  likeCount: number;
  /** 近窗口新增回复数 */
  recentReplyCount: number;
  /** 近窗口新增点赞数 */
  recentLikeCount: number;
}

/** 热度计算结果 */
export interface HeatComputation {
  /** 总分（衰减基础分 + 增速外推预测分） */
  score: number;
  /** 增速：每日加权信号速率 */
  velocity: number;
  /** 热度档位 */
  tier: HeatTier;
  /** 计算出的有效留存截止时间 */
  retainUntil: Date;
}

/**
 * 热度纯计算：同输入必得同输出，无任何副作用。
 *
 * @param signals 回复/点赞信号（累计 + 近窗口）
 * @param rootCreatedAt L1 主评论发布时间（保留期锚点）
 * @param options.config 算法配置（默认 DEFAULT_HEAT_CONFIG）
 * @param options.now 当前时间（默认系统时钟，测试可固定）
 */
export function computeHeat(
  signals: HeatSignals,
  rootCreatedAt: Date,
  options: { config?: HeatConfig; now?: Date } = {}
): HeatComputation {
  const config = options.config ?? DEFAULT_HEAT_CONFIG;
  const now = options.now ?? new Date();

  // 1) 基础分 × 指数时间衰减
  const ageDays = Math.max(0, (now.getTime() - rootCreatedAt.getTime()) / DAY_MS);
  const decay = Math.exp(-ageDays / config.decayHalfLifeDays);
  const baseScore = config.replyWeight * signals.replyCount + config.likeWeight * signals.likeCount;

  // 2) 近窗口每日信号速率 → 线性外推
  const velocity =
    (config.replyWeight * signals.recentReplyCount +
      config.likeWeight * signals.recentLikeCount) /
    config.velocityWindowDays;
  const predictedScore = velocity * config.predictionDays;

  const score = baseScore * decay + predictedScore;

  // 3) 阈值定档
  let tier: HeatTier;
  if (score >= config.viralScoreThreshold) tier = 'viral';
  else if (score >= config.hotScoreThreshold) tier = 'hot';
  else tier = 'normal';

  // 4) retain_until：normal/viral 锚定发布时间；hot 从当前时间滚动续期
  let retainUntil: Date;
  if (tier === 'hot') {
    retainUntil = new Date(now.getTime() + config.hotExtraDays * DAY_MS);
  } else if (tier === 'viral') {
    retainUntil = new Date(rootCreatedAt.getTime() + config.viralDays * DAY_MS);
  } else {
    retainUntil = new Date(rootCreatedAt.getTime() + config.retainDays * DAY_MS);
  }

  return { score, velocity, tier, retainUntil };
}

/** 归档判断所需的最小行结构 */
export interface HeatArchiveRow {
  /** 是否置顶（1/true 时永不归档） */
  pinned: number | boolean;
  /** 有效留存截止时间 */
  retainUntil: string | Date;
}

/**
 * 判断线程是否可被归档：pinned 一律不归档；
 * 其余按 retain_until 是否已到（含恰好到期）判定。
 */
export function shouldArchive(row: HeatArchiveRow, now: Date = new Date()): boolean {
  if (Number(row.pinned) === 1) return false;
  return new Date(row.retainUntil).getTime() <= now.getTime();
}

/**
 * 从数据库聚合线程信号并重算热度，结果 upsert 到 comment_heat。
 * 冲突更新时保留 pinned，不覆盖置顶状态。
 *
 * @param database 数据库实例
 * @param rootId L1 主评论 id（即线程 root_id）
 * @param options.config 算法配置（默认取环境变量）
 * @param options.now 当前时间（测试可固定）
 */
export async function recalculateThreadHeat(
  database: Database,
  rootId: string,
  options: { config?: HeatConfig; now?: Date } = {}
): Promise<HeatComputation> {
  const config = options.config ?? heatConfigFromEnv();
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - config.velocityWindowDays * DAY_MS).toISOString();

  const root = (await database.get('SELECT created_at FROM comments WHERE id = ?', [
    rootId,
  ])) as { created_at: string } | undefined;
  if (!root) {
    throw new Error('COMMENT_ROOT_NOT_FOUND');
  }

  const agg = (await database.get(
    `SELECT
       (SELECT COUNT(*) FROM comments WHERE root_id = ? AND depth > 1) AS reply_count,
       (SELECT COUNT(*) FROM comment_likes cl
         WHERE cl.comment_id IN (SELECT id FROM comments WHERE root_id = ?)) AS like_count,
       (SELECT COUNT(*) FROM comments
         WHERE root_id = ? AND depth > 1 AND created_at >= ?) AS recent_reply_count,
       (SELECT COUNT(*) FROM comment_likes cl
         WHERE cl.comment_id IN (SELECT id FROM comments WHERE root_id = ?)
           AND cl.created_at >= ?) AS recent_like_count`,
    [rootId, rootId, rootId, cutoff, rootId, cutoff]
  )) as {
    reply_count: number;
    like_count: number;
    recent_reply_count: number;
    recent_like_count: number;
  };

  const heat = computeHeat(
    {
      replyCount: agg.reply_count,
      likeCount: agg.like_count,
      recentReplyCount: agg.recent_reply_count,
      recentLikeCount: agg.recent_like_count,
    },
    new Date(root.created_at),
    { config, now }
  );

  await database.run(
    `INSERT INTO comment_heat
       (root_id, reply_count, like_count, score, velocity, tier, last_calc_at, retain_until, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(root_id) DO UPDATE SET
       reply_count = excluded.reply_count,
       like_count = excluded.like_count,
       score = excluded.score,
       velocity = excluded.velocity,
       tier = excluded.tier,
       last_calc_at = excluded.last_calc_at,
       retain_until = excluded.retain_until`,
    [
      rootId,
      agg.reply_count,
      agg.like_count,
      heat.score,
      heat.velocity,
      heat.tier,
      now.toISOString(),
      heat.retainUntil.toISOString(),
    ]
  );

  return heat;
}

/**
 * 设置线程置顶/取消置顶。
 * 置顶后归档作业跳过该线程（retain_until 不作废，取消置顶后继续按档位生效）。
 *
 * @returns 无返回；heat 行不存在时抛 COMMENT_HEAT_NOT_FOUND
 */
export async function setThreadPinned(
  database: Database,
  rootId: string,
  pinned: boolean
): Promise<void> {
  const result = await database.run('UPDATE comment_heat SET pinned = ? WHERE root_id = ?', [
    pinned ? 1 : 0,
    rootId,
  ]);
  if (result.changes === 0) {
    throw new Error('COMMENT_HEAT_NOT_FOUND');
  }
}
