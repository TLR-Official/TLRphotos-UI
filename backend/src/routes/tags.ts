import express from 'express';
import { tagsDb } from '../db/tagsDb';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const categories = await tagsDb.all('SELECT * FROM tag_categories');
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, message: '获取分类失败' });
  }
});

router.get('/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;

    const category = await tagsDb.get('SELECT * FROM tag_categories WHERE id = ?', categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: '分类不存在' });
    }

    const objects = await tagsDb.all('SELECT * FROM tag_objects WHERE category_id = ?', categoryId);

    const objectsWithAttributes = await Promise.all(objects.map(async (obj: any) => {
      const attributes = await tagsDb.all('SELECT * FROM tag_attributes WHERE object_id = ?', obj.id);
      return {
        ...obj,
        attributes: attributes.map((attr: any) => ({
          ...attr,
          options: attr.options ? JSON.parse(attr.options) : [],
        })),
      };
    }));

    res.json({
      success: true,
      data: {
        category,
        objects: objectsWithAttributes,
      },
    });
  } catch (error) {
    console.error('Error fetching category tags:', error);
    res.status(500).json({ success: false, message: '获取标签失败' });
  }
});

router.get('/:categoryId/objects', async (req, res) => {
  try {
    const { categoryId } = req.params;

    const objects = await tagsDb.all('SELECT * FROM tag_objects WHERE category_id = ?', categoryId);
    res.json({ success: true, data: objects });
  } catch (error) {
    console.error('Error fetching objects:', error);
    res.status(500).json({ success: false, message: '获取对象失败' });
  }
});

router.get('/:categoryId/objects/:objectId/attributes', async (req, res) => {
  try {
    const { objectId } = req.params;

    const attributes = await tagsDb.all('SELECT * FROM tag_attributes WHERE object_id = ?', objectId);
    res.json({
      success: true,
      data: attributes.map((attr: any) => ({
        ...attr,
        options: attr.options ? JSON.parse(attr.options) : [],
      })),
    });
  } catch (error) {
    console.error('Error fetching attributes:', error);
    res.status(500).json({ success: false, message: '获取属性失败' });
  }
});

export default router;
