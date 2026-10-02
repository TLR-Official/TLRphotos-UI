/**
 * 管理后台类型定义
 * 定义管理员、登录响应、审核照片、统计、操作日志与用户等数据结构，供后台页面与 API 共享。
 */

/** 管理员用户（含角色与所属分区） */
export interface AdminUser {
  id: string;
  username: string;
  name?: string;
  email?: string;
  role: 'super' | 'zone_master' | 'zone_auditor';
  zone: string;
  is_active: number;
  /** V1.13.0：1=必须完成改密后才能访问其他后台接口 */
  must_change_password?: number;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

/** 登录第一阶段响应 */
export interface LoginResponse {
  success: boolean;
  token?: string;
  admin?: AdminUser;
  message?: string;
  /** 超管密码通过：需进入短信验证码第二阶段 */
  sms_required?: boolean;
  /** 短信登录票据（5 分钟有效，绑定用户名与 IP） */
  ticket?: string;
  /** 人机验证失败 / 登录锁定 / 超管未绑手机等机器可识别错误码 */
  code?:
    | 'HUMAN_VERIFICATION_FAILED'
    | 'ADMIN_LOGIN_LOCKED'
    | 'SUPER_PHONE_NOT_VERIFIED'
    | 'INVALID_LOGIN_TICKET'
    | string;
  data?: { retry_after_seconds?: number };
}

/** 超管短信验证码发送响应 */
export interface AdminSmsSendResponse {
  success: boolean;
  message?: string;
  code?: string;
  /** 重新发送冷却秒数 */
  cooldown_seconds?: number;
}

/** 超管短信验证码校验响应（通过即签发 JWT） */
export interface AdminSmsVerifyResponse {
  success: boolean;
  token?: string;
  admin?: AdminUser;
  message?: string;
  code?: 'ADMIN_LOGIN_LOCKED' | string;
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
  created_at: string;
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
  likes: number;
  views: number;
  created_at: string;
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
  email: string;
  username?: string;
  avatar_url?: string;
  is_active: number;
  created_at: string;
  /** V1.7.0：封禁时间戳，非空表示已封禁 */
  banned_at?: string | null;
  /** V1.7.0：四项功能权限（1=允许，0=禁止） */
  can_upload?: number;
  can_view?: number;
  can_download?: number;
  can_like?: number;
}