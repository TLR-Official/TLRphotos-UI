import express from 'express';
import { db } from '../db';
import { generatePresignedUploadUrl, completeUpload } from '../services/ossService';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const photos = await db.all('SELECT id, title, thumbnail_path, tags, width, height, created_at FROM photos ORDER BY created_at DESC');

    const result = photos.map((photo: any) => {
      let tags: string[] = [];
      if (photo.tags) {
        try {
          tags = JSON.parse(photo.tags);
        } catch {
          tags = photo.tags.split(' ').filter(Boolean);
        }
      }
      return { ...photo, tags };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ success: false, message: '获取照片列表失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const photo = await db.get('SELECT * FROM photos WHERE id = ?', id);

    if (!photo) {
      return res.status(404).json({ success: false, message: '照片不存在' });
    }

    res.json({
      success: true,
      data: {
        ...photo,
        tags: photo.tags ? JSON.parse(photo.tags) : [],
      },
    });
  } catch (error) {
    console.error('Error fetching photo:', error);
    res.status(500).json({ success: false, message: '获取照片详情失败' });
  }
});

router.post('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'anonymous' } = req.body || {};

    const existingLike = await db.get('SELECT * FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, userId);

    if (existingLike) {
      const currentPhoto = await db.get('SELECT likes FROM photos WHERE id = ?', id);
      return res.json({ success: true, data: { likes: currentPhoto?.likes || 0 } });
    }

    await db.run('INSERT INTO photo_likes (photo_id, user_id) VALUES (?, ?)', id, userId);
    await db.run('UPDATE photos SET likes = likes + 1 WHERE id = ?', id);
    const updatedPhoto = await db.get('SELECT likes FROM photos WHERE id = ?', id);

    res.json({ success: true, data: { likes: updatedPhoto?.likes || 0 } });
  } catch (error) {
    console.error('Error liking photo:', error);
    res.status(500).json({ success: false, message: '点赞失败' });
  }
});

router.delete('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'anonymous' } = req.body || {};

    const existingLike = await db.get('SELECT * FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, userId);

    if (!existingLike) {
      const currentPhoto = await db.get('SELECT likes FROM photos WHERE id = ?', id);
      return res.json({ success: true, data: { likes: currentPhoto?.likes || 0 } });
    }

    await db.run('DELETE FROM photo_likes WHERE photo_id = ? AND user_id = ?', id, userId);
    await db.run('UPDATE photos SET likes = MAX(0, likes - 1) WHERE id = ?', id);
    const updatedPhoto = await db.get('SELECT likes FROM photos WHERE id = ?', id);

    res.json({ success: true, data: { likes: updatedPhoto?.likes || 0 } });
  } catch (error) {
    console.error('Error unliking photo:', error);
    res.status(500).json({ success: false, message: '取消点赞失败' });
  }
});

router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    await db.run('UPDATE photos SET views = views + 1 WHERE id = ?', id);
    const updatedPhoto = await db.get('SELECT views FROM photos WHERE id = ?', id);

    res.json({ success: true, data: { views: updatedPhoto?.views || 0 } });
  } catch (error) {
    console.error('Error incrementing view:', error);
    res.status(500).json({ success: false, message: '更新浏览量失败' });
  }
});

router.post('/upload/presigned', async (req, res) => {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ success: false, message: '文件名不能为空' });
    }

    const presignedUrl = await generatePresignedUploadUrl(fileName);

    res.json({
      success: true,
      data: {
        uploadUrl: presignedUrl.url,
        key: presignedUrl.key,
      },
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ success: false, message: '生成上传地址失败' });
  }
});

router.post('/upload/complete', async (req, res) => {
  try {
    const { key, title, tags, description, camera_model, vehicle, location, altitude, focal_length, iso, shutter_speed, aperture, width, height } = req.body;

    if (!key) {
      return res.status(400).json({ success: false, message: '文件Key不能为空' });
    }

    const uploadResult = await completeUpload(key);

    const newPhoto = {
      id: `photo_${Date.now()}`,
      title: title || '未命名照片',
      thumbnail_path: uploadResult.thumbnailUrl,
      original_url: uploadResult.url,
      tags: tags ? JSON.stringify(Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : '[]',
      width: width || 0,
      height: height || 0,
      description: description || '',
      camera_model: camera_model || '',
      vehicle: vehicle || '',
      location: location || '',
      altitude: altitude || 0,
      focal_length: focal_length || '',
      iso: iso || 0,
      shutter_speed: shutter_speed || '',
      aperture: aperture || '',
      likes: 0,
      views: 0,
      created_at: new Date().toISOString(),
    };

    await db.run(
      'INSERT INTO photos (id, title, thumbnail_path, original_url, tags, width, height, description, camera_model, vehicle, location, altitude, focal_length, iso, shutter_speed, aperture, likes, views, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newPhoto.id,
      newPhoto.title,
      newPhoto.thumbnail_path,
      newPhoto.original_url,
      newPhoto.tags,
      newPhoto.width,
      newPhoto.height,
      newPhoto.description,
      newPhoto.camera_model,
      newPhoto.vehicle,
      newPhoto.location,
      newPhoto.altitude,
      newPhoto.focal_length,
      newPhoto.iso,
      newPhoto.shutter_speed,
      newPhoto.aperture,
      newPhoto.likes,
      newPhoto.views,
      newPhoto.created_at
    );

    res.json({
      success: true,
      data: {
        photoId: newPhoto.id,
        key: uploadResult.key,
        url: uploadResult.url,
        thumbnailUrl: uploadResult.thumbnailUrl,
      },
    });
  } catch (error) {
    console.error('Error completing upload:', error);
    res.status(500).json({ success: false, message: '上传完成处理失败' });
  }
});

export default router;
