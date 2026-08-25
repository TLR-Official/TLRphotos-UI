/**
 * @file 数据一致性验证脚本（V1.5.0 新增）
 * @usage npx tsx src/scripts/check-data-consistency.ts
 * @description 清理操作后或常规巡检时运行，验证关键数据完整性。
 *              退出码：0=全部通过，1=存在异常
 *              保留此脚本作为可重复运行的巡检工具。
 */
import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DB_PATH = '/opt/tlr-photos-ui/TLRphotos-UI/backend/data/database.db';

async function main() {
  console.log('=== 数据一致性验证 ===\n');

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  const checks: { name: string; sql: string; expect: number }[] = [
    { name: 'photos.user_id IS NULL', sql: 'SELECT COUNT(*) as cnt FROM photos WHERE user_id IS NULL', expect: 0 },
    { name: "photo_likes.user_id='anonymous'", sql: "SELECT COUNT(*) as cnt FROM photo_likes WHERE user_id='anonymous'", expect: 0 },
    { name: "article_likes.user_id='anonymous'", sql: "SELECT COUNT(*) as cnt FROM article_likes WHERE user_id='anonymous'", expect: 0 },
    {
      name: "photo_views.viewer_key 非 user/ip 前缀",
      sql: "SELECT COUNT(*) as cnt FROM photo_views WHERE viewer_key NOT LIKE 'user:%' AND viewer_key NOT LIKE 'ip:%'",
      expect: 0,
    },
    {
      name: "photos.status 非 approved/pending/rejected",
      sql: "SELECT COUNT(*) as cnt FROM photos WHERE status NOT IN ('approved','pending','rejected')",
      expect: 0,
    },
    {
      name: "photo_likes 中孤儿记录（photo_id 不在 photos 表）",
      sql: "SELECT COUNT(*) as cnt FROM photo_likes pl LEFT JOIN photos p ON pl.photo_id = p.id WHERE p.id IS NULL",
      expect: 0,
    },
    {
      name: "photo_views 中孤儿记录（photo_id 不在 photos 表）",
      sql: "SELECT COUNT(*) as cnt FROM photo_views pv LEFT JOIN photos p ON pv.photo_id = p.id WHERE p.id IS NULL",
      expect: 0,
    },
  ];

  let allPassed = true;
  for (const c of checks) {
    try {
      const row = await db.get<{ cnt: number }>(c.sql);
      const actual = row?.cnt ?? -1;
      const passed = actual === c.expect;
      console.log(`${passed ? '✓' : '✗'} ${c.name}: expected=${c.expect}, actual=${actual}`);
      if (!passed) allPassed = false;
    } catch (e) {
      console.log(`✗ ${c.name}: 查询失败 - ${e instanceof Error ? e.message : e}`);
      allPassed = false;
    }
  }

  console.log(allPassed ? '\n✅ 所有一致性检查通过' : '\n❌ 存在异常，请排查');
  await db.close();
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error('验证脚本执行失败:', e);
  process.exit(1);
});
