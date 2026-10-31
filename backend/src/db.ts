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
import fs from 'fs';

// 数据库文件存放路径：backend/data/database.db
// V1.5.1：支持通过 DB_PATH 环境变量覆盖，测试套件用它指向隔离的测试库，
// 避免测试用户/照片写入生产 database.db（曾导致用户量虚高 27 条垃圾记录）
const dbPath = process.env.DB_PATH ?? path.join(__dirname, '../data/database.db');

// 全局共享的数据库实例，由 initDb 初始化后供各路由模块使用
export let db: Database;

/**
 * 论坛三大基础板块（V4.0.0 收敛）：航空 / 铁路 / 公路。
 * 单一事实来源，同时供以下三处使用：
 * - db.ts seedMockData：initDb 时按名判断缺则插入（幂等）
 * - adminForum.ts：板块创建白名单（仅允许三板块）与删除保护（三板块不可删）
 * - routes/news.ts：新闻发布板块约束（首批仅允许航空板块）
 */
export const CANONICAL_FORUM_BOARDS: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
}> = [
  { id: 'aviation', name: '航空', description: '民航、军航与通航摄影交流', icon: '✈️', sort_order: 1 },
  { id: 'railway', name: '铁路', description: '铁路摄影与车迷交流', icon: '🚄', sort_order: 2 },
  { id: 'road', name: '公路', description: '公路与汽车摄影交流', icon: '🛣️', sort_order: 3 },
];

/**
 * 评论体系完整 DDL（V3.0.0）。
 * 基线建库与存量库 V3 迁移共用本常量，确保两条路径产生完全一致的结构：
 * - comments: 通用三级嵌套评论，按 (subject_type, subject_id) 绑定任意主题
 * - comment_likes: 评论点赞（联合主键去重）
 * - comment_heat: 每线程热度档位与有效留存时间
 * - comment_archives: 归档线程索引（数据行在 OSS）
 */
const commentSchemaSql = `
  -- 通用评论表：depth 1/2/3，三级封顶（对 depth=3 再回复时 depth 仍为 3，平铺展示）
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    parent_id TEXT,
    depth INTEGER NOT NULL DEFAULT 1,
    user_id TEXT,
    author TEXT NOT NULL,
    reply_to_user_id TEXT,
    reply_to_user_name TEXT,
    content TEXT NOT NULL,
    like_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  -- 主题+时间：列表分页；root_id：整楼操作；parent_id：回复链校验
  CREATE INDEX IF NOT EXISTS idx_comments_subject ON comments(subject_type, subject_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_root ON comments(root_id);
  CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

  -- 评论点赞表：(comment_id, user_id) 联合主键确保同一用户仅赞一次
  CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id)
  );

  -- 评论热度表：每个 L1 线程一行，驱动归档/续期决策
  CREATE TABLE IF NOT EXISTS comment_heat (
    root_id TEXT PRIMARY KEY,
    reply_count INTEGER NOT NULL DEFAULT 0,
    like_count INTEGER NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    velocity REAL NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'normal',
    last_calc_at TEXT,
    retain_until TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0
  );

  -- 归档索引表：线程归档到 OSS 后本地仅保留本索引
  CREATE TABLE IF NOT EXISTS comment_archives (
    root_id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    oss_key TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    root_created_at TEXT NOT NULL,
    reply_count INTEGER NOT NULL DEFAULT 0,
    heat_tier TEXT NOT NULL DEFAULT 'normal',
    last_reply_at TEXT NOT NULL,
    rehydrated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_comment_archives_subject ON comment_archives(subject_type, subject_id);
`;

/**
 * 初始化数据库表结构。
 * 使用 CREATE TABLE IF NOT EXISTS 保证幂等执行，
 * 同时为 admin_logs 创建常用查询字段索引以提升审计日志检索性能。
 */
