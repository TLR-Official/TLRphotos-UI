/**
 * @file 存量照片航空器信息回填脚本（V4.6.0）
 * @description 对已入库但未识别机型的照片，按 registration_number 批量查询第三方航空器库，
 *              回写 photos.aircraft_type / photos.airline。查询走 aircraftLookupService，
 *              与上传流程同一 provider 链与本地缓存（aircraft_cache）。
 *
 * 用法（在 backend 目录执行）：
 *   npx ts-node --transpile-only scripts/backfill-aircraft-info.ts --dry-run        # 只查询不写库
 *   npx ts-node --transpile-only scripts/backfill-aircraft-info.ts --limit 5        # 先跑 5 条验证
 *   npx ts-node --transpile-only scripts/backfill-aircraft-info.ts --concurrency 4  # 全量（默认 4）
 *
 * 安全约定：
 *   - 默认只处理 aircraft_type 为空（NULL 或 ''）且注册号非空的记录，已识别的不会覆盖（幂等，可重复执行）
 *   - 未收录/上游异常的记录保持原样，不写入空值，便于下次重试
 *   - --dry-run 不产生任何数据库写入
 */

// 必须作为第一个 import：服务模块在顶层读取环境变量
import 'dotenv/config';
import { initDb, db } from '../src/db';
import { lookupAircraft } from '../src/services/aircraftLookupService';

interface PhotoRow {
  id: string;
  registration_number: string;
}

interface TaskResult {
  id: string;
  registration: string;
  status: 'ok' | 'miss' | 'failed';
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
    concurrency: Math.max(1, getNum('--concurrency', 2)),
  };
}

/** 按批并发处理，避免一次性向上游发起过多请求 */
async function runBatch<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(worker))));
  }
  return results;
}

async function main() {
  const { dryRun, limit, concurrency } = parseArgs();
  await initDb();

  const rows = await db.all<PhotoRow[]>(
    `SELECT id, registration_number FROM photos
      WHERE registration_number IS NOT NULL
        AND TRIM(registration_number) <> ''
        AND (aircraft_type IS NULL OR aircraft_type = '')
      ORDER BY created_at ASC
      ${limit > 0 ? `LIMIT ${limit}` : ''}`,
  );

  console.log(`[Backfill] 待处理 ${rows.length} 条（dryRun=${dryRun}, concurrency=${concurrency}）`);
  if (rows.length === 0) return;

  let updated = 0;
  let missed = 0;
  let failed = 0;

  const results = await runBatch<PhotoRow, TaskResult>(rows, concurrency, async (row) => {
    try {
      const info = await lookupAircraft(row.registration_number);
      if (!info) {
        console.log(`  - ${row.id} ${row.registration_number}: 未收录`);
        return { id: row.id, registration: row.registration_number, status: 'miss' };
      }
      if (!dryRun) {
        await db.run(
          'UPDATE photos SET aircraft_type = ?, airline = ? WHERE id = ?',
          info.aircraftType || '',
          info.airline || '',
          row.id,
        );
      }
      console.log(`  - ${row.id} ${row.registration_number}: ${info.aircraftType} / ${info.airline || '未知航司'}`);
      return { id: row.id, registration: row.registration_number, status: 'ok' };
    } catch (error) {
      console.error(`  - ${row.id} ${row.registration_number}: 失败`, error instanceof Error ? error.message : error);
      return { id: row.id, registration: row.registration_number, status: 'failed' };
    }
  });

  for (const r of results) {
    if (r.status === 'ok') updated += 1;
    else if (r.status === 'miss') missed += 1;
    else failed += 1;
  }

  console.log(
    `[Backfill] 完成：${dryRun ? '可更新' : '已更新'} ${updated} 条，未收录 ${missed} 条，失败 ${failed} 条`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[Backfill] 脚本异常退出:', error);
    process.exit(1);
  });
