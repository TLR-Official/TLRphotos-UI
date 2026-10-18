/**
 * @file 处罚服务（V4.1.0）
 * @description 三级处罚体系的能力检查与限时封禁自愈：
 *              - getActivePenalties：查询用户当前有效处罚（未撤销且未过期）
 *              - checkPenaltyCap：L2 功能封禁执法点（上传/评论/论坛发帖/下载）
 *              - clearExpiredBan：L3 限时封禁到期自愈（清除 banned_at/banned_until）
 *              expires_at 过期自动失效，无需定时任务。
 */
import { db } from '../db';

/** L2 功能封禁可勾选的能力白名单（执法点四项；'all' 仅作为 L3 快照值，不允许作为执法入参） */
export const PENALTY_CAPS = ['upload', 'comment', 'forum_post', 'download'] as const;

export type PenaltyCap = (typeof PENALTY_CAPS)[number];

/** penalties 表行（V4.1.0 三级语义） */
export interface PenaltyRow {
  id: string;
  user_id: string;
  level: number;
  reason: string;
  days: number | null;
  expires_at: string | null;
  capabilities: string | null;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

/** 能力封禁检查结果：banned=true 时 penalty 为命中的活跃 L2 记录（含 expires_at 供提示解禁时间） */
export interface PenaltyCapResult {
  banned: boolean;
  penalty?: PenaltyRow;
}

/**
 * 查询用户当前有效处罚：未撤销（revoked_at IS NULL）且未过期
 * （expires_at IS NULL 或大于当前 ISO 时间），按创建时间倒序。
 * ISO 字符串同格式可直接字典序比较。
 */
export async function getActivePenalties(userId: string): Promise<PenaltyRow[]> {
  const nowIso = new Date().toISOString();
  const rows = (await db.all(
    `SELECT * FROM penalties
     WHERE user_id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC`,
    [userId, nowIso]
  )) as Array<PenaltyRow>;
  return rows ?? [];
}

/**
 * L2 功能封禁执法点：检查用户活跃 L2 处罚的 capabilities 快照是否封禁指定能力。
 * 命中条件：快照包含 'all' 或包含指定 cap。解析失败（脏数据）按未封禁处理，不抛出。
 * @param cap 能力标识，仅允许 PENALTY_CAPS 四项白名单值
 */
export async function checkPenaltyCap(userId: string, cap: PenaltyCap): Promise<PenaltyCapResult> {
  if (!PENALTY_CAPS.includes(cap)) {
    throw new Error(`无效的能力标识: ${String(cap)}`);
  }
  const active = await getActivePenalties(userId);
  for (const penalty of active) {
    if (penalty.level !== 2) continue;
    let caps: unknown = null;
    try {
      caps = penalty.capabilities ? JSON.parse(penalty.capabilities) : null;
    } catch {
      caps = null;
    }
    if (Array.isArray(caps) && (caps.includes('all') || caps.includes(cap))) {
      return { banned: true, penalty };
    }
  }
  return { banned: false };
}

/**
 * L3 限时封禁到期自愈：banned_at 与 banned_until 均非空且 banned_until 已过期时，
 * 清除 users 表封禁标记（永久封禁 banned_until 为空，不在此清除）。
 * @returns 是否实际清除了封禁
 */
export async function clearExpiredBan(userId: string): Promise<boolean> {
  const user = await db.get<{ banned_at: string | null; banned_until: string | null }>(
    'SELECT banned_at, banned_until FROM users WHERE id = ?',
    [userId]
  );
  if (!user?.banned_at || !user.banned_until) {
    return false;
  }
  const untilMs = Date.parse(user.banned_until);
  if (!Number.isFinite(untilMs) || untilMs > Date.now()) {
    return false;
  }
  await db.run('UPDATE users SET banned_at = NULL, banned_until = NULL WHERE id = ?', [userId]);
  return true;
}
