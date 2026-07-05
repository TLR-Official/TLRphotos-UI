const API_BASE_URL = '/api';
const TIMEOUT_MS = 5000;

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

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

    try {
      return await response.json();
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return {
        success: false,
        message: '响应数据格式错误',
      };
    }
  } catch (error) {
    console.error('API request error:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        message: '请求超时，请稍后重试',
      };
    }
    return {
      success: false,
      message: '网络请求失败，请稍后重试',
    };
  }
}

export { request, API_BASE_URL };
export type { ApiResponse };
