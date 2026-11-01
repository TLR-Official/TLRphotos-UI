/**
 * @file delete-user.ts（V4.9.1，一次性运维脚本）
 * @description 按邮箱或用户名删除普通用户，使其可重新注册：
 *  先以 VACUUM INTO 备份主库，再在事务内清理会话、人机验证记录、
 *  同邮箱验证码（解除 60 秒冷却与每小时次数占用）与浏览去重记录，最后删除 users 行。
 *  若该用户名下仍有照片/评论/论坛帖子，脚本拒绝执行（需人工先处理内容归属）。
 *  幂等，可重复执行。
 *  用法：npx ts-node --transpile-only scripts/delete-user.ts --email <邮箱> [--dry-run]
 *        npx ts-node --transpile-only scripts/delete-user.ts --username <用户名> [--dry-run]
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { db, initDb } from '../src/db';

const DRY_RUN = process.argv.includes('--dry-run');

/** 读取 --email / --username 参数 */
function readArg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

/** 备份目录（与 backup-db.ts 一致） */
const BACKUP_DIR = path.join(__dirname, '../data/backups');

/** 生成备份文件名时间戳：YYYYMMDD-HHmmss */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

interface TargetUser {
  id: string;
  username: string | null;
  email: string | null;
}

async function main(): Promise<void> {
  await initDb();

  const email = readArg('email');
  const username = readArg('username');
  if (!email && !username) {
    throw new Error('必须提供 --email 或 --username');
  }

  const user = email
    ? await db.get<TargetUser>('SELECT id, username, email FROM users WHERE email = ?', email)
    : await db.get<TargetUser>('SELECT id, username, email FROM users WHERE username = ?', username);

  if (!user) {
    console.log('[DeleteUser] 未找到匹配用户，无需删除');
    return;
  }

  const photoCount = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM photos WHERE user_id = ?', user.id))?.n ?? 0;
  const commentCount = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?', user.id))?.n ?? 0;
  const threadCount = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM forum_threads WHERE author_id = ?', user.id))?.n ?? 0;

  console.log('[DeleteUser] 目标用户:', JSON.stringify(user));
  console.log('[DeleteUser] 名下内容: photos=%d comments=%d forum_threads=%d', photoCount, commentCount, threadCount);

  if (photoCount > 0 || commentCount > 0 || threadCount > 0) {
    throw new Error('该用户名下仍有内容，脚本拒绝删除；请先处理照片/评论/帖子的归属');
  }

  const emailTarget = user.email;

  if (DRY_RUN) {
    const sessions = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cookie WHERE user_id = ?', user.id))?.n ?? 0;
    const verifications = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_verifications WHERE subject_id = ?', user.id))?.n ?? 0;
    const codes = emailTarget
      ? (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM verification_codes WHERE target = ?', emailTarget))?.n ?? 0
      : 0;
    console.log('[DeleteUser] dry-run: sessions=%d verifications=%d codes=%d（未写入任何变更）', sessions, verifications, codes);
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `manual-delete-user-${user.id}-${timestamp()}.db`);
  await db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
  console.log('[DeleteUser] 已备份主库:', backupFile);

  await db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    await db.run('DELETE FROM cookie WHERE user_id = ?', user.id);
    await db.run('DELETE FROM user_verifications WHERE subject_id = ?', user.id);
    if (emailTarget) {
      await db.run('DELETE FROM verification_codes WHERE target = ?', emailTarget);
    }
    await db.run('DELETE FROM photo_likes WHERE user_id = ?', user.id);
    await db.run('DELETE FROM article_likes WHERE user_id = ?', user.id);
    await db.run('DELETE FROM comment_likes WHERE user_id = ?', user.id);
    await db.run('DELETE FROM thread_likes WHERE user_id = ?', user.id);
    await db.run('DELETE FROM notifications WHERE user_id = ?', user.id);
    await db.run('DELETE FROM photo_views WHERE viewer_key = ?', `user:${user.id}`);
    await db.run('DELETE FROM thread_views WHERE viewer_key = ?', `user:${user.id}`);
    await db.run('DELETE FROM users WHERE id = ?', user.id);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  const remaining = emailTarget
    ? (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE email = ?', emailTarget))?.n ?? 0
    : 0;
  const codeRemaining = emailTarget
    ? (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM verification_codes WHERE target = ?', emailTarget))?.n ?? 0
    : 0;
  console.log('[DeleteUser] 删除完成: users(email)=%d verification_codes(email)=%d', remaining, codeRemaining);
  console.log('[DeleteUser] 该邮箱现已可重新注册');
}

main().catch((error) => {
  console.error('[DeleteUser] 执行失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
