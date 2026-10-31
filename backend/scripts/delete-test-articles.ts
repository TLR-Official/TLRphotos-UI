/**
 * @file delete-test-articles.ts（V4.8.0，一次性清理脚本）
 * @description 删除历史演示/测试文章（article_001 ~ article_005）及其评论、热度、
 *  归档索引与点赞记录，并尽力清理归档 OSS 对象。幂等，可重复执行。
 *  用法：npx ts-node --transpile-only scripts/delete-test-articles.ts [--dry-run]
 *  注意：ossService 顶层读取环境变量，首行必须加载 dotenv。
 */
import 'dotenv/config';
import { db, initDb } from '../src/db';
import { deleteFromOSS } from '../src/services/ossService';

/** 待清理的测试文章 ID（均为 type=column 的历史演示文章） */
const TEST_ARTICLE_IDS = ['article_001', 'article_002', 'article_003', 'article_004', 'article_005'];

const DRY_RUN = process.argv.includes('--dry-run');

/** 生成 SQL IN 占位符 */
function inClause(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

async function main(): Promise<void> {
  // db 实例由 initDb 创建；迁移与 seed 均幂等，文章/评论表非空不会重新插入演示数据
  await initDb();

  const placeholders = inClause(TEST_ARTICLE_IDS.length);

  const articles = await db.all<{ id: string; title: string; type: string }>(
    `SELECT id, title, type FROM articles WHERE id IN (${placeholders})`,
    TEST_ARTICLE_IDS
  );
  const comments = await db.all<{ id: string; root_id: string }>(
    `SELECT id, root_id FROM comments WHERE subject_type = 'article' AND subject_id IN (${placeholders})`,
    TEST_ARTICLE_IDS
  );
  const archives = await db.all<{ root_id: string; oss_key: string }>(
    `SELECT root_id, oss_key FROM comment_archives WHERE subject_type = 'article' AND subject_id IN (${placeholders})`,
    TEST_ARTICLE_IDS
  );

  console.log('[DeleteTestArticles] 待删除文章:', articles.length, articles.map((a) => `${a.id}(${a.type}) ${a.title}`));
  console.log('[DeleteTestArticles] 关联评论:', comments.length, '归档索引:', archives.length);

  if (DRY_RUN) {
    console.log('[DeleteTestArticles] dry-run：未写入任何变更');
    return;
  }

  const commentIds = comments.map((c) => c.id);
  const rootIds = Array.from(new Set([...commentIds, ...comments.map((c) => c.root_id), ...archives.map((a) => a.root_id)]));

  await db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    if (commentIds.length > 0) {
      await db.run(`DELETE FROM comment_likes WHERE comment_id IN (${inClause(commentIds.length)})`, commentIds);
    }
    if (rootIds.length > 0) {
      const rootPlaceholders = inClause(rootIds.length);
      await db.run(`DELETE FROM comment_heat WHERE root_id IN (${rootPlaceholders})`, rootIds);
      await db.run(`DELETE FROM comment_archives WHERE root_id IN (${rootPlaceholders})`, rootIds);
    }
    if (commentIds.length > 0) {
      await db.run(`DELETE FROM comments WHERE id IN (${inClause(commentIds.length)})`, commentIds);
    }
    await db.run(`DELETE FROM article_likes WHERE article_id IN (${placeholders})`, TEST_ARTICLE_IDS);
    await db.run(`DELETE FROM articles WHERE id IN (${placeholders})`, TEST_ARTICLE_IDS);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  // 归档 OSS 对象尽力清理（失败仅告警，不影响数据库已完成的清理）
  for (const archive of archives) {
    try {
      await deleteFromOSS(archive.oss_key);
      console.log('[DeleteTestArticles] 已删除归档对象:', archive.oss_key);
    } catch (error) {
      console.warn('[DeleteTestArticles] 归档对象删除失败（需人工确认）:', archive.oss_key, error);
    }
  }

  console.log('[DeleteTestArticles] 完成：文章、评论、热度、归档索引与点赞已清理');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[DeleteTestArticles] 失败:', error);
    process.exit(1);
  });