const initSchema = async () => {
  // V3.0.0 前置探测：旧单层 comments（含 article_id）必须在基线 DDL 前改名。
  // 否则基线中 CREATE TABLE IF NOT EXISTS comments 被跳过，而新索引
  // idx_comments_subject 会尝试建在无 subject_type 列的旧表上导致初始化失败。
  // comments_legacy 残留表示上次迁移中断，进入恢复式迁移（行写入均幂等）。
  const preCommentCols = (await db.all('PRAGMA table_info(comments)')) as Array<{ name: string }>;
  const commentsNeedsRename = preCommentCols.some((c) => c.name === 'article_id');
  const legacyTable = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='comments_legacy'"
  );
  if (commentsNeedsRename) {
    const v3BackupPath = `${dbPath}.bak-v3-${Date.now()}`;
    fs.copyFileSync(dbPath, v3BackupPath);
    console.log(`[DB V3.0.0] 评论迁移前整库备份: ${v3BackupPath}`);
    await db.run('ALTER TABLE comments RENAME TO comments_legacy');
  }
  const commentsLegacyPending = commentsNeedsRename || legacyTable !== undefined;

  await db.exec(`
    -- 用户主表：存储注册用户基本信息与第三方登录绑定状态
    -- V2.0.0：全面移除手机号体系，email 为唯一账号标识（仍允许 NULL：仅过渡绑定流程临时存在）；
    -- email_verified 标记邮箱是否已通过验证码确权；登录验证码成功后自动置 1
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      bio TEXT,
      website TEXT,
      location TEXT,
      custom_fields TEXT,
      wechat_openid TEXT,
      qq_openid TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      email_verified INTEGER NOT NULL DEFAULT 0
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
      comment_count INTEGER DEFAULT 0,
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

    -- V3.0.0：通用三级评论体系（comments/comment_likes/comment_heat/comment_archives）
    ${commentSchemaSql}

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
      must_change_password INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
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

    -- 登录验证码表：存储一次性验证码（OTP）的哈希与生命周期状态
    -- target: 接收目标（手机号或邮箱）；channel: 发送通道（sms/email）；scene: 业务场景（login/register/reset 等）
    -- code_hash 仅存哈希不存明文；attempts 计数防暴力破解；used_at 标记一次性消费；expires_at 控制有效期
    CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      channel TEXT NOT NULL,
      scene TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      ip TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    -- (target, scene) 复合索引：校验验证码时按目标+场景检索最新记录
    CREATE INDEX IF NOT EXISTS idx_verification_codes_target_scene ON verification_codes(target, scene);
    -- expires_at 索引：定时清理过期验证码记录时使用
    CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at ON verification_codes(expires_at);
    -- 论坛板块表（V3.1.0）：id 为短标识，sort_order 控制展示顺序
    CREATE TABLE IF NOT EXISTS forum_boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      thread_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 论坛帖子表（V3.1.0）：帖子即 subject_type='thread' 的评论主题
    CREATE TABLE IF NOT EXISTS forum_threads (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      ref_type TEXT,
      ref_id TEXT,
      last_reply_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (board_id) REFERENCES forum_boards(id)
    );
    CREATE INDEX IF NOT EXISTS idx_forum_threads_board_reply ON forum_threads(board_id, last_reply_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forum_threads_pinned_reply ON forum_threads(is_pinned DESC, last_reply_at DESC);

    -- 帖子点赞表：与 photo_likes 同构
    CREATE TABLE IF NOT EXISTS thread_likes (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (thread_id, user_id),
      FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
    );

    -- 帖子浏览去重表：与 photo_views 同构，24h 窗口
    CREATE TABLE IF NOT EXISTS thread_views (
      thread_id TEXT NOT NULL,
      viewer_key TEXT NOT NULL,
      last_viewed_at INTEGER NOT NULL,
      PRIMARY KEY (thread_id, viewer_key),
      FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_thread_views_last_viewed_at ON thread_views(last_viewed_at);

    -- 通知中心表（V4.0.0）：站内信，type 区分业务来源
    -- （photo_liked/photo_downloaded/photo_hot/penalty/appeal_approved/appeal_rejected/photo_recalled/forum_reply）
    -- is_read 0=未读 1=已读；related_type/related_id 指向关联业务对象（如 photo）
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      related_type TEXT,
      related_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    -- (user_id, is_read) 复合索引：未读角标计数与"我的通知"列表高频查询
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

    -- 处罚记录表（V4.0.0 两级留痕；V4.1.0 升级三级语义）：
    -- level 1=警告（不限能力，主页公开展示，可撤销仅超管）；
    -- level 2=功能封禁（capabilities 能力快照 + expires_at 期限，30~360 天，可解除）；
    -- level 3=账号封禁（banned_at/banned_until 落 users 表，永久或限时）
    -- user_id 指向 users 表；对管理员（zone_auditor）的处罚同样落本表留痕，但不落 users 表效果
    CREATE TABLE IF NOT EXISTS penalties (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      reason TEXT NOT NULL,
      days INTEGER,
      expires_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 申诉表（V4.0.0）：上传者对被拒绝照片发起申诉，管理员双向裁决
    -- status: pending（待裁决）/ approved（申诉成立，照片恢复）/ rejected（申诉驳回）/ withdrawn（用户撤回，可重新发起）
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      response TEXT,
      decided_by TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL
    );

    -- 新闻配图表（V4.0.0）：type='news' 的文章与已通过审核照片的授权配图关联
    -- authorization_confirmed=1 表示编辑已确认获得摄影师授权；sort_order 控制图序（首位为封面）
    -- article 级联删除：新闻硬删时同步清理配图关联
    CREATE TABLE IF NOT EXISTS news_images (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      authorization_confirmed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY (photo_id) REFERENCES photos(id)
    );
    -- (article_id, sort_order)：详情按图序读取、列表取封面首图
    CREATE INDEX IF NOT EXISTS idx_news_images_article ON news_images(article_id, sort_order);

    -- 公告横幅表（V4.1.0）：is_active=1 的公告按 created_at 倒序作为全站 Top Banner 展示
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      cover_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 审核员处分记录表（V4.1.2-beta.3）：高级申诉裁决判定审核员失误/违规时写入
    -- severity: warning（失误/警告）| penalty（违规，建议升级处罚）
    CREATE TABLE IF NOT EXISTS admin_warnings (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      appeal_id TEXT,
      photo_id TEXT,
      severity TEXT NOT NULL DEFAULT 'warning',
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_warnings_admin ON admin_warnings(admin_id, created_at);

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
  // V3.0.0 照片评论计数（与 articles.comment_count 同口径）
  try {
    await db.run('ALTER TABLE photos ADD COLUMN comment_count INTEGER DEFAULT 0');
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

  // V2.0.0 邮箱确权标记（表重建路径已含该列，此处覆盖未触发重建的存量库）
  try {
    await db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  } catch {}

  // V3.2.0 邮件验证周期化：最近一次邮箱验证成功时间（登录按周期跳过 OTP 的依据；
  // NULL 表示从未完成验证，下次登录必须验码）
  try {
    await db.run('ALTER TABLE users ADD COLUMN last_email_verified_at TEXT');
  } catch {}

  // V3.2.0 飞机注册号（新上传必填，供全局检索与审核校验；存量数据允许 NULL）
  try {
    await db.run('ALTER TABLE photos ADD COLUMN registration_number TEXT');
  } catch {}
  // V3.2.0 热门图片意愿标记：用户上传时勾选"愿意上传为热门图片"置 1，审核员可见
  try {
    await db.run('ALTER TABLE photos ADD COLUMN is_hot INTEGER NOT NULL DEFAULT 0');
  } catch {}
  // 注册号检索索引（全局检索按注册号前缀/模糊匹配）
  try {
    await db.run('CREATE INDEX IF NOT EXISTS idx_photos_registration_number ON photos(registration_number)');
  } catch {}
  // V4.6.0：航空器自动识别结果（机型标签/所属航司），上传时由服务端查询第三方库并落库，
  // 供详情页展示与关键词检索；查询失败时保持 NULL，不影响上传
  try {
    await db.run('ALTER TABLE photos ADD COLUMN aircraft_type TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN airline TEXT');
  } catch {}
  // V4.6.0：注册号 → 机型/航司 的查询缓存，避免重复请求上游被限流（TTL 由服务层控制）
  await db.run(`CREATE TABLE IF NOT EXISTS aircraft_cache (
    registration TEXT PRIMARY KEY,
    aircraft_type TEXT,
    icao_type TEXT,
    manufacturer TEXT,
    airline TEXT,
    country TEXT,
    source TEXT,
    fetched_at TEXT NOT NULL
  )`);
  // V4.4.1：画廊/公开主页/管理端列表热点查询索引（纯读取优化，不改变任何查询结果）
  //  - status + created_at：画廊列表 WHERE status='approved' ORDER BY created_at DESC、
  //    管理端待审 ORDER BY created_at ASC 的覆盖式扫描
  //  - user_id + status：公开主页 /auth/me/photos 的「某人已通过作品」过滤
  //  - created_at：后台按时间排序的全量列表（无状态过滤）
  try {
    await db.run('CREATE INDEX IF NOT EXISTS idx_photos_status_created ON photos(status, created_at DESC)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_photos_user_status ON photos(user_id, status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC)');
  } catch {}
  // V4.1.2-beta.3：结构化标签列（三层标签属性键值扁平 JSON）纳入正式迁移，
  // 历史环境为手工建列，缺失时会导致上传插入失败与第三层筛选不可用
  try {
    await db.run('ALTER TABLE photos ADD COLUMN structured_tags TEXT');
  } catch {}
  // V4.6.1：注册号仅由 photos.registration_number 承载，清理 structured_tags 中历史遗留的「注册号」键，
  // 避免同一数据两处留存；必须在上面的建列迁移之后执行，幂等且无匹配行时零开销
  const legacyRegTagRows = (await db.all(
    `SELECT id, structured_tags FROM photos WHERE structured_tags LIKE '%"注册号"%'`
  )) as Array<{ id: string; structured_tags: string }>;
  for (const row of legacyRegTagRows) {
    try {
      const parsed = JSON.parse(row.structured_tags);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && '注册号' in parsed) {
        delete parsed['注册号'];
        await db.run('UPDATE photos SET structured_tags = ? WHERE id = ?', JSON.stringify(parsed), row.id);
      }
    } catch {
      // 非 JSON 的历史脏数据保持原样，不阻断启动
    }
  }

  // ==========================================================================
  // V4.7.0 迭代：邀请码与用户称号
  // users 记录邀请码关联、称号文案与授予时间；invite_codes 为管理后台发放的邀请码；
  // comments / forum_threads 增加称号快照列（作者名旁展示称号，归档评论同样保留）
  // ==========================================================================
  try {
    await db.run('ALTER TABLE users ADD COLUMN invite_code_id TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN user_title TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN title_granted_at TEXT');
  } catch {}
  await db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    airline TEXT,
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    remark TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  try {
    await db.run('ALTER TABLE comments ADD COLUMN author_title TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE comments ADD COLUMN reply_to_user_title TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE forum_threads ADD COLUMN author_title TEXT');
  } catch {}
  // 历史评论/帖子称号回填：仅在快照为空时按 user_id / author_id 取当前称号，幂等
  await db.run(`UPDATE comments SET author_title = (
    SELECT user_title FROM users u WHERE u.id = comments.user_id
  ) WHERE author_title IS NULL AND user_id IS NOT NULL`);
  await db.run(`UPDATE comments SET reply_to_user_title = (
    SELECT user_title FROM users u WHERE u.id = comments.reply_to_user_id
  ) WHERE reply_to_user_title IS NULL AND reply_to_user_id IS NOT NULL`);
  await db.run(`UPDATE forum_threads SET author_title = (
    SELECT user_title FROM users u WHERE u.id = forum_threads.author_id
  ) WHERE author_title IS NULL AND author_id IS NOT NULL`);

  // ==========================================================================
  // V4.0.0 迭代：通知与审核纠错系统
  // photos 加审核留痕列（reviewed_by/reviewed_at）、热门确认标记（is_hot_confirmed）、
  // 审核分配列（assigned_to）；articles 加类型列；users 加上传禁令解禁时间
  // ==========================================================================
  try {
    await db.run('ALTER TABLE photos ADD COLUMN reviewed_by TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE photos ADD COLUMN reviewed_at TEXT');
  } catch {}
  // 管理员"确认热门"标记（区别于用户上传时的 is_hot 意愿标记，仅确认后的作品进热门位且不可召回）
  try {
    await db.run('ALTER TABLE photos ADD COLUMN is_hot_confirmed INTEGER NOT NULL DEFAULT 0');
  } catch {}
  // 审核分配：管理员将待审照片指派给指定审核员
  try {
    await db.run('ALTER TABLE photos ADD COLUMN assigned_to TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE articles ADD COLUMN type TEXT NOT NULL DEFAULT \'column\'');
  } catch {}
  try {
    await db.run('ALTER TABLE articles ADD COLUMN board_id TEXT');
  } catch {}
  // 一级处罚：限制上传至该时间点（ISO 字符串），到期自动恢复上传能力
  try {
    await db.run('ALTER TABLE users ADD COLUMN upload_banned_until TEXT');
  } catch {}

  // ==========================================================================
  // V4.1.0 迭代：处罚分级与公告横幅
  // penalties 加三级语义列（capabilities 能力快照 / revoked_at / revoked_by 撤销留痕）；
  // users 加 L3 限时封禁解禁时间（banned_until）、归属省份（region，登录采集）、
  // 封禁管理授权（can_ban_manage）；公告表 announcements 在基线 DDL 中创建
  // ==========================================================================
  try {
    await db.run('ALTER TABLE penalties ADD COLUMN capabilities TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE penalties ADD COLUMN revoked_at TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE penalties ADD COLUMN revoked_by TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN banned_until TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN region TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_ban_manage INTEGER NOT NULL DEFAULT 0');
  } catch {}
  // V4.1.0 Wave 3A：权限项扩展至七项 — 评论与论坛发帖权限（1=允许，0=禁止）
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_comment INTEGER DEFAULT 1');
  } catch {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN can_forum_post INTEGER DEFAULT 1');
  } catch {}

  // V4.1.2-beta.3：申诉裁决增加审核员责任判定（none|mistake|violation）与责任审核员快照
  try {
    await db.run('ALTER TABLE appeals ADD COLUMN reviewer_fault TEXT');
  } catch {}
  try {
    await db.run('ALTER TABLE appeals ADD COLUMN reviewer_admin_id TEXT');
  } catch {}

  // 存量处罚语义一次性迁移（V4.0.0 两级 → V4.1.0 三级）：
  // 旧 L1（限制上传）→ 现 L2 功能封禁（capabilities 快照 ["upload"]，期限沿用原 expires_at）；
  // 旧 L2（封禁账号）→ 现 L3 账号封禁（capabilities ["all"]，users 表 banned_at 效果不变）。
  // 幂等条件 = capabilities IS NULL（迁移后不再命中），新代码创建记录必写 capabilities
  try {
    await db.run(
      `UPDATE penalties SET level = 2, capabilities = '["upload"]' WHERE level = 1 AND capabilities IS NULL`
    );
    await db.run(
      `UPDATE penalties SET level = 3, capabilities = '["all"]' WHERE level = 2 AND capabilities IS NULL`
    );
  } catch {}

  // V1.13.0 管理员安全：强制改密标记 + JWT 版本号（改密即作废旧 JWT）
  try {
    await db.run('ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    await db.run('ALTER TABLE admin_users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  } catch {}

  // ==========================================================================
  // V2.0.0：全面移除手机号体系，email 成为唯一账号标识
  // 1) 删除扫描探测垃圾账号 2) 清空短信验证码记录
  // 3) users 表重建去除 phone/phone_verified（含老库 email NOT NULL 解除）
  // 4) admin_users 表重建去除 phone/phone_verified
  // 全部步骤幂等；任何破坏性操作前先做整库文件备份
  // ==========================================================================

  const v2BackupPath = `${dbPath}.bak-v2-${Date.now()}`;
  let v2BackedUp = false;
  const ensureV2Backup = () => {
    if (!v2BackedUp) {
      fs.copyFileSync(dbPath, v2BackupPath);
      v2BackedUp = true;
    }
  };

  // 1) 探测垃圾账号：仅当无照片/点赞/浏览关联时删除，防止误删同名真实用户
  const probeAccounts = (await db.all(
    "SELECT id, username FROM users WHERE email IN ('agent.probe.9f2@example.com','agent.probe.role.a7@example.com')"
  )) as Array<{ id: string; username: string }>;
  for (const probe of probeAccounts) {
    const rel = (await db.get(
      `SELECT
         (SELECT COUNT(*) FROM photos WHERE user_id = ?) AS photos,
         (SELECT COUNT(*) FROM photo_likes WHERE user_id = ?) AS likes,
         (SELECT COUNT(*) FROM photo_views WHERE viewer_key = ?) AS views`,
      [probe.id, probe.id, `user:${probe.id}`]
    )) as { photos: number; likes: number; views: number };
    if (rel.photos === 0 && rel.likes === 0 && rel.views === 0) {
      ensureV2Backup();
      await db.run('DELETE FROM users WHERE id = ?', [probe.id]);
      console.log(`[DB V2.0.0] 已删除探测账号: ${probe.username}`);
    } else {
      console.warn(`[DB V2.0.0] 探测账号存在关联数据，跳过删除: ${probe.username}`);
    }
  }

  // 2) 清空短信验证码记录（表保留，收敛为纯邮箱验证码）
  const smsCodeCount = (await db.get("SELECT COUNT(*) AS c FROM verification_codes WHERE channel='sms'")) as { c: number };
  if (smsCodeCount.c > 0) {
    ensureV2Backup();
    await db.run("DELETE FROM verification_codes WHERE channel='sms'");
  }

  // 3)/4) 表重建：检测是否仍残留手机列（users 另含 email NOT NULL 老库场景）
  const userCols = (await db.all('PRAGMA table_info(users)')) as Array<{ name: string; notnull: number }>;
  const usersNeedsRebuild =
    userCols.some((c) => c.name === 'phone' || c.name === 'phone_verified') ||
    (userCols.find((c) => c.name === 'email')?.notnull ?? 0) === 1;

  const adminCols = (await db.all('PRAGMA table_info(admin_users)')) as Array<{ name: string }>;
  const adminNeedsRebuild = adminCols.some((c) => c.name === 'phone' || c.name === 'phone_verified');

  if (usersNeedsRebuild || adminNeedsRebuild) {
    ensureV2Backup();
    const beforeUserCount = (await db.get('SELECT COUNT(*) AS c FROM users')) as { c: number };
    const beforeAdminCount = (await db.get('SELECT COUNT(*) AS c FROM admin_users')) as { c: number };

    // 重建期间关闭外键检查，避免 DROP TABLE 触发子表级联；PRAGMA 不能在事务内切换
    await db.exec('PRAGMA foreign_keys=OFF');
    try {
      await db.exec('BEGIN');

      if (usersNeedsRebuild) {
        await db.exec(`
          CREATE TABLE users_new (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            username TEXT,
            avatar_url TEXT,
            bio TEXT,
            website TEXT,
            location TEXT,
            custom_fields TEXT,
            wechat_openid TEXT,
            qq_openid TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            banned_at TEXT,
            banned_until TEXT,
            can_upload INTEGER DEFAULT 1,
            can_view INTEGER DEFAULT 1,
            can_download INTEGER DEFAULT 1,
            can_like INTEGER DEFAULT 1,
            can_comment INTEGER DEFAULT 1,
            can_forum_post INTEGER DEFAULT 1,
            region TEXT,
            can_ban_manage INTEGER NOT NULL DEFAULT 0,
            email_verified INTEGER NOT NULL DEFAULT 0
          );
        `);
        await db.exec(`
          INSERT INTO users_new
            (id, email, password_hash, username, avatar_url, bio, website, location, custom_fields,
             wechat_openid, qq_openid, is_active, created_at, updated_at, banned_at, banned_until,
             can_upload, can_view, can_download, can_like, can_comment, can_forum_post, region, can_ban_manage, email_verified)
          SELECT
            id, email, password_hash, username, avatar_url, bio, website, location, custom_fields,
            wechat_openid, qq_openid, is_active, created_at, updated_at, banned_at, banned_until,
            can_upload, can_view, can_download, can_like, can_comment, can_forum_post, region, can_ban_manage, email_verified
          FROM users
        `);
        await db.exec('DROP TABLE users');
        await db.exec('ALTER TABLE users_new RENAME TO users');

        const afterUserCount = (await db.get('SELECT COUNT(*) AS c FROM users')) as { c: number };
        if (afterUserCount.c !== beforeUserCount.c) {
          throw new Error(`users 重建行数不一致: ${beforeUserCount.c} -> ${afterUserCount.c}`);
        }
      }

      if (adminNeedsRebuild) {
        await db.exec(`
          CREATE TABLE admin_users_new (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE,
            name TEXT,
            role TEXT NOT NULL DEFAULT 'zone_auditor',
            zone TEXT DEFAULT 'default',
            is_active INTEGER DEFAULT 1,
            must_change_password INTEGER NOT NULL DEFAULT 0,
            token_version INTEGER NOT NULL DEFAULT 0,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await db.exec(`
          INSERT INTO admin_users_new
            (id, username, password_hash, email, name, role, zone, is_active,
             must_change_password, token_version, created_by, created_at, updated_at)
          SELECT
            id, username, password_hash, email, name, role, zone, is_active,
            must_change_password, token_version, created_by, created_at, updated_at
          FROM admin_users
        `);
        await db.exec('DROP TABLE admin_users');
        await db.exec('ALTER TABLE admin_users_new RENAME TO admin_users');

        const afterAdminCount = (await db.get('SELECT COUNT(*) AS c FROM admin_users')) as { c: number };
        if (afterAdminCount.c !== beforeAdminCount.c) {
          throw new Error(`admin_users 重建行数不一致: ${beforeAdminCount.c} -> ${afterAdminCount.c}`);
        }
      }

      await db.exec('COMMIT');
      console.log(
        `[DB V2.0.0] 表重建完成: users=${beforeUserCount.c}${usersNeedsRebuild ? '(已去手机列)' : ''}, admin_users=${beforeAdminCount.c}${adminNeedsRebuild ? '(已去手机列)' : ''}`
      );
    } catch (migrationError) {
      await db.exec('ROLLBACK');
      throw migrationError;
    } finally {
      await db.exec('PRAGMA foreign_keys=ON');
    }
  }

  // ==========================================================================
  // V3.0.0：评论体系通用化（subject_type + subject_id，三级嵌套）
  // 旧表探测/备份/改名在基线 DDL 前完成（见 initSchema 开头），本块负责：
  // 旧行逐条迁移为 article 型 L1（保留 id/作者/内容/时间）→ 初始化热度 →
  // 回填文章评论计数 → 校验行数 → 删除旧表。全部步骤幂等，可中断恢复。
  // ==========================================================================
  if (commentsLegacyPending) {
    const legacyRows = (await db.all(
      'SELECT id, article_id, author, content, created_at FROM comments_legacy ORDER BY created_at'
    )) as Array<{ id: string; article_id: string; author: string; content: string; created_at: string }>;

    const retainDays = Number(process.env.COMMENT_RETAIN_DAYS) || 10;
    const now = Date.now();

    for (const row of legacyRows) {
      await db.run(
        `INSERT OR IGNORE INTO comments
           (id, subject_type, subject_id, root_id, parent_id, depth, user_id,
            author, reply_to_user_id, reply_to_user_name, content, like_count, created_at)
         VALUES (?, 'article', ?, ?, NULL, 1, NULL, ?, NULL, NULL, ?, 0, ?)`,
        [row.id, row.article_id, row.id, row.author, row.content, row.created_at]
      );
      // 热度初始化：normal 档，retain_until = 发布时间 + 基础保留天数
      const retainUntil = new Date(new Date(row.created_at).getTime() + retainDays * 86400000).toISOString();
      await db.run(
        `INSERT OR IGNORE INTO comment_heat
           (root_id, reply_count, like_count, score, velocity, tier, last_calc_at, retain_until, pinned)
         VALUES (?, 0, 0, 0, 0, 'normal', ?, ?, 0)`,
        [row.id, new Date(now).toISOString(), retainUntil]
      );
    }

    // 回填文章评论计数，保证与新表口径一致
    await db.run(
      `UPDATE articles SET comment_count =
         (SELECT COUNT(*) FROM comments
          WHERE subject_type = 'article' AND subject_id = articles.id)`
    );

    const migratedCount = (await db.get(
      "SELECT COUNT(*) AS c FROM comments WHERE subject_type = 'article'"
    )) as { c: number };
    if (migratedCount.c !== legacyRows.length) {
      throw new Error(`评论迁移行数不一致: ${legacyRows.length} -> ${migratedCount.c}`);
    }

    await db.run('DROP TABLE comments_legacy');
    console.log(`[DB V3.0.0] 旧单层评论迁移完成: ${migratedCount.c} 条（article L1）`);
  }
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

  // V4.8.0：不再插入演示文章（过往测试文章已删除，首页专栏入口改为「最近新闻」）

  // 评论表为空时插入演示评论（V3.0.0：通用三级结构），时间偏移模拟递减发布
  const commentCount = await db.get('SELECT COUNT(*) as count FROM comments');
  if (commentCount.count === 0) {
    const retainDays = Number(process.env.COMMENT_RETAIN_DAYS) || 10;
    // 演示数据：照片 000001 的三级嵌套线程（含 L3 互回平铺）；V4.8.0 移除文章演示评论
    const seedComments: Array<{
      id: string; subject_type: string; subject_id: string; root_id: string;
      parent_id: string | null; depth: number; user_id: string | null; author: string;
      reply_to_user_id?: string; reply_to_user_name?: string;
      content: string; created_at: Date;
    }> = [
      // 照片三级嵌套演示：L1 → L2 → L3 → 对 L3 再回复（仍 depth=3，平铺）
      { id: 'pcomment_001', subject_type: 'photo', subject_id: '000001', root_id: 'pcomment_001', parent_id: null, depth: 1, user_id: null, author: '路过的机长', content: '这张光影抓得太准了！', created_at: new Date(Date.now() - 900000) },
      { id: 'pcomment_002', subject_type: 'photo', subject_id: '000001', root_id: 'pcomment_001', parent_id: 'pcomment_001', depth: 2, user_id: null, author: '摄影博主', content: '同意，逆光还能压住高光不容易。', created_at: new Date(Date.now() - 800000) },
      { id: 'pcomment_003', subject_type: 'photo', subject_id: '000001', root_id: 'pcomment_001', parent_id: 'pcomment_002', depth: 3, user_id: null, author: '新人小白', reply_to_user_name: '摄影博主', content: '请问这是用什么滤镜拍的？', created_at: new Date(Date.now() - 700000) },
      { id: 'pcomment_004', subject_type: 'photo', subject_id: '000001', root_id: 'pcomment_001', parent_id: 'pcomment_003', depth: 3, user_id: null, author: '摄影博主', reply_to_user_name: '新人小白', content: '没用滤镜，RAW 后期拉的阴影。', created_at: new Date(Date.now() - 600000) },
    ];

    // 每个 L1 线程的基础热度初始化
    const heatByRoot = new Map<string, { replies: number }>();
    for (const c of seedComments) {
      if (c.depth > 1) {
        const prev = heatByRoot.get(c.root_id) ?? { replies: 0 };
        prev.replies += 1;
        heatByRoot.set(c.root_id, prev);
      }
      await db.run(
        `INSERT INTO comments
           (id, subject_type, subject_id, root_id, parent_id, depth, user_id, author,
            reply_to_user_id, reply_to_user_name, content, like_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [c.id, c.subject_type, c.subject_id, c.root_id, c.parent_id, c.depth, c.user_id,
         c.author, c.reply_to_user_id ?? null, c.reply_to_user_name ?? null,
         c.content, c.created_at.toISOString()]
      );
    }
    const roots = new Set(seedComments.map((c) => c.root_id));
    for (const rootId of roots) {
      const root = seedComments.find((c) => c.id === rootId)!;
      const replies = heatByRoot.get(rootId)?.replies ?? 0;
      const retainUntil = new Date(root.created_at.getTime() + retainDays * 86400000).toISOString();
      await db.run(
        `INSERT OR IGNORE INTO comment_heat
           (root_id, reply_count, like_count, score, velocity, tier, last_calc_at, retain_until, pinned)
         VALUES (?, ?, 0, ?, 0, 'normal', ?, ?, 0)`,
        [rootId, replies, replies * 2, new Date().toISOString(), retainUntil]
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

  // V4.0.0：论坛板块收敛为 航空/铁路/公路 三大基础板块。
  // 按板块名判断，缺则插入（幂等）；历史遗留板块（如 V3.1.0 的 general 等）不删除，
  // 仅保证三大板块始终存在。CANONICAL_FORUM_BOARDS 同时作为板块管理端点的白名单来源。
  for (const b of CANONICAL_FORUM_BOARDS) {
    const exists = await db.get('SELECT id FROM forum_boards WHERE id = ? OR name = ?', [b.id, b.name]);
    if (!exists) {
      await db.run(
        'INSERT INTO forum_boards (id, name, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
        [b.id, b.name, b.description, b.icon, b.sort_order]
      );
    }
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
