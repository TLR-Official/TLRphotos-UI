/**
 * @file column.ts
 * @description 专栏信息路由模块。
 *              提供专栏基础信息的查询接口。
 *              系统中专栏为单条记录（id 固定为 column_001），用于展示专栏名称、简介与封面。
 */
import express from 'express';
import { db } from '../db';

const router = express.Router();

/**
 * 获取专栏信息。
 * 查询 column_info 表中固定 ID 为 column_001 的记录并返回。
 * 若记录不存在则返回 404。
 */
router.get('/', async (req, res) => {
  try {
    const column = await db.get('SELECT * FROM column_info WHERE id = ?', 'column_001') as {
      id: string;
      name: string;
      description: string;
      cover_image: string;
    } | undefined;

    if (!column) {
      return res.status(404).json({ success: false, message: '专栏信息不存在' });
    }

    res.json({ success: true, data: column });
  } catch (error) {
    console.error('Error fetching column:', error);
    res.status(500).json({ success: false, message: '获取专栏信息失败' });
  }
});

export default router;
