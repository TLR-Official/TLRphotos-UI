/**
 * @file 热门时效到期作业（V4.12.0，PRD 4.2）
 * @description
 *  确认热门时由 `PUT /api/admin/photos/:id/hot` 写入 `photos.hot_expires_at`；
 *  本作业每日扫描一次，将已到期的热门标识自动取消（is_hot_confirmed=0）。
 *  仅取消热门标识，不删除作品，也不改动历史已处理数据。
 */
import type { Database } from 'sqlite';

/**
 * 取消所有已到期的热门标识。
 * @param db 主业务库连接
 * @returns 本次取消热门的照片数量
 */
export async function expireHotPhotos(db: Database): Promise<number> {
  const now = new Date().toISOString();
  const due = await db.all<{ id: string }[]>(
    `SELECT id FROM photos
     WHERE is_hot_confirmed = 1
       AND hot_expires_at IS NOT NULL
       AND hot_expires_at != ''
       AND hot_expires_at <= ?`,
    [now],
  );

  if (due.length === 0) return 0;

  await db.run(
    `UPDATE photos
     SET is_hot_confirmed = 0, hot_expires_at = NULL
     WHERE is_hot_confirmed = 1
       AND hot_expires_at IS NOT NULL
       AND hot_expires_at != ''
       AND hot_expires_at <= ?`,
    [now],
  );

  return due.length;
}
