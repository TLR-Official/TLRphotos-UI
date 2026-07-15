import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { generatePresignedUploadUrl, completeUpload, getFileUrl, deleteFromOSS } from '../services/ossService';
import { processImage, uploadProcessedImages, WatermarkConfig } from '../services/imageService';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 JPG、PNG、WebP、HEIC 格式'));
    }
  },
});

const handleUploadError = (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, message: '文件大小超过限制（最大50MB）' });
    } else {
      res.status(400).json({ success: false, message: '上传错误: ' + err.message });
    }
  } else if (err instanceof Error) {
    res.status(400).json({ success: false, message: err.message });
  } else {
    next(err);
  }
};

router.get('/search', async (req, res) => {
  try {
    const { keyword, tag, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    let query = 'SELECT id, title, thumbnail_path, tags, width, height, likes, views, created_at FROM photos';
    const params: any[] = [];
    const conditions: string[] = [];

    if (keyword) {
      conditions.push('(title LIKE ? OR description LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${tag}"%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const validSortBy = ['created_at', 'likes', 'views', 'title'];
    const validSortOrder = ['asc', 'desc'];
    const safeSortBy = validSortBy.includes(String(sortBy)) ? sortBy : 'created_at';
    const safeSortOrder = validSortOrder.includes(String(sortOrder)) ? sortOrder : 'desc';

    query += ` ORDER BY ${safeSortBy} ${safeSortOrder}`;

    const photos = await db.all(query, params);

    const result = await Promise.all(photos.map(async (photo: any) => {
      let tags: string[] = [];
      if (photo.tags) {
        try {
          tags = JSON.parse(photo.tags);
        } catch {
          tags = photo.tags.split(' ').filter(Boolean);
        }
      }
      const getProxyUrl = (key: string) => {
        if (key.startsWith('http://') || key.startsWith('https://')) {
          const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
          if (key.startsWith(ossDomain)) {
            const filePath = key.replace(ossDomain, '').split('?')[0];
            return `/api/photos/image/${encodeURIComponent(filePath)}`;
          }
          return key;
        }
        return `/api/photos/image/${encodeURIComponent(key)}`;
      };
      const thumbnailUrl = getProxyUrl(photo.thumbnail_path);
      return { ...photo, tags, thumbnail_path: thumbnailUrl };
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error searching photos:', error);
    res.status(500).json({ success: false, message: '搜索照片失败' });
  }
});

router.get('/tags', async (req, res) => {
  try {
    const photos = await db.all('SELECT tags FROM photos');
    const tagSet = new Set<string>();

    photos.forEach((photo: any) => {
      if (photo.tags) {
        try {
          const tags = JSON.parse(photo.tags);
          if (Array.isArray(tags)) {
            tags.forEach((tag: string) => tagSet.add(tag));
          }
        } catch {
          const tags = photo.tags.split(' ').filter(Boolean);
          tags.forEach((tag: string) => tagSet.add(tag));
        }
      }
    });

    const tags = Array.from(tagSet).sort();
    res.json({ success: true, data: tags });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ success: false, message: '获取标签列表失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const photos = await db.all('SELECT id, title, thumbnail_path, tags, width, height, created_at FROM photos ORDER BY created_at DESC');

    const result = await Promise.all(photos.map(async (photo: any) => {
      let tags: string[] = [];
      if (photo.tags) {
        try {
          tags = JSON.parse(photo.tags);
        } catch {
          tags = photo.tags.split(' ').filter(Boolean);
        }
      }
      const getProxyUrl = (key: string) => {
        if (key.startsWith('http://') || key.startsWith('https://')) {
          const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
          if (key.startsWith(ossDomain)) {
            const filePath = key.replace(ossDomain, '').split('?')[0];
            return `/api/photos/image/${encodeURIComponent(filePath)}`;
          }
          return key;
        }
        return `/api/photos/image/${encodeURIComponent(key)}`;
      };
      const thumbnailUrl = getProxyUrl(photo.thumbnail_path);
      return { ...photo, tags, thumbnail_path: thumbnailUrl };
    }));

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

    await db.run('UPDATE photos SET views = views + 1 WHERE id = ?', id);

    let uploader = null;
    if (photo.user_id) {
      const user = await db.get('SELECT id, username, avatar_url FROM users WHERE id = ?', photo.user_id);
      if (user) {
        uploader = {
          id: user.id,
          username: user.username || '用户',
          avatar_url: user.avatar_url,
        };
      }
    }

    const getProxyUrl = (key: string) => {
      if (key.startsWith('http://') || key.startsWith('https://')) {
        const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
        if (key.startsWith(ossDomain)) {
          const filePath = key.replace(ossDomain, '').split('?')[0];
          return `/api/photos/image/${encodeURIComponent(filePath)}`;
        }
        return key;
      }
      return `/api/photos/image/${encodeURIComponent(key)}`;
    };

    res.json({
      success: true,
      data: {
        ...photo,
        original_url: getProxyUrl(photo.original_url),
        thumbnail_path: getProxyUrl(photo.thumbnail_path),
        preview_url: photo.preview_url ? getProxyUrl(photo.preview_url) : '',
        watermarked_url: photo.watermarked_url ? getProxyUrl(photo.watermarked_url) : '',
        tags: photo.tags ? JSON.parse(photo.tags) : [],
        uploader,
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

router.get('/image/*', async (req: any, res) => {
  try {
    const key: string = req.params[0];
    let decodedKey = decodeURIComponent(key);
    
    console.log('Proxy image request:', decodedKey);
    
    const presignedUrl = await getFileUrl(decodedKey);
    const response = await fetch(presignedUrl);
    
    if (!response.ok) {
      if (response.status === 404 && decodedKey.includes('_thumb')) {
        const originalKey = decodedKey.replace('_thumb.webp', '.jpg').replace('_thumb.jpg', '.jpg').replace('_thumb.png', '.png');
        console.log('Thumbnail not found, falling back to original:', originalKey);
        
        const originalPresignedUrl = await getFileUrl(originalKey);
        const originalResponse = await fetch(originalPresignedUrl);
        
        if (!originalResponse.ok) {
          console.error('Original image also not found:', originalKey);
          return sendPlaceholderImage(res);
        }
        
        const contentType = originalResponse.headers.get('content-type') || 'image/jpeg';
        const contentLength = originalResponse.headers.get('content-length');
        
        res.setHeader('Content-Type', contentType);
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }
        
        const arrayBuffer = await originalResponse.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
        return;
      }
      return sendPlaceholderImage(res);
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = response.headers.get('content-length');
    
    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Error proxying image:', error);
    sendPlaceholderImage(res);
  }
});

function sendPlaceholderImage(res: any) {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#374151" />
    <text x="200" y="140" text-anchor="middle" fill="#9CA3AF" font-family="sans-serif" font-size="16">图片暂不可用</text>
    <text x="200" y="165" text-anchor="middle" fill="#6B7280" font-family="sans-serif" font-size="12">Image Unavailable</text>
  </svg>`;
  
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Content-Length', Buffer.byteLength(svgContent));
  res.send(svgContent);
}

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

    const maxIdResult = await db.get("SELECT id FROM photos ORDER BY CAST(id AS INTEGER) DESC LIMIT 1");
    let currentMaxId = 0;
    if (maxIdResult?.id) {
      const parsed = parseInt(maxIdResult.id, 10);
      if (!isNaN(parsed) && parsed > 0) {
        currentMaxId = parsed;
      }
    }
    const newId = String(currentMaxId + 1).padStart(6, '0');

    const newPhoto = {
      id: newId,
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
        url: `/api/photos/image/${encodeURIComponent(uploadResult.url)}`,
        thumbnailUrl: `/api/photos/image/${encodeURIComponent(uploadResult.thumbnailUrl)}`,
      },
    });
  } catch (error) {
    console.error('Error completing upload:', error);
    res.status(500).json({ success: false, message: '上传完成处理失败' });
  }
});

router.post('/upload', upload.single('image'), handleUploadError, async (req: express.Request, res: express.Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的图片' });
    }

    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as { userId: string };
        userId = decoded.userId;
      } catch {}
    }

    const {
      title,
      tags,
      description,
      camera_model,
      vehicle,
      location,
      altitude,
      focal_length,
      iso,
      shutter_speed,
      aperture,
      width,
      height,
      watermarkText,
      watermarkX,
      watermarkY,
      watermarkOpacity,
      watermarkSize,
    } = req.body;

    let watermarkConfig: WatermarkConfig | undefined;
    if (watermarkText) {
      watermarkConfig = {
        text: watermarkText,
        x: parseInt(watermarkX) || 0,
        y: parseInt(watermarkY) || 0,
        opacity: parseFloat(watermarkOpacity) || 0.6,
        size: parseInt(watermarkSize) || 32,
      };
    }

    const processedImages = await processImage(file.buffer, file.originalname, watermarkConfig);

    const uploadedUrls = await uploadProcessedImages(processedImages);

    const maxIdResult = await db.get("SELECT id FROM photos ORDER BY CAST(id AS INTEGER) DESC LIMIT 1");
    let currentMaxId = 0;
    if (maxIdResult?.id) {
      const parsed = parseInt(maxIdResult.id, 10);
      if (!isNaN(parsed) && parsed > 0) {
        currentMaxId = parsed;
      }
    }
    const newId = String(currentMaxId + 1).padStart(6, '0');

    const newPhoto = {
      id: newId,
      title: title || '未命名照片',
      thumbnail_path: uploadedUrls.thumbnailUrl,
      original_url: uploadedUrls.previewUrl,
      preview_url: uploadedUrls.previewUrl,
      watermarked_url: uploadedUrls.watermarkedUrl || '',
      watermark_config: watermarkConfig ? JSON.stringify(watermarkConfig) : '{}',
      user_id: userId || null,
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
      `INSERT INTO photos 
        (id, title, thumbnail_path, original_url, preview_url, watermarked_url, watermark_config, user_id,
         tags, width, height, description, camera_model, vehicle, location, altitude, 
         focal_length, iso, shutter_speed, aperture, likes, views, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newPhoto.id,
      newPhoto.title,
      newPhoto.thumbnail_path,
      newPhoto.original_url,
      newPhoto.preview_url,
      newPhoto.watermarked_url,
      newPhoto.watermark_config,
      newPhoto.user_id,
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
        photoId: newId,
        thumbnailUrl: `/api/photos/image/${encodeURIComponent(processedImages.thumbnailKey)}`,
        previewUrl: `/api/photos/image/${encodeURIComponent(processedImages.previewKey)}`,
        ...(processedImages.watermarkedKey
          ? { watermarkedUrl: `/api/photos/image/${encodeURIComponent(processedImages.watermarkedKey)}` }
          : {}),
      },
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ success: false, message: '图片处理失败: ' + (error instanceof Error ? error.message : '未知错误') });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未授权' });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production') as { userId: string };
    } catch {
      return res.status(401).json({ success: false, message: '无效的令牌' });
    }

    const photo = await db.get('SELECT * FROM photos WHERE id = ?', id);
    if (!photo) {
      return res.status(404).json({ success: false, message: '照片不存在' });
    }

    if (photo.user_id !== decoded.userId) {
      return res.status(403).json({ success: false, message: '无权删除此照片' });
    }

    const extractKey = (url: string) => {
      if (!url) return null;
      const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';
      if (url.startsWith(ossDomain)) {
        return url.replace(ossDomain, '').split('?')[0];
      }
      return null;
    };

    const keysToDelete = [
      extractKey(photo.original_url),
      extractKey(photo.thumbnail_path),
      extractKey(photo.preview_url),
      extractKey(photo.watermarked_url),
    ].filter(Boolean);

    for (const key of keysToDelete) {
      try {
        await deleteFromOSS(key!);
      } catch (error) {
        console.error('Error deleting from OSS:', key, error);
      }
    }

    await db.run('DELETE FROM photo_likes WHERE photo_id = ?', id);
    await db.run('DELETE FROM photos WHERE id = ?', id);

    res.json({ success: true, message: '照片删除成功' });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({ success: false, message: '删除照片失败' });
  }
});

export default router;
