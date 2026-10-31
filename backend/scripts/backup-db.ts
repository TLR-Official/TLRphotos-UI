/**
 * @file backup-db.ts（V4.9.0）
 * @description SQLite 一致性备份：使用 VACUUM INTO 生成主库与标签库快照，
 *  备份后执行 PRAGMA integrity_check 与基础计数校验，并按保留份数清理最旧备份。
 *  用法：node -r ts-node/register/transpile-only scripts/backup-db.ts [--keep N]
 *  建议由 systemd timer 每日执行（见 tlrphotos-backup.timer）。
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

/** 数据目录（与 db.ts 保持一致：默认 backend/data，可用 DB_PATH 覆盖主库） */
const DATA_DIR = path.join(__dirname, '../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/** 保留份数（默认 14 份，约两周） */
function resolveKeepCount(): number {
  const argIndex = process.argv.indexOf('--keep');
  const raw = argIndex >= 0 ? process.argv[argIndex + 1] : process.env.BACKUP_KEEP;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 14;
}

/** 时间戳：YYYYMMDD-HHmmss（按名称即按时间排序） */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 转义 SQL 字符串字面量中的单引号 */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** 清理超出保留份数的旧备份（按文件名升序删除最旧） */
function pruneBackups(keep: number): void {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^(database|tags)-.+\.db$/.test(name))
    .sort();
  const overflow = files.length - keep;
  if (overflow <= 0) return;
  for (const name of files.slice(0, overflow)) {
    fs.unlinkSync(path.join(BACKUP_DIR, name));
    console.log(`[Backup] 已清理旧备份: ${name}`);
  }
}

/**
 * 备份单个数据库并校验。
 * @param label 备份前缀（database / tags）
 * @param sourcePath 源库路径
 * @returns 备份文件路径与校验结果
 */
async function backupOne(label: string, sourcePath: string): Promise<{ file: string; integrity: string; rows: number | null }> {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源数据库不存在: ${sourcePath}`);
  }
  const target = path.join(BACKUP_DIR, `${label}-${timestamp()}.db`);

  const source = await open({ filename: sourcePath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    // VACUUM INTO 生成一致性快照（WAL 模式下同样安全，不阻塞常规读）
    await source.exec(`VACUUM INTO ${sqlLiteral(target)}`);
  } finally {
    await source.close();
  }

  const verify = await open({ filename: target, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    const check = (await verify.get('PRAGMA integrity_check')) as { integrity_check?: string } | undefined;
    const integrity = check?.integrity_check ?? 'unknown';
    if (integrity !== 'ok') {
      throw new Error(`备份完整性校验失败 (${label}): ${integrity}`);
    }
    let rows: number | null = null;
    if (label === 'database') {
      const row = (await verify.get('SELECT COUNT(*) AS c FROM users')) as { c?: number } | undefined;
      rows = row?.c ?? null;
    }
    const size = fs.statSync(target).size;
    console.log(
      `[Backup] ${label} 备份完成: ${path.basename(target)} (${(size / 1024 / 1024).toFixed(2)}MB, integrity=ok${rows !== null ? `, users=${rows}` : ''})`
    );
    return { file: target, integrity, rows };
  } finally {
    await verify.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const keep = resolveKeepCount();

  const mainDbPath = process.env.DB_PATH ?? path.join(DATA_DIR, 'database.db');
  const tagsDbPath = path.join(DATA_DIR, 'tags.db');

  const results = [];
  results.push(await backupOne('database', mainDbPath));
  results.push(await backupOne('tags', tagsDbPath));

  pruneBackups(keep);
  console.log(`[Backup] 完成：${results.length} 个库已备份并校验，保留最近 ${keep} 份，目录 ${BACKUP_DIR}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[Backup] 失败:', error);
    process.exit(1);
  });
