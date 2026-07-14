import { request } from './client';
import type { ApiResponse } from './client';
import { deduplicatedRequest } from './requestManager';

export interface CustomField {
  value: string;
  isPrivate: boolean;
}

export interface User {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  custom_fields: Record<string, CustomField> | null;
  created_at?: string;
}

export interface LoginData {
  user: User;
  token: string;
export interface LoginResponse {
  success: boolean;
  message?: string;
  data?: {
    user: User;
    token: string;
    session_token?: string;
  };
}

export interface RegisterResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string;
    email: string;
    username: string | null;
  };
}

export interface RegisterData {
  id: string;
  email: string;
  username: string | null;
}

export interface UploadAvatarData {
  id: string;
  avatar_url: string;
export async function login(email: string, password: string, remember?: boolean): Promise<LoginResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, remember }),
  });
  return response.json();
}

export interface RefreshResponse {
  success: boolean;
  message?: string;
  data?: {
    user: User;
    token: string;
  };
}

export async function refresh(sessionToken: string): Promise<RefreshResponse> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_token: sessionToken }),
  });
  return response.json();
}

export async function login(email: string, password: string): Promise<ApiResponse<LoginData>> {
  const key = `login:${email}`;
  return deduplicatedRequest(key, () =>
    request<LoginData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  );
}

export async function register(email: string, password: string, username?: string): Promise<ApiResponse<RegisterData>> {
  const key = `register:${email}`;
  return deduplicatedRequest(key, () =>
    request<RegisterData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username }),
    })
  );
}

export async function getCurrentUser(): Promise<ApiResponse<User>> {
  return request<User>('/auth/me');
}

export async function updateUser(data: Partial<User>): Promise<ApiResponse<User>> {
  return request<User>('/auth/me', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<ApiResponse<{ message?: string }>> {
  return request<{ message?: string }>('/auth/me/password', {
    method: 'PUT',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

export async function uploadAvatar(file: File): Promise<ApiResponse<UploadAvatarData>> {
  const formData = new FormData();
  formData.append('avatar', file);

  return request<UploadAvatarData>('/auth/me/avatar', {
    method: 'POST',
    body: formData,
  });
}