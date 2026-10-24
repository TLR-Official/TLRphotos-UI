/**
 * @file 存量照片水印图重渲染脚本
 * @description 为历史照片重新生成带「底部黑色信息条」的水印图，用于 V4.5.0 功能上线后的数据补齐。
 *              流程：读取预览图（preview_url）→ renderWatermarkedImage（与上传流程同一实现）
 *              → 上传新的水印图对象 → 回写 photos.watermarked_url。
 *
 * 用法（在 backend 目录执行）：
 *   npx ts-node --transpile-only scripts/rerender-watermarks.ts --dry-run          # 只渲染不上传，预览尺寸
 *   npx ts-node --transpile-only scripts/rerender-watermarks.ts --limit 5          # 先跑 5 张验证
 *   npx ts-node --transpile-only scripts/rerender-watermarks.ts --concurrency 4    # 全量（默认 4）
 *
 * 安全约定：
 *   - 默认不覆盖旧水印对象，新对象在文件名后追加 `_band`，写库后旧对象仍可回溯
 *   - 已带 `_band` 后缀的对象视为已重渲染，直接跳过（幂等，可重复执行）
 *   - 外部图片（非本站 OSS 域名）与预览图缺失的记录跳过并计数
 */

// 必须作为第一个 import：ossService 在模块顶层读取环境变量，
// 若延后执行 dotenv.config() 会导致 OSS_BUCKET 为空（S3 报 "input HTTP label: Bucket"）
import 'dotenv/config';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import sharp from 'sharp';
import { getObjectBuffer, uploadBufferToOSS } from '../src/services/ossService';
import { renderWatermarkedImage, computeBandMetrics } from '../src/services/imageService';
import type { WatermarkConfig } from '../src/services/imageService';

/** 本站 OSS 域名前缀，用于把存量签名 URL 还原为纯 Key */
const OSS_DOMAIN = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
/** 重渲染后的水印对象文件名后缀，兼作幂等标记 */
const BAND_SUFFIX = '_band';
/** 第一行固定站名 */
const SITE_NAME = 'TLRphotos';
/** 用户名缺失时的著作权人兜底文案 */
const FALLBACK_OWNER = 'TLRphotos 用户';

interface PhotoRow {
  id: string;
  user_id: string | null;
  username: string | null;
  preview_url: string | null;
  original_url: string | null;
  watermarked_url: string | null;
  watermark_config: string | null;
}

interface TaskResult {
  id: string;
  status: 'ok' | 'skipped' | 'failed';
  detail?: string;
}

/** CLI 参数解析：--dry-run / --limit N / --concurrency N */
function parseArgs() {
  const argv = process.argv.slice(2);
  const getNum = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    if (i < 0) return fallback;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    limit: getNum('--limit', 0),
    concurrency: getNum('--concurrency', 4),
  };
}

/** 把存量签名 URL 或 Key 统一还原为 OSS Key；外部资源返回 null */
function toOssKey(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    if (!value.startsWith(OSS_DOMAIN)) return null;
    return value.slice(OSS_DOMAIN.length).split('?')[0];
  }
  return value;
}

/** 由旧水印 Key 推导新 Key：`xxx_watermarked.webp` → `xxx_watermarked_band.webp` */
function deriveBandKey(oldKey: string | null, previewKey: string): string {
  if (oldKey && oldKey.endsWith('.webp')) {
    return oldKey.replace(/\.webp$/, `${BAND_SUFFIX}.webp`);
  }
  const base = path.posix.basename(previewKey).replace(/\.webp$/, '');
  return `photos/watermarked/${base.replace(/_preview$/, '')}_watermarked${BAND_SUFFIX}.webp`;
}

/** 由库中 watermark_config 组装渲染配置，补齐 band 字段（历史数据无 band） */
function buildConfig(rawConfig: string | null, username: string | null): WatermarkConfig {
  let parsed: Partial<WatermarkConfig> = {};
  try {
    parsed = JSON.parse(rawConfig || '{}') as Partial<WatermarkConfig>;
  } catch {
    parsed = {};
  }
  return {
    text: parsed.text || SITE_NAME,
    x: typeof parsed.x === 'number' ? parsed.x : 50,
    y: typeof parsed.y === 'number' ? parsed.y : 50,
    opacity: typeof parsed.opacity === 'number' ? parsed.opacity : 0.6,
    size: typeof parsed.size === 'number' ? parsed.size : 32,
    band: {
      siteName: SITE_NAME,
      ownerName: username || FALLBACK_OWNER,
      year: new Date().getFullYear(),
    },
  };
}

