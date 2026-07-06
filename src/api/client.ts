const API_BASE_URL = '/api';
const REQUEST_TIMEOUT = 3000;
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true' || !import.meta.env.PROD;

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

async function request<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  if (USE_MOCK_DATA) {
    return {
      success: false,
      message: '使用 Mock 数据',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('API request timeout:', url);
    } else {
      console.error('API request error:', error);
    }
    return {
      success: false,
      message: '网络请求失败，请稍后重试',
    };
  }
}

export { request, API_BASE_URL };
export type { ApiResponse };
