const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

async function request<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }

    return response.json();
  } catch (error) {
    console.error('API request error:', error);
    return {
      success: false,
      message: '网络请求失败，请稍后重试',
    };
  }
}

export { request, API_BASE_URL };
export type { ApiResponse };
