/**
 * 管理后台 API 模块
 * 封装后台所有接口请求：鉴权、管理员账户 CRUD、照片审核、用户管理、操作日志与系统统计。
 * token 内存缓存与 localStorage 同步，所有需鉴权接口自动附带 Authorization 头。
 */
import type { LoginResponse, AdminUser, AdminPhoto, AuditStats, SystemStats, AdminLog, User } from './types';

/** 后台接口前缀 */
const API_BASE = '/api/admin';

// 模块级 token 缓存：初始化时从 localStorage 读取，避免每次请求都访问存储
let token: string | null = localStorage.getItem('admin_token');

/**
 * 设置/清除管理员 token
 * 同步更新内存缓存与 localStorage，传 null 表示退出登录。
 * @param newToken 新 token 或 null
 */
export function setAdminToken(newToken: string | null) {
  token = newToken;
  if (newToken) {
    localStorage.setItem('admin_token', newToken);
  } else {
    localStorage.removeItem('admin_token');
  }
}

/** 获取当前内存中的 token（供路由守卫判断登录态使用） */
export function getAdminToken() {
  return token;
}

/**
 * 管理员登录
 * @param username 用户名
 * @param password 密码
 * @returns 登录响应（含 token 与管理员信息）
 */
export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return response.json();
}

/**
 * 获取当前登录管理员信息
 * 无 token 直接返回失败，避免无意义请求。
 * @returns 管理员信息或失败消息
 */
export async function getCurrentAdmin(): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  if (!token) {
    return { success: false, message: '未登录' };
  }
  const response = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 创建管理员账户
 * 仅允许创建 zone_master / zone_auditor 角色，super 由后端预置。
 * @param data 新管理员信息
 */
export async function createAdmin(data: {
  username: string;
  password: string;
  email?: string;
  name?: string;
  role: 'zone_master' | 'zone_auditor';
  zone: string;
}): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

/**
 * 查询管理员列表
 * @param role 按角色过滤（可选）
 * @param zone 按分区过滤（可选）
 */
export async function getAdminUsers(role?: string, zone?: string): Promise<{ success: boolean; data?: AdminUser[] }> {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (zone) params.set('zone', zone);
  const response = await fetch(`${API_BASE}/users?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 更新管理员信息
 * 仅支持修改邮箱、姓名、角色、分区、启用状态等字段。
 * @param id 管理员 id
 * @param data 待更新字段
 */
export async function updateAdmin(id: string, data: Partial<Pick<AdminUser, 'email' | 'name' | 'role' | 'zone' | 'is_active'>>): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

/**
 * 删除管理员
 * @param id 管理员 id
 */
export async function deleteAdmin(id: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 分页拉取待审核照片
 * @param page 页码（默认 1）
 * @param pageSize 每页数量（默认 20）
 */
export async function getPendingPhotos(page = 1, pageSize = 20): Promise<{ success: boolean; data?: AdminPhoto[]; pagination?: { page: number; pageSize: number; total: number } }> {
  const response = await fetch(`${API_BASE}/photos/pending?page=${page}&pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 通过照片审核
 * @param id 照片 id
 */
export async function approvePhoto(id: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/photos/${id}/approve`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 拒绝照片审核
 * @param id 照片 id
 * @param reason 拒绝原因（可选）
 */
export async function rejectPhoto(id: string, reason?: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/photos/${id}/reject`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return response.json();
}

/** 获取照片审核分布统计（待审核 / 已通过 / 已拒绝） */
export async function getPhotoStats(): Promise<{ success: boolean; data?: AuditStats }> {
  const response = await fetch(`${API_BASE}/photos/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 分页查询普通用户
 * @param page 页码
 * @param pageSize 每页数量
 * @param keyword 搜索关键字（用户名或邮箱，可选）
 */
export async function getUsers(page = 1, pageSize = 20, keyword = ''): Promise<{ success: boolean; data?: User[]; pagination?: { page: number; pageSize: number; total: number } }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (keyword) params.set('keyword', keyword);
  const response = await fetch(`${API_BASE}/users/list?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 切换用户启用/禁用状态
 * @param id 用户 id
 */
export async function toggleUser(id: string): Promise<{ success: boolean; message?: string; data?: { is_active: number } }> {
  const response = await fetch(`${API_BASE}/users/${id}/toggle`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/**
 * 分页拉取管理员操作日志
 * @param page 页码（默认 1）
 * @param pageSize 每页数量（默认 50）
 */
export async function getLogs(page = 1, pageSize = 50): Promise<{ success: boolean; data?: AdminLog[]; pagination?: { page: number; pageSize: number; total: number } }> {
  const response = await fetch(`${API_BASE}/logs?page=${page}&pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

/** 获取系统总览统计（用户数、照片数、今日上传数、待审核数） */
export async function getStats(): Promise<{ success: boolean; data?: SystemStats }> {
  const response = await fetch(`${API_BASE}/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}