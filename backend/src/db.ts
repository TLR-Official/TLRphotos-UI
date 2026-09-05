/**
 * @file db.ts
 * @description 数据库初始化与表结构定义模块。
 *              负责创建 SQLite 数据库连接、初始化所有业务表结构、
 *              执行增量字段迁移并填充 Mock 演示数据。
 *              作为后端唯一的数据访问入口，被 server.ts 在启动时调用。
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

// 数据库文件存放路径：backend/data/database.db
// V1.5.1：支持通过 DB_PATH 环境变量覆盖，测试套件用它指向隔离的测试库，
// 避免测试用户/照片写入生产 database.db（曾导致用户量虚高 27 条垃圾记录）
const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../data/database.db');

// 全局共享的数据库实例，由 initDb 初始化后供各路由模块使用
export let db: Database;

/**
 * 初始化数据库表结构。
 * 使用 CREATE TABLE IF NOT EXISTS 保证幂等执行，
 * 同时为 admin_logs 创建常用查询字段索引以提升审计日志检索性能。
 */
const initSchema = async () => {
  await db.exec(`
    -- 用户主表：存储注册用户基本信息与第三方登录绑定状态
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      bio TEXT,
      phone TEXT,
      website TEXT,
      location TEXT,
      custom_fields TEXT,
      wechat_openid TEXT,
      qq_openid TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 照片主表：thumbnail_path 为缩略图、original_url 指向 OSS 原图
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      original_url TEXT NOT NULL,
      preview_url TEXT,
      watermarked_url TEXT,
      watermark_config TEXT DEFAULT '{}',
      tags TEXT,
      width INTEGER,
      height INTEGER,
      description TEXT,
      camera_model TEXT,
      vehicle TEXT,
      location TEXT,
      altitude INTEGER,
      focal_length TEXT,
      iso INTEGER,
      shutter_speed TEXT,
      aperture TEXT,
      likes INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 文章表：content_path 指向 Markdown 文件相对路径
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      excerpt TEXT,
      content_path TEXT NOT NULL,
      cover_image TEXT,
      author TEXT NOT NULL,
      published_at TEXT DEFAULT CURRENT_TIMESTAMP,
      read_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      tags TEXT
    );

    -- 文章评论表：随文章删除级联清理
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    -- 照片点赞表：(photo_id, user_id) 联合主键确保同一用户对同一照片仅能点赞一次
    CREATE TABLE IF NOT EXISTS photo_likes (
      photo_id TEXT NOT NULL,
      user_id TEXT DEFAULT 'anonymous',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (photo_id, user_id),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    );

    -- 照片浏览去重表：(photo_id, viewer_key) 联合主键天然去重
    -- viewer_key 形如 'user:<userId>' 或 'ip:<clientIp>'，配合 last_viewed_at 实现 24h 窗口去重
    CREATE TABLE IF NOT EXISTS photo_views (
      photo_id TEXT NOT NULL,
      viewer_key TEXT NOT NULL,
      last_viewed_at INTEGER NOT NULL,
      PRIMARY KEY (photo_id, viewer_key),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    );
    -- last_viewed_at 索引：定时清理 7 天前旧记录时使用
    CREATE INDEX IF NOT EXISTS idx_photo_views_last_viewed_at ON photo_views(last_viewed_at);

    -- 文章点赞表：与 photo_likes 结构对称
    CREATE TABLE IF NOT EXISTS article_likes (
      article_id TEXT NOT NULL,
      user_id TEXT DEFAULT 'anonymous',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (article_id, user_id),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    -- 专栏信息表：单条记录，默认 id 为 column_001
    CREATE TABLE IF NOT EXISTS column_info (
      id TEXT PRIMARY KEY DEFAULT 'column_001',
      name TEXT NOT NULL,
      description TEXT,
      cover_image TEXT
    );

    -- 会话 Cookie 表：session_token 唯一、encrypted_ip 加密存储访问 IP
    CREATE TABLE IF NOT EXISTS cookie (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      encrypted_ip TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_active_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 管理员用户表：role 区分角色，zone 用于分区审核权限隔离
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'zone_auditor',
      zone TEXT DEFAULT 'default',
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 管理员操作审计日志表：记录所有后台关键操作
    CREATE TABLE IF NOT EXISTS admin_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      ip TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    -- 审计日志索引：覆盖按管理员、时间、动作类型三种典型查询场景
    CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
    CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);

    -- 人机验证状态表（V1.8.0）：记录每个主体最近一次通过 Cloudflare Turnstile 人机验证的状态
    -- subject_type: 'user'（前台用户）| 'admin'（管理后台管理员）
    -- UNIQUE(subject_type, subject_id)：同一主体仅保留一条记录，重验证时覆盖更新
    -- 168 小时（7 天）有效期 + IP 绑定：登出或 IP 变更立即失效（见 verificationService）
    CREATE TABLE IF NOT EXISTS user_verifications (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL DEFAULT 'user',
      subject_id TEXT NOT NULL,
      ip TEXT NOT NULL,
      action TEXT,
      verified_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE (subject_type, subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_verifications_expires_at ON user_verifications(expires_at);
  `);

  // 以下为字段增量迁移：使用 ALTER TABLE 添加后期新增字段，
  // try/catch 捕获字段已存在的异常，保证幂等执行
  try {
    await db.run('ALTER TABLE photos ADD COLUMN preview_url TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN watermarked_url TEXT');
  } catch {}
  try {
    await db.run("ALTER TABLE photos ADD COLUMN watermark_config TEXT DEFAULT '{}'");
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN user_id TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN category TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN status TEXT DEFAULT "pending"');
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN rejection_reason TEXT');
  } catch {}

  // V1.7.0 用户管理增强：封禁标记 + 四项功能权限字段
  try {
    await db.run('ALTER TABLE users ADD COLUMN banned_at TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_upload INTEGER DEFAULT 1');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_view INTEGER DEFAULT 1');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_download INTEGER DEFAULT 1');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_like INTEGER DEFAULT 1');
  } catch {}
};

