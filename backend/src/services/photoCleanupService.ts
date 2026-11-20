/**
 * @file 未过审照片自动清理作业（V4.12.0，PRD 7.3；V4.15.0 Q10 扩展）
 * @description
 *  每日扫描待审核/已驳回超过 30 天的照片，删除数据库记录与 OSS 原图/缩略图/预览图/水印图，
 *  满足「所有未过审的照片满 30 天自动清理」的运营规则（Q10 已明确取消「未过审不可删」限制）。
 *  可通过环境变量 `PHOTO_CLEANUP_ENABLED=off` 临时关闭，便于排障。
 */
import type { Database } from 'sqlite';
import { deleteFromOSS } from './ossService';

/** 清理阈值：待审核超过 30 天 */
const PENDING_RETENTION_DAYS = 30;
/** OSS 域名前缀（与上传落库时的 URL 格式一致） */
const OSS_DOMAIN = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';

/** 从 OSS URL 或纯 Key 提取对象 Key（外部 URL 返回 null） */
function extractOssKey(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(OSS_DOMAIN)) {
    return url.slice(OSS_DOMAIN.length).split('?')[0] || null;
  }
  // V4.13.0：异步上传落库为纯 Key
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return url.split('?')[0] || null;
  }
  return null;
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
    `SELECT id, title, original_url, thumbnail_path, preview_url, watermarked_url, detail_key
     FROM photos
     WHERE status IN ('pending', 'rejected') AND created_at <= ?`,
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
      extractOssKey(photo.detail_key),
    ].filter(Boolean) as string[];

    for (const key of new Set(keys)) {
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
    // V4.15.0（Q10）：驳回作品也会被自动清理，同步移除其申诉记录
    await db.run('DELETE FROM appeals WHERE photo_id = ?', [photo.id]);
    // V4.13.0：清理异步处理任务，避免 Worker 处理已清理照片
    await db.run('DELETE FROM photo_tasks WHERE photo_id = ?', [photo.id]);
    await db.run('DELETE FROM photos WHERE id = ?', [photo.id]);
    console.log(`[PhotoCleanup] 已清理待审超期作品 photo=${photo.id} title=${photo.title}`);
  }

  return { photos: rows.length, objects };
}
