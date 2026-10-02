/**
 * @file 管理员登录失败守卫
 * @description 内存型失败计数与临时锁定，与速率限制器职责分离：
 *              限速器控制请求频率，本服务针对「同用户名 + 同 IP」的口令猜测行为。
 *              达到阈值后在锁定窗内拒绝尝试验证，成功登录即清零。
 *              进程重启计数清零（仅影响锁定状态，不削弱其他防护）。
 */

/** 允许的连续失败次数 */
const MAX_FAILURES = 5;
/** 锁定时长（毫秒）：15 分钟 */
const LOCK_DURATION_MS = 15 * 60 * 1000;

interface FailureRecord {
  failures: number;
  lockedUntil: number | null;
}

/** key: `${username}::${ip}` */
const records = new Map<string, FailureRecord>();

function buildKey(username: string, ip: string): string {
  return `${username}::${ip}`;
}

/**
 * 检查目标是否处于锁定状态
 * @returns 锁定中返回剩余毫秒数，否则 null
 */
export function getLockRemaining(username: string, ip: string): number | null {
  const record = records.get(buildKey(username, ip));
  if (!record || record.lockedUntil === null) return null;

  const remaining = record.lockedUntil - Date.now();
  if (remaining <= 0) {
    // 锁定已过期：清除记录，允许重新尝试
    records.delete(buildKey(username, ip));
    return null;
  }
  return remaining;
}

/**
 * 记录一次失败：累计达到阈值则进入锁定
 * @returns 锁定时返回剩余毫秒数，否则返回 null（及当前失败次数）
 */
export function recordFailure(username: string, ip: string): { lockedMs: number | null; failures: number } {
  const key = buildKey(username, ip);
  const record = records.get(key) || { failures: 0, lockedUntil: null };

  // 锁定窗内重复失败不延长、不重置
  if (record.lockedUntil !== null && record.lockedUntil - Date.now() > 0) {
    return { lockedMs: record.lockedUntil - Date.now(), failures: record.failures };
  }

  record.failures += 1;
  if (record.failures >= MAX_FAILURES) {
    record.lockedUntil = Date.now() + LOCK_DURATION_MS;
    records.set(key, record);
    return { lockedMs: LOCK_DURATION_MS, failures: record.failures };
  }

  records.set(key, record);
  return { lockedMs: null, failures: record.failures };
}

/**
 * 登录成功后清除该主体的失败计数
 */
export function clearFailures(username: string, ip: string): void {
  records.delete(buildKey(username, ip));
}
