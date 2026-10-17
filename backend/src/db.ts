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
            can_upload INTEGER DEFAULT 1,
            can_view INTEGER DEFAULT 1,
            can_download INTEGER DEFAULT 1,
            can_like INTEGER DEFAULT 1,
            email_verified INTEGER NOT NULL DEFAULT 0
          );
        `);
        await db.exec(`
          INSERT INTO users_new
            (id, email, password_hash, username, avatar_url, bio, website, location, custom_fields,
             wechat_openid, qq_openid, is_active, created_at, updated_at, banned_at,
             can_upload, can_view, can_download, can_like, email_verified)
          SELECT
            id, email, password_hash, username, avatar_url, bio, website, location, custom_fields,
            wechat_openid, qq_openid, is_active, created_at, updated_at, banned_at,
            can_upload, can_view, can_download, can_like, email_verified
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

  // 评论表为空时插入演示评论（V3.0.0：通用三级结构），时间偏移模拟递减发布
  const commentCount = await db.get('SELECT COUNT(*) as count FROM comments');
  if (commentCount.count === 0) {
    const retainDays = Number(process.env.COMMENT_RETAIN_DAYS) || 10;
    // 演示数据：文章 L1 评论 + 照片 000001 的三级嵌套线程（含 L3 互回平铺）
    const seedComments: Array<{
      id: string; subject_type: string; subject_id: string; root_id: string;
      parent_id: string | null; depth: number; user_id: string | null; author: string;
      reply_to_user_id?: string; reply_to_user_name?: string;
      content: string; created_at: Date;
    }> = [
      { id: 'comment_001', subject_type: 'article', subject_id: 'article_001', root_id: 'comment_001', parent_id: null, depth: 1, user_id: null, author: '摄影爱好者', content: '这篇文章太棒了！', created_at: new Date(Date.now() - 3600000) },
      { id: 'comment_002', subject_type: 'article', subject_id: 'article_001', root_id: 'comment_002', parent_id: null, depth: 1, user_id: null, author: '技术达人', content: '公式渲染特别清晰！', created_at: new Date(Date.now() - 7200000) },
      { id: 'comment_003', subject_type: 'article', subject_id: 'article_002', root_id: 'comment_003', parent_id: null, depth: 1, user_id: null, author: '新手玩家', content: '学到了很多技巧！', created_at: new Date(Date.now() - 1800000) },
      { id: 'comment_004', subject_type: 'article', subject_id: 'article_002', root_id: 'comment_004', parent_id: null, depth: 1, user_id: null, author: '资深飞手', content: '补充一点，飞行前一定要检查电池！', created_at: new Date(Date.now() - 5400000) },
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

  // V3.1.0：论坛默认板块（仅在板块表为空时 seed）
  const boardCount = await db.get('SELECT COUNT(*) as count FROM forum_boards');
  if (boardCount.count === 0) {
    const defaultBoards = [
      { id: 'general', name: '综合讨论', description: '畅所欲言的综合话题区', icon: '💬', sort_order: 1 },
      { id: 'aerial-photo', name: '航拍作品', description: '分享航拍照片与拍摄心得', icon: '✈️', sort_order: 2 },
      { id: 'tech-talk', name: '技术交流', description: '器材、后期、飞控技术讨论', icon: '🔧', sort_order: 3 },
    ];
    for (const b of defaultBoards) {
      await db.run(
        'INSERT OR IGNORE INTO forum_boards (id, name, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
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
