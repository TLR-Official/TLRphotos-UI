/**
 * @file 照片异步处理服务（V4.13.0，PRD 4.5 方案 A）
 * @description
 *  用户端 OSS 预签名直传原图后，`/api/photos/upload/complete` 仅落库并登记一条任务；
 *  本服务在进程内轮询 `photo_tasks` 表，从 OSS 拉取原图，生成缩略图、预览图与
 *  详情页派生图（按原图体积五档缩放 + TLRphotos 水印 + WebP），回写 OSS 后更新照片记录。
 *
 *  实现红线（PRD 4.5.3）：
 *  - 不引入 Redis / 独立消息队列，队列即 SQLite 任务表 + 进程内 Worker；
 *  - 原图只在内存 Buffer 中处理，不写入 `backend/data/` 或任何持久目录；
 *  - 失败最多重试 3 次（指数退避），耗尽后标记 failed，详情页回退原图；
 *  - 用户端不等待处理完成，审核端在 pending/processing 状态下仍可正常审核。
 */
import crypto from 'crypto';
import sharp from 'sharp';
import type { Database } from 'sqlite';
import { getObjectBuffer, uploadBufferToOSS, deleteFromOSS } from './ossService';
import { renderWatermarkedImage } from './imageService';
import type { WatermarkConfig } from './imageService';

/** 任务状态 */
export type PhotoTaskStatus = 'pending' | 'processing' | 'done' | 'failed';

