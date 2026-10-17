/**
 * @file about.ts
 * @description 关于我们路由模块（V4.0.0，Task 7.1）。
 *              提供公开的站点统计数据（运行天数、已通过作品数），
 *              供"关于我们"页面展示。无鉴权，仅聚合只读统计。
 */
import express from 'express';
import { db } from '../db';

const router = express.Router();

/** 站点上线日（V1.0.0 正式发布日），运行天数以此为起点计算 */
const SITE_LAUNCH_DATE = '2026-08-15';

/**
 * 获取站点公开统计（公开无鉴权）。
 * site_days = floor((now - 上线日) / 86400000) + 1（上线当日计第 1 天）；
 * approved_count = status=approved 的照片总数。
 */
router.get('/stats', async (req, res) => {
  try {
    const siteDays = Math.floor((Date.now() - new Date(SITE_LAUNCH_DATE).getTime()) / 86400000) + 1;
    const row = await db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM photos WHERE status = 'approved'"
    );

    res.json({
      success: true,
      data: {
        site_days: siteDays,
        approved_count: row?.c ?? 0,
      },
    });
  } catch (error) {
    console.error('Error fetching about stats:', error);
    res.status(500).json({ success: false, message: '获取站点统计失败' });
  }
});

export default router;
