/**
 * @file tags.ts
 * @description 标签库路由模块。
 *              提供标签分类、对象、属性三级结构的只读查询接口。
 *              数据源为独立的 tagsDb（与主业务库分离），用于照片结构化标签的元数据定义。
 */
import express from 'express';
import { tagsDb } from '../db/tagsDb';

const router = express.Router();

/**
 * 获取所有标签分类列表。
 * 返回 tag_categories 表全量数据，作为结构化标签的顶层入口。
 */
router.get('/', async (req, res) => {
  try {
    const categories = await tagsDb.all('SELECT * FROM tag_categories');
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, message: '获取分类失败' });
  }
});

/**
 * 获取指定分类下的对象及其属性。
 * 三级嵌套查询：分类 → 对象列表 → 每个对象的属性列表。
 * 属性的 options 字段以 JSON 字符串存储，返回时解析为数组。
 * @param categoryId 分类 ID
 */
router.get('/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;

    const category = await tagsDb.get('SELECT * FROM tag_categories WHERE id = ?', categoryId);
    if (!category) {
      return res.status(404).json({ success: false, message: '分类不存在' });
    }

    const objects = await tagsDb.all('SELECT * FROM tag_objects WHERE category_id = ?', categoryId);

    // 逐对象并行查询其属性列表，构造嵌套结构
    const objectsWithAttributes = await Promise.all(objects.map(async (obj: any) => {
      const attributes = await tagsDb.all('SELECT * FROM tag_attributes WHERE object_id = ?', obj.id);
      return {
        ...obj,
        attributes: attributes.map((attr: any) => ({
          ...attr,
          // options JSON 字符串反序列化为数组，便于前端渲染
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

/**
 * 获取指定分类下的对象列表（不含属性）。
 * 用于仅需对象元数据的轻量场景，避免属性嵌套查询的开销。
 * @param categoryId 分类 ID
 */
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

/**
 * 获取指定对象的属性列表。
 * 单对象粒度属性查询，options JSON 字符串反序列化为数组。
 * @param categoryId 分类 ID（URL 路径占位，实际未使用）
 * @param objectId 对象 ID
 */
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