/** 单条任务记录 */
interface PhotoTaskRow {
  id: string;
  photo_id: string;
  original_key: string;
  status: PhotoTaskStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  derived_key: string | null;
  thumbnail_key: string | null;
  preview_key: string | null;
  watermarked_key: string | null;
  derived_width: number | null;
  derived_height: number | null;
  original_bytes: number | null;
  processing_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** 最大尝试次数：首次 + 3 次重试 */
const MAX_ATTEMPTS = 4;
/** 指数退避间隔：第 1/2/3 次重试前等待 30s / 2min / 10min */
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
/** Worker 轮询间隔 */
const POLL_INTERVAL_MS = 3_000;
/** 单次轮询最多处理的任务数，避免长时间占用事件循环 */
const MAX_TASKS_PER_TICK = 3;

/**
 * 按原图体积解析详情页加载比例（PRD 4.3，以手稿红笔为准）
 * | 0–500KB 100% | 500KB–1MB 80% | 1–5MB 60% | 5–10MB 50% | ≥10MB 40% |
 * @param originalBytes 原图字节数
 * @returns 0–1 之间的缩放比例
 */
export function resolveDetailScale(originalBytes: number): number {
  if (originalBytes <= 500 * 1024) return 1;
  if (originalBytes <= 1024 * 1024) return 0.8;
  if (originalBytes <= 5 * 1024 * 1024) return 0.6;
  if (originalBytes <= 10 * 1024 * 1024) return 0.5;
  return 0.4;
}

/** 由原图 Key 推导派生图 Key（沿用现有 thumbnails/previews/watermarked 目录约定） */
function deriveKey(originalKey: string, folder: string, suffix: string): string {
  const fileName = originalKey.split('/').pop() || '';
  const base = fileName.replace(/\.[^/.]+$/, '');
  return `photos/${folder}/${base}_${suffix}.webp`;
}

/** 异步处理是否启用（默认启用；off 时完成回调内联处理） */
export function isAsyncProcessingEnabled(): boolean {
  return (process.env.PHOTO_ASYNC_PROCESSING || '').trim().toLowerCase() !== 'off';
}

/**
 * 登记一条异步处理任务
 * @param db 主业务库
 * @param photoId 照片 ID
 * @param originalKey 原图 OSS Key
 * @param originalBytes 原图字节数
 * @returns 任务 ID
 */
export async function createPhotoTask(
  db: Database,
  photoId: string,
  originalKey: string,
  originalBytes: number,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO photo_tasks
      (id, photo_id, original_key, status, attempts, next_attempt_at, original_bytes, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [id, photoId, originalKey, now, originalBytes, now],
  );
  return id;
}

/** 释放 Buffer（显式清零，尽早归还操作系统） */
function disposeBuffer(buffer: Buffer | undefined | null): void {
  if (!buffer) return;
  try {
    (buffer as any).fill?.(0);
  } catch {
    /* ignore */
  }
}

/** 将任务标记为失败或安排下一次重试 */
async function scheduleRetryOrFail(
  db: Database,
  task: PhotoTaskRow,
  attempts: number,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  if (attempts < MAX_ATTEMPTS) {
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
    await db.run(
      `UPDATE photo_tasks
       SET status = 'pending', last_error = ?, next_attempt_at = ?
       WHERE id = ?`,
      [message.slice(0, 500), new Date(now + delay).toISOString(), task.id],
    );
    await db.run("UPDATE photos SET processing_status = 'pending' WHERE id = ?", [task.photo_id]);
    console.warn(
      `[PhotoProcess] 任务失败待重试 task=${task.id} photo=${task.photo_id} attempt=${attempts}: ${message}`,
    );
    return;
  }

  await db.run(
    `UPDATE photo_tasks
     SET status = 'failed', last_error = ?, finished_at = ?
     WHERE id = ?`,
    [message.slice(0, 500), new Date(now).toISOString(), task.id],
  );
  await db.run("UPDATE photos SET processing_status = 'failed' WHERE id = ?", [task.photo_id]);
  console.error(
    `[PhotoProcess] 任务重试耗尽标记失败 task=${task.id} photo=${task.photo_id}: ${message}`,
  );
}

/**
 * 处理指定任务（不含领取步骤，调用方需已把状态置为 processing）
 * @param db 主业务库
 * @param task 任务记录
 * @param attempts 当前尝试次数（含本次）
 */
async function processClaimedTask(db: Database, task: PhotoTaskRow, attempts: number): Promise<void> {
  const startedAt = Date.now();
  let originalBuffer: Buffer | undefined;
  let thumbnailBuffer: Buffer | undefined;
  let previewBuffer: Buffer | undefined;
  let detailBuffer: Buffer | undefined;

  try {
    const photo = await db.get<{
      id: string;
      watermark_config: string | null;
      width: number | null;
      height: number | null;
    }>('SELECT id, watermark_config, width, height FROM photos WHERE id = ?', [task.photo_id]);

    if (!photo) {
      throw new Error('照片记录不存在');
    }

    originalBuffer = (await getObjectBuffer(task.original_key)) ?? undefined;
    if (!originalBuffer) {
      throw new Error('原图对象不存在');
    }

    const originalBytes = originalBuffer.byteLength;
    const scale = resolveDetailScale(originalBytes);
    const metadata = await sharp(originalBuffer).metadata();
    const sourceWidth = metadata.width || 0;
    const sourceHeight = metadata.height || 0;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    // 三种派生图并行生成：缩略图 800、预览图 1200、详情图按五档比例缩放
    [thumbnailBuffer, previewBuffer, detailBuffer] = await Promise.all([
      sharp(originalBuffer)
        .rotate()
        .resize(800, 800, { fit: sharp.fit.inside, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
      sharp(originalBuffer)
        .rotate()
        .resize(1200, 1200, { fit: sharp.fit.inside, withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer(),
      sharp(originalBuffer)
        .rotate()
        .resize(targetWidth, targetHeight, { fit: sharp.fit.inside, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer(),
    ]);

    // 详情派生图叠加文字水印与底部信息条（配置随上传完成回调写入 photos.watermark_config）
    let watermarkConfig: WatermarkConfig | null = null;
    if (photo.watermark_config) {
      try {
        const parsed = JSON.parse(photo.watermark_config) as WatermarkConfig;
        if (parsed && (parsed.text || parsed.band)) watermarkConfig = parsed;
      } catch {
        watermarkConfig = null;
      }
    }

    let watermarked = false;
    if (watermarkConfig) {
      const withWatermark = await renderWatermarkedImage(detailBuffer, watermarkConfig);
      disposeBuffer(detailBuffer);
      detailBuffer = withWatermark;
      watermarked = true;
    }

    const thumbnailKey = task.thumbnail_key || deriveKey(task.original_key, 'thumbnails', 'thumb');
    const previewKey = task.preview_key || deriveKey(task.original_key, 'previews', 'preview');
    const detailKey = task.derived_key || deriveKey(task.original_key, 'detail', 'detail');

    await Promise.all([
      uploadBufferToOSS(thumbnailBuffer, thumbnailKey, 'image/webp'),
      uploadBufferToOSS(previewBuffer, previewKey, 'image/webp'),
      uploadBufferToOSS(detailBuffer, detailKey, 'image/webp'),
    ]);

    const actualMetadata = await sharp(detailBuffer).metadata();
    const actualWidth = actualMetadata.width || sourceWidth;
    const actualHeight = actualMetadata.height || sourceHeight;
    const processingMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();

    // 详情图即对外展示/下载的水印派生图；无配置时 watermarked_url 留空，回退预览/原图
    await db.run(
      `UPDATE photos
       SET thumbnail_path = ?, preview_url = ?, watermarked_url = ?, detail_key = ?,
           processing_status = 'done',
           width = CASE WHEN width IS NULL OR width = 0 THEN ? ELSE width END,
           height = CASE WHEN height IS NULL OR height = 0 THEN ? ELSE height END
       WHERE id = ?`,
      [
        thumbnailKey,
        previewKey,
        watermarked ? detailKey : '',
        detailKey,
        actualWidth,
        actualHeight,
        task.photo_id,
      ],
    );

    await db.run(
      `UPDATE photo_tasks
       SET status = 'done', derived_key = ?, thumbnail_key = ?, preview_key = ?,
           watermarked_key = ?, derived_width = ?, derived_height = ?,
           original_bytes = ?, processing_ms = ?, finished_at = ?
       WHERE id = ?`,
      [
        detailKey,
        thumbnailKey,
        previewKey,
        watermarked ? detailKey : null,
        actualWidth,
        actualHeight,
        originalBytes,
        processingMs,
        finishedAt,
        task.id,
      ],
    );

    console.log(
      `[PhotoProcess] 任务完成 task=${task.id} photo=${task.photo_id} ` +
        `${sourceWidth}x${sourceHeight} → ${actualWidth}x${actualHeight} (${originalBytes} bytes, ${processingMs}ms)`,
    );
  } catch (error) {
    await scheduleRetryOrFail(db, task, attempts, error);
  } finally {
    disposeBuffer(originalBuffer);
    disposeBuffer(thumbnailBuffer);
    disposeBuffer(previewBuffer);
    disposeBuffer(detailBuffer);
  }
}

/**
 * 领取并处理下一条到期任务
 * @param db 主业务库
 * @returns 是否处理了任务
 */
export async function processNextPhotoTask(db: Database): Promise<boolean> {
  const now = new Date().toISOString();
  const task = await db.get<PhotoTaskRow>(
    `SELECT * FROM photo_tasks
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [now],
  );
  if (!task) return false;

  // 原子领取：仅当仍为 pending 时更新成功，避免多轮询并发重复处理
  const claim = await db.run(
    `UPDATE photo_tasks
     SET status = 'processing', started_at = ?, attempts = attempts + 1
     WHERE id = ? AND status = 'pending'`,
    [now, task.id],
  );
  if (!claim.changes) return false;

  await db.run("UPDATE photos SET processing_status = 'processing' WHERE id = ?", [task.photo_id]);

  // 重新读取领取后的 attempts，作为本次尝试序号
  const fresh = await db.get<PhotoTaskRow>('SELECT * FROM photo_tasks WHERE id = ?', [task.id]);
  await processClaimedTask(db, fresh ?? task, (fresh ?? task).attempts);
  return true;
}

/**
 * 同步处理指定任务（`PHOTO_ASYNC_PROCESSING=off` 时的内联降级路径）
 * @param db 主业务库
 * @param taskId 任务 ID
 */
export async function processPhotoTaskNow(db: Database, taskId: string): Promise<void> {
  const now = new Date().toISOString();
  const claim = await db.run(
    `UPDATE photo_tasks
     SET status = 'processing', started_at = ?, attempts = attempts + 1
     WHERE id = ? AND status = 'pending'`,
    [now, taskId],
  );
  if (!claim.changes) return;
  const task = await db.get<PhotoTaskRow>('SELECT * FROM photo_tasks WHERE id = ?', [taskId]);
  if (!task) return;
  await db.run("UPDATE photos SET processing_status = 'processing' WHERE id = ?", [task.photo_id]);
  await processClaimedTask(db, task, task.attempts);
}

/** 服务重启时把中断的 processing 任务重置为 pending，避免任务永久卡死 */
export async function resetStuckPhotoTasks(db: Database): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.run(
    `UPDATE photo_tasks
     SET status = 'pending', next_attempt_at = ?
     WHERE status = 'processing'`,
    [now],
  );
  if (result.changes) {
    await db.run("UPDATE photos SET processing_status = 'pending' WHERE processing_status = 'processing'");
  }
  return result.changes || 0;
}

/**
 * 启动进程内 Worker（幂等：重复调用返回已存在的停止函数）
 * @param db 主业务库
 * @returns 停止函数
 */
export function startPhotoProcessWorker(db: Database): () => void {
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (let i = 0; i < MAX_TASKS_PER_TICK; i++) {
        const processed = await processNextPhotoTask(db);
        if (!processed) break;
      }
    } catch (error) {
      console.error('[PhotoProcess] Worker 轮询异常:', error);
    } finally {
      running = false;
    }
  };

  // 启动时先恢复中断任务，再立即处理一轮，之后固定间隔轮询
  resetStuckPhotoTasks(db)
    .then((count) => {
      if (count > 0) {
        console.log(`[PhotoProcess] 已重置 ${count} 条中断任务`);
      }
      tick();
    })
    .catch((error) => console.error('[PhotoProcess] 重置中断任务失败:', error));

  const timer = setInterval(tick, POLL_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * 清理超期的预签名上传凭证（每日作业调用）。
 * 对「已过期且未消费」的凭证，同时删除已直传到 OSS 但未完成落库的孤儿原图，
 * 避免用户中途放弃/完成回调失败导致对象长期占用存储。
 * @param db 主业务库
 * @returns 清理的凭证数量
 */
export async function cleanupExpiredUploadIntents(db: Database): Promise<number> {
  const now = new Date().toISOString();
  const orphans = await db.all<{ oss_key: string }[]>(
    'SELECT oss_key FROM photo_upload_intents WHERE expires_at < ? AND consumed_at IS NULL',
    [now],
  );
  for (const orphan of orphans) {
    try {
      await deleteFromOSS(orphan.oss_key);
    } catch (error) {
      console.warn(`[PhotoProcess] 清理孤儿原图失败 key=${orphan.oss_key}:`, error);
    }
  }
  const result = await db.run('DELETE FROM photo_upload_intents WHERE expires_at < ?', [now]);
  return result.changes || 0;
}

/**
 * 删除照片时清理其 OSS 派生对象与任务记录。
 * 仅删除由本服务生成的派生 Key；原图由调用方另行删除。
 */
export async function deletePhotoDerivedObjects(photo: {
  thumbnail_path?: string | null;
  preview_url?: string | null;
  watermarked_url?: string | null;
  detail_key?: string | null;
}): Promise<void> {
  const keys = [photo.thumbnail_path, photo.preview_url, photo.watermarked_url, photo.detail_key]
    .filter((key): key is string => Boolean(key))
    // 只删除衍生目录下的对象，避免待处理照片的 thumbnail_path 仍指向原图时误删原件
    .filter((key) =>
      ['photos/thumbnails/', 'photos/previews/', 'photos/detail/', 'photos/watermarked/'].some((prefix) =>
        key.startsWith(prefix),
      ),
    );
  for (const key of new Set(keys)) {
    try {
      await deleteFromOSS(key);
    } catch (error) {
      console.warn(`[PhotoProcess] 派生对象删除失败 key=${key}:`, error);
    }
  }
}
