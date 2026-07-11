export interface User {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  created_at?: string;
}

export interface LoginResponse {
  success: boolean;
  message?: string;
  data?: {
    user: User;
    token: string;
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

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
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