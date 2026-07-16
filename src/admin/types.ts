export interface AdminUser {
  id: string;
  username: string;
  name?: string;
  email?: string;
  role: 'super' | 'zone_master' | 'zone_auditor';
  zone: string;
  is_active: number;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  admin?: AdminUser;
  message?: string;
}

export interface AdminPhoto {
  id: string;
  title: string;
  thumbnail_path: string;
  original_url: string;
  preview_url?: string;
  watermarked_url?: string;
  status: 'pending' | 'approved' | 'rejected';
  user_id?: string;
  uploader_name?: string;
  uploader_avatar?: string;
  tags?: string;
  description?: string;
  width?: number;
  height?: number;
  category?: string;
  created_at: string;
}

export interface AuditStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface SystemStats {
  userCount: number;
  photoCount: number;
  adminCount: number;
  todayUploads: number;
  pendingCount: number;
}

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

export interface User {
  id: string;
  email: string;
  username?: string;
  avatar_url?: string;
  is_active: number;
  created_at: string;
}