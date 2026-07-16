import type { LoginResponse, AdminUser, AdminPhoto, AuditStats, SystemStats, AdminLog, User } from './types';

const API_BASE = '/api/admin';

let token: string | null = localStorage.getItem('admin_token');

export function setAdminToken(newToken: string | null) {
  token = newToken;
  if (newToken) {
    localStorage.setItem('admin_token', newToken);
  } else {
    localStorage.removeItem('admin_token');
  }
}

export function getAdminToken() {
  return token;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return response.json();
}

export async function getCurrentAdmin(): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  if (!token) {
    return { success: false, message: '未登录' };
  }
  const response = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function createAdmin(data: {
  username: string;
  password: string;
  email?: string;
  name?: string;
  role: 'super' | 'zone_master' | 'zone_auditor';
  zone: string;
}): Promise<{ success: boolean; data?: AdminUser; message?: string }> {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function getAdminUsers(role?: string, zone?: string): Promise<{ success: boolean; data?: AdminUser[] }> {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (zone) params.set('zone', zone);
  const response = await fetch(`${API_BASE}/users?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function updateAdmin(id: string, data: Partial<Pick<AdminUser, 'email' | 'name' | 'role' | 'zone' | 'is_active'>>): Promise<{ success: boolean; admin?: AdminUser; message?: string }> {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function deleteAdmin(id: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function getPendingPhotos(page = 1, pageSize = 20): Promise<{ success: boolean; data?: AdminPhoto[]; pagination?: { page: number; pageSize: number; total: number } }> {
  const response = await fetch(`${API_BASE}/photos/pending?page=${page}&pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function approvePhoto(id: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/photos/${id}/approve`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function rejectPhoto(id: string, reason?: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/photos/${id}/reject`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return response.json();
}

export async function getPhotoStats(): Promise<{ success: boolean; data?: AuditStats }> {
  const response = await fetch(`${API_BASE}/photos/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function getUsers(page = 1, pageSize = 20, keyword = ''): Promise<{ success: boolean; data?: User[]; pagination?: { page: number; pageSize: number; total: number } }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (keyword) params.set('keyword', keyword);
  const response = await fetch(`${API_BASE}/users/list?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function toggleUser(id: string): Promise<{ success: boolean; message?: string; data?: { is_active: number } }> {
  const response = await fetch(`${API_BASE}/users/${id}/toggle`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function getLogs(page = 1, pageSize = 50): Promise<{ success: boolean; data?: AdminLog[]; pagination?: { page: number; pageSize: number; total: number } }> {
  const response = await fetch(`${API_BASE}/logs?page=${page}&pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

export async function getStats(): Promise<{ success: boolean; data?: SystemStats }> {
  const response = await fetch(`${API_BASE}/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}