/** 处理单张照片：取预览图 → 渲染 → 上传 → 回写（dry-run 时止于渲染） */
async function rerenderOne(
  db: Awaited<ReturnType<typeof open>>,
  row: PhotoRow,
  dryRun: boolean,
): Promise<TaskResult> {
  const previewKey = toOssKey(row.preview_url) ?? toOssKey(row.original_url);
  if (!previewKey) {
    return { id: row.id, status: 'skipped', detail: '预览图非本站 OSS 资源' };
  }
  const oldKey = toOssKey(row.watermarked_url);
  if (oldKey?.includes(`${BAND_SUFFIX}.webp`)) {
    return { id: row.id, status: 'skipped', detail: '已是重渲染版本' };
  }

  const previewBuffer = await getObjectBuffer(previewKey);
  if (!previewBuffer) {
    return { id: row.id, status: 'failed', detail: `预览图不存在：${previewKey}` };
  }

  const config = buildConfig(row.watermark_config, row.username);
  const outBuffer = await renderWatermarkedImage(previewBuffer, config);
  const outMeta = await sharp(outBuffer).metadata();

  if (dryRun) {
    const srcMeta = await sharp(previewBuffer).metadata();
    const metrics = computeBandMetrics(srcMeta.width ?? 0, srcMeta.height ?? 0);
    const expectedHeight = (srcMeta.height ?? 0) + metrics.bandHeight;
    const ok = outMeta.height === expectedHeight && outMeta.width === srcMeta.width;
    return {
      id: row.id,
      status: ok ? 'ok' : 'failed',
      detail: `dry-run ${srcMeta.width}x${srcMeta.height} → ${outMeta.width}x${outMeta.height}（期望高 ${expectedHeight}）`,
    };
  }

  const newKey = deriveBandKey(oldKey, previewKey);
  await uploadBufferToOSS(outBuffer, newKey, 'image/webp');
  // 仅存 Key：代理层按需签名，避免历史签名过期导致的死链，且删除时可按 Key 清理对象
  await db.run('UPDATE photos SET watermarked_url = ? WHERE id = ?', newKey, row.id);
  return {
    id: row.id,
    status: 'ok',
    detail: `${outMeta.width}x${outMeta.height} → ${newKey}`,
  };
}

async function main() {
  const { dryRun, limit, concurrency } = parseArgs();
  const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../data/database.db');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  console.log(`[Rerender] 数据库: ${dbPath}`);
  console.log(`[Rerender] 模式: ${dryRun ? 'dry-run（不上传、不写库）' : '写入'} | 并发: ${concurrency}${limit ? ` | 上限: ${limit}` : ''}`);

  const rows = (await db.all(
    `SELECT p.id, p.user_id, p.preview_url, p.original_url, p.watermarked_url,
            p.watermark_config, u.username
       FROM photos p
       LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.id ASC`,
  )) as PhotoRow[];
  const targets = limit > 0 ? rows.slice(0, limit) : rows;
  console.log(`[Rerender] 待处理: ${targets.length} / ${rows.length} 条`);

  const results: TaskResult[] = [];
  let cursor = 0;
  // 固定并发池：每批并发抓取 + 渲染，批内 DB 回写串行
  while (cursor < targets.length) {
    const batch = targets.slice(cursor, cursor + concurrency);
    cursor += batch.length;
    const batchResults = await Promise.all(
      batch.map((row) =>
        rerenderOne(db, row, dryRun).catch((err): TaskResult => ({
          id: row.id,
          status: 'failed',
          detail: err instanceof Error ? err.message : String(err),
        })),
      ),
    );
    results.push(...batchResults);
    const done = results.filter((r) => r.status === 'ok').length;
    console.log(`[Rerender] 进度 ${results.length}/${targets.length}（成功 ${done}）`);
  }

  const ok = results.filter((r) => r.status === 'ok');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`\n[Rerender] 完成：成功 ${ok.length}，跳过 ${skipped.length}，失败 ${failed.length}`);
  for (const s of skipped) console.log(`  SKIP ${s.id}: ${s.detail}`);
  for (const f of failed) console.log(`  FAIL ${f.id}: ${f.detail}`);

  await db.close();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[Rerender] 脚本异常:', err);
  process.exit(1);
});