/**
 * 填充 Mock 演示数据。
 * 仅在各业务表为空时执行，避免覆盖已存在的真实数据。
 * 包含照片、文章、评论、专栏四类基础演示数据，便于前端联调与本地开发。
 */
const seedMockData = async () => {
  // 照片表为空时插入 12 张演示照片（含 EXIF 信息、标签、点赞数等）
  const photoCount = await db.get('SELECT COUNT(*) as count FROM photos');
  if (photoCount.count === 0) {
    const photos = [
      {
        id: '000001',
        title: '城市天际线',
        thumbnail_path: 'https://picsum.photos/seed/aero1/1200/800',
        original_url: 'https://picsum.photos/seed/aero1/2048/1365',
        tags: JSON.stringify(['城市', '航拍', '日落']),
        width: 1200,
        height: 800,
        description: '傍晚时分，城市的天际线在夕阳的映照下显得格外壮观。高楼大厦林立，灯光开始亮起，勾勒出都市的轮廓。',
        camera_model: 'Sony A7R IV',
        vehicle: 'DJI Mavic 3 Pro',
        location: '上海市浦东新区',
        altitude: 120,
        focal_length: '24mm',
        iso: 100,
        shutter_speed: '1/500s',
        aperture: 'f/8',
        likes: 1256,
        views: 8932,
        created_at: '2024-05-15T18:30:00Z',
      },
      {
        id: '000002',
        title: '海岸线全景',
        thumbnail_path: 'https://picsum.photos/seed/aero2/1200/900',
        original_url: 'https://picsum.photos/seed/aero2/2048/1536',
        tags: JSON.stringify(['海洋', '自然', '全景']),
        width: 1200,
        height: 900,
        description: '绵延的海岸线，海浪拍打着礁石，远处是一望无际的大海。清晨的阳光洒在海面上，波光粼粼。',
        camera_model: 'Canon EOS R5',
        vehicle: 'DJI Air 3',
        location: '浙江省舟山市普陀区',
        altitude: 80,
        focal_length: '16mm',
        iso: 100,
        shutter_speed: '1/1000s',
        aperture: 'f/11',
        likes: 892,
        views: 5643,
        created_at: '2024-06-20T09:15:00Z',
      },
      {
        id: '000003',
        title: '山地梯田',
        thumbnail_path: 'https://picsum.photos/seed/aero3/1200/750',
        original_url: 'https://picsum.photos/seed/aero3/2048/1280',
        tags: JSON.stringify(['山脉', '农业', '自然']),
        width: 1200,
        height: 750,
        description: '山间的梯田层层叠叠，如同大地的指纹。春季的梯田绿意盎然，展现出人与自然和谐共生的美景。',
        camera_model: 'Nikon Z8',
        vehicle: 'DJI Mini 3 Pro',
        location: '云南省元阳县',
        altitude: 150,
        focal_length: '24mm',
        iso: 200,
        shutter_speed: '1/800s',
        aperture: 'f/7.1',
        likes: 1567,
        views: 12345,
        created_at: '2024-04-10T10:00:00Z',
      },
      {
        id: '000004',
        title: '都市夜景',
        thumbnail_path: 'https://picsum.photos/seed/aero4/1200/700',
        original_url: 'https://picsum.photos/seed/aero4/2048/1190',
        tags: JSON.stringify(['城市', '夜景', '灯光']),
        width: 1200,
        height: 700,
        description: '夜晚的都市灯火辉煌，高楼大厦的灯光形成了一幅绚丽的画卷。车流光轨穿梭在城市的动脉上。',
        camera_model: 'Sony A7S III',
        vehicle: 'DJI Inspire 3',
        location: '北京市朝阳区',
        altitude: 200,
        focal_length: '35mm',
        iso: 1600,
        shutter_speed: '1/60s',
        aperture: 'f/4',
        likes: 2341,
        views: 18765,
        created_at: '2024-07-05T21:30:00Z',
      },
      {
        id: '000005',
        title: '河流蜿蜒',
        thumbnail_path: 'https://picsum.photos/seed/aero5/1200/850',
        original_url: 'https://picsum.photos/seed/aero5/2048/1466',
        tags: JSON.stringify(['河流', '自然', '地貌']),
        width: 1200,
        height: 850,
        description: '蜿蜒的河流如同一条银色的丝带，穿过广袤的平原。两岸的植被茂盛，展现出大自然的生命力。',
        camera_model: 'Canon EOS R6',
        vehicle: 'DJI Mavic 3',
        location: '四川省成都市',
        altitude: 180,
        focal_length: '24mm',
        iso: 100,
        shutter_speed: '1/640s',
        aperture: 'f/9',
        likes: 987,
        views: 6543,
        created_at: '2024-03-20T14:20:00Z',
      },
      {
        id: '000006',
        title: '森林覆盖',
        thumbnail_path: 'https://picsum.photos/seed/aero6/400/320',
        original_url: 'https://picsum.photos/seed/aero6/2048/1638',
        tags: JSON.stringify(['森林', '绿色', '生态']),
        width: 400,
        height: 320,
        description: '茂密的森林覆盖着山峦，从高空俯瞰，绿色的树冠形成了一片生机勃勃的景象。',
        camera_model: 'Sony A7R V',
        vehicle: 'DJI Air 2S',
        location: '黑龙江省大兴安岭',
        altitude: 250,
        focal_length: '28mm',
        iso: 100,
        shutter_speed: '1/500s',
        aperture: 'f/8',
        likes: 756,
        views: 4321,
        created_at: '2024-05-01T11:45:00Z',
      },
      {
        id: '000007',
        title: '港口码头',
        thumbnail_path: 'https://picsum.photos/seed/aero7/400/380',
        original_url: 'https://picsum.photos/seed/aero7/2048/1945',
        tags: JSON.stringify(['港口', '船只', '工业']),
        width: 400,
        height: 380,
        description: '繁忙的港口码头，集装箱船停泊在岸边，起重机正在装卸货物，展现出国际贸易的繁忙景象。',
        camera_model: 'Nikon Z9',
        vehicle: 'DJI Mavic 3 Classic',
        location: '广东省深圳市盐田区',
        altitude: 100,
        focal_length: '24mm',
        iso: 100,
        shutter_speed: '1/800s',
        aperture: 'f/11',
        likes: 654,
        views: 3210,
        created_at: '2024-06-10T08:00:00Z',
      },
      {
        id: '000008',
        title: '农田纹理',
        thumbnail_path: 'https://picsum.photos/seed/aero8/400/420',
        original_url: 'https://picsum.photos/seed/aero8/2048/2150',
        tags: JSON.stringify(['农业', '纹理', '几何']),
        width: 400,
        height: 420,
        description: '整齐的农田呈现出几何图案，不同颜色的作物交织在一起，形成了一幅大地的艺术作品。',
        camera_model: 'Canon EOS R3',
        vehicle: 'DJI Mini 4 Pro',
        location: '河南省郑州市',
        altitude: 200,
        focal_length: '20mm',
        iso: 100,
        shutter_speed: '1/600s',
        aperture: 'f/8',
        likes: 890,
        views: 5432,
        created_at: '2024-07-25T09:30:00Z',
      },
      {
        id: '000009',
        title: '桥梁连接',
        thumbnail_path: 'https://picsum.photos/seed/aero9/400/300',
        original_url: 'https://picsum.photos/seed/aero9/2048/1536',
        tags: JSON.stringify(['桥梁', '基础设施', '城市']),
        width: 400,
        height: 300,
        description: '宏伟的桥梁横跨江河，连接两岸的交通。现代工程技术的杰作，展现出人类的智慧。',
        camera_model: 'Sony A7R IV',
        vehicle: 'DJI Inspire 2',
        location: '湖北省武汉市',
        altitude: 120,
        focal_length: '24mm',
        iso: 100,
        shutter_speed: '1/500s',
        aperture: 'f/11',
        likes: 1123,
        views: 7890,
        created_at: '2024-04-28T15:00:00Z',
      },
      {
        id: '000010',
        title: '沙漠纹理',
        thumbnail_path: 'https://picsum.photos/seed/aero10/400/360',
        original_url: 'https://picsum.photos/seed/aero10/2048/1843',
        tags: JSON.stringify(['沙漠', '自然', '纹理']),
        width: 400,
        height: 360,
        description: '广袤的沙漠中，沙丘的纹理如同波浪般起伏。阳光照射下，阴影与亮部形成了强烈的对比。',
        camera_model: 'Nikon Z8',
        vehicle: 'DJI Mavic 3 Pro',
        location: '新疆维吾尔自治区塔克拉玛干沙漠',
        altitude: 300,
        focal_length: '28mm',
        iso: 100,
        shutter_speed: '1/1000s',
        aperture: 'f/11',
        likes: 1456,
        views: 10234,
        created_at: '2024-08-05T16:30:00Z',
      },
      {
        id: '000011',
        title: '雪山之巅',
        thumbnail_path: 'https://picsum.photos/seed/aero11/400/480',
        original_url: 'https://picsum.photos/seed/aero11/2048/2458',
        tags: JSON.stringify(['雪山', '高山', '自然']),
        width: 400,
        height: 480,
        description: '皑皑白雪覆盖的山峰，在晨光中闪耀着金色的光芒。雄伟壮观的雪山，让人感受到大自然的震撼。',
        camera_model: 'Canon EOS R5',
        vehicle: 'DJI Inspire 3',
        location: '西藏自治区珠穆朗玛峰',
        altitude: 400,
        focal_length: '35mm',
        iso: 100,
        shutter_speed: '1/800s',
        aperture: 'f/8',
        likes: 2876,
        views: 25678,
        created_at: '2024-09-15T07:00:00Z',
      },
      {
        id: '000012',
        title: '城市建筑群',
        thumbnail_path: 'https://picsum.photos/seed/aero12/400/340',
        original_url: 'https://picsum.photos/seed/aero12/2048/1748',
        tags: JSON.stringify(['建筑', '城市', '现代']),
        width: 400,
        height: 340,
        description: '现代化的城市建筑群，高楼林立。玻璃幕墙反射着阳光，展现出都市的繁华与活力。',
        camera_model: 'Sony A7S III',
        vehicle: 'DJI Air 3',
        location: '广州市天河区',
        altitude: 150,
        focal_length: '24mm',
        iso: 200,
        shutter_speed: '1/600s',
        aperture: 'f/9',
        likes: 789,
        views: 4567,
        created_at: '2024-05-30T12:00:00Z',
      },
    ];

    // 批量插入演示照片，使用参数化查询防止 SQL 注入
    for (const photo of photos) {
      await db.run(
        'INSERT INTO photos (id, title, thumbnail_path, original_url, tags, width, height, description, camera_model, vehicle, location, altitude, focal_length, iso, shutter_speed, aperture, likes, views, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        photo.id,
        photo.title,
        photo.thumbnail_path,
        photo.original_url,
        photo.tags,
        photo.width,
        photo.height,
        photo.description,
        photo.camera_model,
        photo.vehicle,
        photo.location,
        photo.altitude,
        photo.focal_length,
        photo.iso,
        photo.shutter_speed,
        photo.aperture,
        photo.likes,
        photo.views,
        photo.created_at
      );
    }

    // V1.5.1：演示数据状态分布 — 前 10 张标记已审核（供前台画廊展示与测试用例 fixture），
    // 后 2 张保持默认 pending（供审核流程演示）。原 seed 未设 status 全为 pending，
    // 导致切到测试库后 photos.test.ts 取不到 approved 照片
    await db.run("UPDATE photos SET status = 'approved' WHERE id IN ('000001','000002','000003','000004','000005','000006','000007','000008','000009','000010')");
  }

  // 文章表为空时插入 5 篇演示文章
  const articleCount = await db.get('SELECT COUNT(*) as count FROM articles');
  if (articleCount.count === 0) {
    const articles = [
      {
        id: 'article_001',
        title: 'Markdown 和 LaTeX 测试文章',
        excerpt: '本文包含了 Markdown 的所有主要语法和 LaTeX 的常用数学公式，用于验证渲染效果的完整性和正确性。',
        content_path: '/articles/test-markdown-latex.md',
        cover_image: 'https://picsum.photos/seed/article1/400/300',
        author: 'TLR工作室',
        published_at: '2024-07-01T10:00:00Z',
        read_count: 1234,
        like_count: 89,
        comment_count: 23,
        tags: JSON.stringify(['技术', 'Markdown', 'LaTeX']),
      },
      {
        id: 'article_002',
        title: '航拍摄影技巧入门',
        excerpt: '从设备选择到拍摄技巧，全面介绍航拍摄影的基础知识，帮助你拍出专业级的航拍作品。',
        content_path: '/articles/test-markdown-latex.md',
        cover_image: 'https://picsum.photos/seed/article2/400/300',
        author: 'TLR工作室',
        published_at: '2024-06-25T14:30:00Z',
        read_count: 2345,
        like_count: 156,
        comment_count: 45,
        tags: JSON.stringify(['摄影', '航拍', '技巧']),
      },
      {
        id: 'article_003',
        title: '无人机飞行安全指南',
        excerpt: '详细介绍无人机飞行的安全注意事项和法律法规，确保你的飞行既安全又合法。',
        content_path: '/articles/test-markdown-latex.md',
        cover_image: 'https://picsum.photos/seed/article3/400/300',
        author: 'TLR工作室',
        published_at: '2024-06-20T09:15:00Z',
        read_count: 1876,
        like_count: 123,
        comment_count: 32,
        tags: JSON.stringify(['安全', '无人机', '法规']),
      },
      {
        id: 'article_004',
        title: '后期修图技巧分享',
        excerpt: '掌握航拍照片的后期处理技巧，让你的作品更加出色，展现独特的视觉效果。',
        content_path: '/articles/test-markdown-latex.md',
        cover_image: 'https://picsum.photos/seed/article4/400/300',
        author: 'TLR工作室',
        published_at: '2024-06-15T16:45:00Z',
        read_count: 3456,
        like_count: 234,
        comment_count: 67,
        tags: JSON.stringify(['后期', '修图', '技巧']),
      },
      {
        id: 'article_005',
        title: '优秀航拍作品赏析',
        excerpt: '精选国内外优秀航拍作品，分析其构图、光线和色彩运用，提升你的审美水平。',
        content_path: '/articles/test-markdown-latex.md',
        cover_image: 'https://picsum.photos/seed/article5/400/300',
        author: 'TLR工作室',
        published_at: '2024-06-10T11:20:00Z',
        read_count: 4567,
        like_count: 345,
        comment_count: 89,
        tags: JSON.stringify(['赏析', '作品', '灵感']),
      },
    ];

    for (const article of articles) {
      await db.run(
        'INSERT INTO articles (id, title, excerpt, content_path, cover_image, author, published_at, read_count, like_count, comment_count, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        article.id,
        article.title,
        article.excerpt,
        article.content_path,
        article.cover_image,
        article.author,
        article.published_at,
        article.read_count,
        article.like_count,
        article.comment_count,
        article.tags
      );
    }
  }

  // 评论表为空时插入演示评论，created_at 使用时间偏移模拟递减发布时间
  const commentCount = await db.get('SELECT COUNT(*) as count FROM comments');
  if (commentCount.count === 0) {
    const comments = [
      { id: 'comment_001', article_id: 'article_001', author: '摄影爱好者', content: '这篇文章太棒了！', created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 'comment_002', article_id: 'article_001', author: '技术达人', content: '公式渲染特别清晰！', created_at: new Date(Date.now() - 7200000).toISOString() },
      { id: 'comment_003', article_id: 'article_002', author: '新手玩家', content: '学到了很多技巧！', created_at: new Date(Date.now() - 1800000).toISOString() },
      { id: 'comment_004', article_id: 'article_002', author: '资深飞手', content: '补充一点，飞行前一定要检查电池！', created_at: new Date(Date.now() - 5400000).toISOString() },
    ];

    for (const comment of comments) {
      await db.run(
        'INSERT INTO comments (id, article_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)',
        comment.id,
        comment.article_id,
        comment.author,
        comment.content,
        comment.created_at
      );
    }
  }

  // 专栏表为空时插入默认专栏记录
  const columnCount = await db.get('SELECT COUNT(*) as count FROM column_info');
  if (columnCount.count === 0) {
    await db.run(
      'INSERT INTO column_info (id, name, description, cover_image) VALUES (?, ?, ?, ?)',
      'column_001',
      '航拍技术专栏',
      '探索航拍世界，分享专业技巧，记录精彩瞬间',
      'https://picsum.photos/seed/column/600/400'
    );
  }
};

/**
 * 数据库初始化入口。
 * 创建连接后启用 WAL 模式提升并发读写性能，并开启外键约束保证数据完整性。
 * 依次执行表结构初始化与 Mock 数据填充。
 */
export const initDb = async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // WAL 模式：读写不互斥，提升并发性能；外键约束：保证级联删除生效
  await db.run('PRAGMA journal_mode = WAL');
  await db.run('PRAGMA foreign_keys = ON');

  await initSchema();
  await seedMockData();
};
