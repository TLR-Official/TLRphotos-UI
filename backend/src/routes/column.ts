import express from 'express';
import { db } from '../db';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const column = db.prepare('SELECT * FROM column_info WHERE id = ?').get('column_001') as {
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
