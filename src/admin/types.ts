/**
 * 管理后台类型定义
 * 定义管理员、登录响应、审核照片、统计、操作日志与用户等数据结构，供后台页面与 API 共享。
 */

/** 管理员用户（含角色与所属分区）；V4.0.0 角色枚举扩展 forum_moderator / news_editor */
export interface AdminUser {
  id: string;
  username: string;
  name?: string;
  email?: string;
  role: 'super' | 'zone_master' | 'zone_auditor' | 'forum_moderator' | 'news_editor';
  zone: string;
  is_active: number;
  /** V1.13.0：1=必须完成改密后才能访问其他后台接口 */
  must_change_password?: number;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

/** 登录响应（V2.0.0：全角色单阶段直发 token） */
export interface LoginResponse {
  success: boolean;
  token?: string;
  admin?: AdminUser;
  message?: string;
  /** 人机验证失败 / 登录锁定等机器可识别错误码 */
  code?:
    | 'HUMAN_VERIFICATION_FAILED'
    | 'ADMIN_LOGIN_LOCKED'
    | string;
  data?: { retry_after_seconds?: number };
}

/** 修改自身密码接口响应 */
export interface ChangePasswordResponse {
  success: boolean;
  message?: string;
  /** 改密成功后签发的新 JWT（旧 JWT 已失效） */
  token?: string;
  admin?: AdminUser;
}

/** 后台审核列表中的照片项 */
export interface AdminPhoto {
  id: string;
  title: string;
  thumbnail_path: string;
  original_url: string;
  status: 'pending' | 'approved' | 'rejected';
  user_id?: string;
  uploader_name?: string;
  uploader_avatar?: string;
  /** V4.7.0：上传者称号（邀请码授予，未获称号为 null） */
  uploader_title?: string | null;
  created_at: string;
  /** 飞机注册号（旧数据可能为 null） */
  registration_number?: string | null;
  /** 热门意愿标记：1=上传者愿意推荐为热门 */
  is_hot?: number;
}

/** 管理员照片详情（包含完整元数据） */
export interface AdminPhotoDetail {
  id: string;
  title: string;
  thumbnail_path: string;
  original_url: string;
  preview_url?: string;
  watermarked_url?: string;
  watermark_config?: {
    text: string;
    x: number;
    y: number;
    opacity: number;
    size: number;
  } | null;
  tags: string[];
  structured_tags?: Record<string, any>;
  width: number;
  height: number;
  description: string;
  camera_model: string;
  vehicle: string;
  location: string;
  focal_length: string;
  iso: number;
  shutter_speed: string;
  aperture: string;
  category?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  user_id?: string;
  uploader_name?: string;
  uploader_avatar?: string;
  /** V4.7.0：上传者称号（邀请码授予，未获称号为 null） */
  uploader_title?: string | null;
  likes: number;
  views: number;
  created_at: string;
  /** 飞机注册号（旧数据可能为 null） */
  registration_number?: string | null;
  /** 热门意愿标记：1=上传者愿意推荐为热门 */
  is_hot?: number;
  /** V4.0.0：管理员确认热门标记，1=已确认热门（确认后禁止召回） */
  is_hot_confirmed?: number;
  /** V4.0.0：审核留痕（存量 approved 可能为 null） */
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  /** V4.0.0：分配的审核员管理员 ID（未分配为 null） */
  assigned_to?: string | null;
}

/** V4.0.0：申诉条目（管理端 GET /appeals 联表字段） */
export type AppealStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface Appeal {
  id: string;
  photo_id: string;
  user_id: string;
  /** 申诉理由 */
  reason: string;
  status: AppealStatus;
  /** 裁决答复（未裁决为 null） */
  response: string | null;
  decided_by?: string | null;
  decided_at: string | null;
  created_at: string;
  /** 联表字段：照片标题与照片当前状态 */
  photo_title?: string | null;
  photo_status?: string | null;
  /** 联表字段：申诉人用户名 */
  appellant_name?: string | null;
  /** V4.7.0：申诉人称号（邀请码授予，未获称号为 null） */
  appellant_title?: string | null;
  /** 联表字段：原审核员管理员 ID（照片 reviewed_by） */
  original_reviewer_id?: string | null;
  /** 联表字段：原审核员用户名 */
  reviewer_name?: string | null;
  /** 审核员责任判定（V4.1.2-beta.3）：none=无责 / mistake=审核失误 / violation=审核违规 */
  reviewer_fault?: 'none' | 'mistake' | 'violation' | null;
  /** 被判定有责的审核员管理员 ID */
  reviewer_admin_id?: string | null;
}

/** V4.0.0：处罚记录（V4.1.0 扩展三级语义：1=警告 / 2=功能封禁 / 3=账号封禁） */
export interface Penalty {
  id: string;
  user_id: string;
  /** 处罚级别：1=警告，2=功能封禁（capabilities 快照），3=账号封禁 */
  level: 1 | 2 | 3;
  reason: string;
  days: number | null;
  expires_at: string | null;
  /** V4.1.0：L2 能力快照（upload/comment/forum_post 子集；L3 为 ["all"]，L1 为 []） */
  capabilities: string[];
  /** V4.1.0：撤销留痕（未撤销为 null） */
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string;
  created_at: string;
  /** 联表字段：处罚操作人用户名 */
  created_by_name?: string | null;
  /** 联表字段：撤销操作人用户名 */
  revoked_by_name?: string | null;
}

/** V4.1.2-beta.3：审核员处分记录（由申诉裁决判定有责时生成，仅 super 可查） */
export interface AdminWarning {
  id: string;
  /** 被处分的审核员管理员 ID */
  admin_id: string;
  appeal_id: string | null;
  photo_id: string | null;
  /** warning=审核失误（警告留痕）/ penalty=审核违规（待处罚） */
  severity: 'warning' | 'penalty';
  reason: string;
  created_by: string;
  created_at: string;
  /** 联表字段：被处分审核员用户名 */
  admin_name?: string | null;
  /** 联表字段：记录人用户名 */
  created_by_name?: string | null;
  /** 联表字段：关联照片标题 */
  photo_title?: string | null;
}

/** V4.3.0：论坛板块（管理端 GET /forum/boards 全量含停用） */
export interface ForumBoard {
  id: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  thread_count: number;
  /** 1=启用 / 0=停用 */
  is_active: number;
}

/** V4.3.0：论坛帖子列表项（公开接口 GET /api/forum/threads） */
export interface ForumThreadItem {
  id: string;
  board_id: string;
  title: string;
  author_id: string;
  author_name: string;
  /** V4.7.0：作者称号快照（未获称号为 null） */
  author_title?: string | null;
  /** 1=置顶 */
  is_pinned: number;
  view_count: number;
  like_count: number;
  reply_count: number;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
  last_reply_at: string | null;
}

/** V4.9.0：单通道指标（注册/上传） */
export interface MetricChannelStats {
  attempts: number;
  success: number;
  client_error: number;
  failure: number;
  /** 成功率（失败/(成功+失败)）；样本不足时为 null */
  success_rate: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

/** V4.9.0：核心链路实时指标（GET /api/admin/metrics） */
export interface CoreMetrics {
  window_ms: number;
  sampled_at: string;
  register: MetricChannelStats;
  upload: MetricChannelStats;
  resources: {
    cpu_percent: number;
    cpu_count: number;
    load1: number;
    rss_bytes: number;
    rss_pct: number;
    heap_used_bytes: number;
    system_total_bytes: number;
    system_free_bytes: number;
  };
  alerts: { key: string; level: 'warn' | 'critical'; message: string }[];
  degraded_mode: boolean;
}

/** V4.7.0：邀请码（管理端 GET /api/admin/invites） */
export interface InviteCode {
  id: string;
  /** 邀请码（大写） */
  code: string;
  /** 注册成功后授予的称号文案 */
  title: string;
  /** 关联航司（可选） */
  airline: string | null;
  /** 可用次数上限 */
  max_uses: number;
  /** 已使用次数 */
  used_count: number;
  /** 1=启用 / 0=停用 */
  is_active: number;
  expires_at: string | null;
  remark: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** 邀请码创建/更新入参 */
export interface InviteCodePayload {
  code?: string;
  title?: string;
  airline?: string;
  max_uses?: number;
  expires_at?: string | null;
  remark?: string;
  is_active?: boolean;
}

/** V4.1.0：站点公告条目（管理端 GET /announcements 全量含已下线） */
export interface Announcement {
  id: string;
  title: string;
  content: string;
  /** 封面图 URL（未设置为 null） */
  cover_url: string | null;
  /** 1=上线中，0=已下线 */
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** V4.1.0：公告创建/编辑请求体 */
export interface AnnouncementPayload {
  title: string;
  content: string;
  /** 可选：http(s) 链接 ≤500 字符 */
  cover_url?: string;
}

/** 照片审核统计 */
export interface AuditStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  /** V1.5.0：当前管理员所属分区名（zone_master/zone_auditor），super 时为 null */
  zoneName?: string | null;
}

/** 系统总览统计（仪表盘使用） */
export interface SystemStats {
  userCount: number;
  photoCount: number;
  adminCount: number;
  todayUploads: number;
  pendingCount: number;
  /** V1.5.0：当前管理员所属分区名（zone_master/zone_auditor），super 时为 null */
  zoneName?: string | null;
}

/** 仪表盘健康检查结果（V1.5.0 新增） */
export interface DashboardHealth {
  healthy: boolean;
  issues: string[];
  checked_at: string;
}

/** 管理员操作日志 */
export interface AdminLog {
  id: string;
  admin_id: string;
  admin_name: string;
  action: string;
  target_type?: string;
  target_id?: string;
  details?: string;
  ip?: string;
  created_at: string;
}

/** 后台用户管理中的普通用户 */
export interface User {
  id: string;
  /** V2.0.0：过渡期可能为空，绑定邮箱后必填 */
  email?: string | null;
  /** V2.0.0：1=邮箱已验证，0=待验证（功能受限） */
  email_verified?: number;
  username?: string;
  avatar_url?: string;
  is_active: number;
  created_at: string;
  /** V1.7.0：封禁时间戳，非空表示已封禁 */
  banned_at?: string | null;
  /** V4.1.0：L3 限时封禁解禁时间（永久封禁为 null） */
  banned_until?: string | null;
  /** V4.1.0：归属省份（登录采集，未采集为 null） */
  region?: string | null;
  /** V4.1.0：七项功能权限（1=允许，0=禁止） */
  can_upload?: number;
  can_view?: number;
  can_download?: number;
  can_like?: number;
  can_comment?: number;
  can_forum_post?: number;
  /** 封禁管理权限项（仅存储与展示，无普通用户执法点） */
  can_ban_manage?: number;
  /** V4.7.0：邀请码授予的专属称号（未获称号为 null） */
  user_title?: string | null;
}