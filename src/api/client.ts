const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

const ErrorType = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

type ErrorType = typeof ErrorType[keyof typeof ErrorType];

interface RequestOptions extends RequestInit {
  retryCount?: number;
  timeout?: number;
}

async function request<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { retryCount: customRetryCount, timeout = 10000, ...fetchOptions } = options;
  
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isIdempotent = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const retryCount = customRetryCount !== undefined ? customRetryCount : (isIdempotent ? 3 : 0);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};

    if (!(fetchOptions.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (fetchOptions.headers) {
      if (typeof fetchOptions.headers === 'object' && !Array.isArray(fetchOptions.headers)) {
        for (const [key, value] of Object.entries(fetchOptions.headers)) {
          if (value !== null) {
            headers[key] = String(value);
          }
        }
      }
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/auth') {
        window.location.href = '/auth';
      }
      return {
        success: false,
        message: '登录已过期，请重新登录',
      };
    }

    if (!response.ok) {
      if (response.status >= 500 && retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return request(url, { ...options, retryCount: retryCount - 1 });
      }

      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        message: '请求超时，请检查网络连接',
      };
    }

    if (retryCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return request(url, { ...options, retryCount: retryCount - 1 });
    }

    console.error('API request error:', error);
    return {
      success: false,
      message: '网络请求失败，请稍后重试',
    };
  }
}

export { request, API_BASE_URL, ErrorType };
export type { ApiResponse, RequestOptions };