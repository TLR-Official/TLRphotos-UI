/**
 * @file 未审核照片自动清理作业（V4.12.0，PRD 7.3）
 * @description
 *  每日扫描待审核超过 30 天的照片，删除数据库记录与 OSS 原图/缩略图/预览图/水印图，
 *  满足「未审满 1 个月清理一次」的运营规则。审核端手动删除仍受「未过审不可删」约束，
 *  本作业为独立自动清理通道（PRD Q10 的自动清理豁免）。
 *  可通过环境变量 `PHOTO_CLEANUP_ENABLED=off` 临时关闭，便于排障。
 */
import type { Database } from 'sqlite';
import { deleteFromOSS } from './ossService';

/** 清理阈值：待审核超过 30 天 */
const PENDING_RETENTION_DAYS = 30;
/** OSS 域名前缀（与上传落库时的 URL 格式一致） */
const OSS_DOMAIN = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';

/** 从 OSS URL 提取对象 Key（非 OSS 地址返回 null） */
function extractOssKey(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(OSS_DOMAIN)) return null;
  return url.slice(OSS_DOMAIN.length).split('?')[0] || null;
}

/**
 * 执行一次未审核照片清理。
 * @param db 主业务库连接
 * @returns 实际删除的照片数量与已清理的 OSS 对象数量
 */
export async function cleanupUnreviewedPhotos(
  db: Database,
): Promise<{ photos: number; objects: number }> {
  if ((process.env.PHOTO_CLEANUP_ENABLED || '').trim().toLowerCase() === 'off') {
    return { photos: 0, objects: 0 };
  }

  const cutoff = new Date(Date.now() - PENDING_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.all<any[]>(
    `SELECT id, title, original_url, thumbnail_path, preview_url, watermarked_url
     FROM photos
     WHERE status = 'pending' AND created_at <= ?`,
    [cutoff],
  );

  if (rows.length === 0) return { photos: 0, objects: 0 };

  let objects = 0;
  for (const photo of rows) {
    const keys = [
      extractOssKey(photo.original_url),
      extractOssKey(photo.thumbnail_path),
      extractOssKey(photo.preview_url),
      extractOssKey(photo.watermarked_url),
    ].filter(Boolean) as string[];

    for (const key of keys) {
      try {
        await deleteFromOSS(key);
        objects += 1;
      } catch (error) {
        console.warn(`[PhotoCleanup] OSS 删除失败 photo=${photo.id} key=${key}:`, error);
      }
    }

    // 清理关联记录后删除照片本体（评论按 subject_type/subject_id 关联）
    await db.run('DELETE FROM photo_likes WHERE photo_id = ?', [photo.id]);
    await db.run('DELETE FROM photo_views WHERE photo_id = ?', [photo.id]);
    await db.run("DELETE FROM comments WHERE subject_type = 'photo' AND subject_id = ?", [photo.id]);
    await db.run('DELETE FROM photos WHERE id = ?', [photo.id]);
    console.log(`[PhotoCleanup] 已清理待审超期作品 photo=${photo.id} title=${photo.title}`);
  }

  return { photos: rows.length, objects };
}
