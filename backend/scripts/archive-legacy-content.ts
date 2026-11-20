/**
 * @file archive-legacy-content.ts（V4.15.0）
 * @description 一次性数据订正脚本：
 *  1. 将全部新闻（articles.type='news'）作者统一为「特邀新闻评论员」；
 *  2. 将 V4.15.0 之前上传的存量照片 tags 统一替换为「旧照片」，
 *     保留 structured_tags 元数据（机型/车号/线路等仍可用于筛选与详情展示）。
 *  默认仅预演；确认后追加 --apply 执行，执行前自动 VACUUM INTO 备份主库。
 *  用法：node -r ts-node/register/transpile-only scripts/archive-legacy-content.ts [--apply]
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../data/database.db');
const BACKUP_DIR = path.join(__dirname, '../data/backups');
const APPLY = process.argv.includes('--apply');

/** 数据订正截止时间：2026-11-20 00:00（Asia/Shanghai）之前创建的照片视为旧照片 */
const LEGACY_CUTOFF = '2026-11-19T16:00:00.000Z';
/** 新闻统一署名 */
const NEWS_AUTHOR = '特邀新闻评论员';
/** 旧照片统一标签 */
const LEGACY_TAG_JSON = '["旧照片"]';

/** 生成备份文件名时间戳 */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`数据库不存在: ${DB_PATH}`);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  const news = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM articles WHERE type = 'news' AND author != ?",
    [NEWS_AUTHOR]
  );
  const legacy = await db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM photos WHERE created_at <= ? AND (tags IS NULL OR tags != ?)',
    [LEGACY_CUTOFF, LEGACY_TAG_JSON]
  );

  console.log(`[Archive] 待更新新闻作者: ${news?.c ?? 0} 条`);
  console.log(`[Archive] 待归档旧照片（tags → ${LEGACY_TAG_JSON}）: ${legacy?.c ?? 0} 条`);
  console.log(`[Archive] 截止时间: ${LEGACY_CUTOFF}`);

  if (!APPLY) {
    console.log('[Archive] 预演模式：未写入。确认后追加 --apply 执行。');
    await db.close();
    return;
  }

  const backupFile = path.join(BACKUP_DIR, `manual-archive-legacy-${timestamp()}.db`);
  await db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
  console.log(`[Archive] 已备份主库: ${backupFile}`);

  await db.exec('BEGIN IMMEDIATE');
  try {
    const newsResult = await db.run(
      "UPDATE articles SET author = ? WHERE type = 'news'",
      [NEWS_AUTHOR]
    );
    const photoResult = await db.run(
      'UPDATE photos SET tags = ? WHERE created_at <= ? AND (tags IS NULL OR tags != ?)',
      [LEGACY_TAG_JSON, LEGACY_CUTOFF, LEGACY_TAG_JSON]
    );
    await db.exec('COMMIT');
    console.log(`[Archive] 完成：新闻 ${newsResult.changes} 条，旧照片 ${photoResult.changes} 条`);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  } finally {
    await db.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[Archive] 失败:', error);
    process.exit(1);
  });
