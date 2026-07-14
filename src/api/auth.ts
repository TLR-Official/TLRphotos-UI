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

export interface GetCurrentUserResponse {
  success: boolean;
  message?: string;
  data?: User;
}

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

export async function register(email: string, password: string, username?: string): Promise<RegisterResponse> {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, username }),
  });
  return response.json();
}

export async function getCurrentUser(): Promise<GetCurrentUserResponse> {
  const token = localStorage.getItem('token');
  if (!token) {
    return { success: false, message: '未登录' };
  }

  const response = await fetch('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.json();
}

export interface UpdateUserResponse {
  success: boolean;
  message?: string;
  data?: User;
}

export async function updateUser(data: Partial<User>): Promise<UpdateUserResponse> {
  const token = localStorage.getItem('token');
  if (!token) {
    return { success: false, message: '未登录' };
  }

  const response = await fetch('/api/auth/me', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  return response.json();
}

export interface ChangePasswordResponse {
  success: boolean;
  message?: string;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResponse> {
  const token = localStorage.getItem('token');
  if (!token) {
    return { success: false, message: '未登录' };
  }

  const response = await fetch('/api/auth/me/password', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  return response.json();
}

export interface UploadAvatarResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string;
    avatar_url: string;
  };
}

export async function uploadAvatar(file: File): Promise<UploadAvatarResponse> {
  const token = localStorage.getItem('token');
  if (!token) {
    return { success: false, message: '未登录' };
  }

  const formData = new FormData();
  formData.append('avatar', file);

  const response = await fetch('/api/auth/me/avatar', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  return response.json();
}