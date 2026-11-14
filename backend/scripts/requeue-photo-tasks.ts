/**
 * @file requeue-photo-tasks.ts（V4.14.0）
 * @description 运维重跑工具：把异步水印/压缩失败的照片任务重置为 pending，
 *  由进程内 Worker 在下一轮轮询时重新处理（PRD 4.5.2「由运维侧可重跑」）。
 *  用法：
 *    node -r ts-node/register/transpile-only scripts/requeue-photo-tasks.ts [--photo-id 000123] [--dry-run]
 *  缺省重跑全部 failed 任务；--photo-id 可只重跑指定照片。
 */
import 'dotenv/config';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

/** 读取命令行参数值 */
function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const photoId = argValue('--photo-id');
  const dryRun = process.argv.includes('--dry-run');
  const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../data/database.db');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  const where = photoId ? "WHERE status = 'failed' AND photo_id = ?" : "WHERE status = 'failed'";
  const params = photoId ? [photoId] : [];
  const rows = await db.all<{ id: string; photo_id: string; attempts: number; last_error: string | null }[]>(
    `SELECT id, photo_id, attempts, last_error FROM photo_tasks ${where} ORDER BY created_at ASC`,
    params,
  );

  if (rows.length === 0) {
    console.log('[Requeue] 没有 failed 任务需要重跑');
    await db.close();
    return;
  }

  for (const row of rows) {
    console.log(
      `[Requeue] task=${row.id} photo=${row.photo_id} attempts=${row.attempts} last_error=${row.last_error ?? '-'}`,
    );
  }

  if (dryRun) {
    console.log(`[Requeue] --dry-run：共 ${rows.length} 条任务未修改`);
    await db.close();
    return;
  }

  const now = new Date().toISOString();
  for (const row of rows) {
    await db.run(
      `UPDATE photo_tasks
       SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL,
           started_at = NULL, finished_at = NULL
       WHERE id = ?`,
      [now, row.id],
    );
    await db.run("UPDATE photos SET processing_status = 'pending' WHERE id = ?", [row.photo_id]);
  }

  console.log(`[Requeue] 已重置 ${rows.length} 条任务，Worker 将在下一轮轮询重新处理`);
  await db.close();
}

main().catch((error) => {
  console.error('[Requeue] 执行失败:', error);
  process.exit(1);
});
