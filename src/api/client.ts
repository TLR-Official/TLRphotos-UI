/**
 * @file API 请求客户端
 * @description
 *  全局统一的 HTTP 请求封装，基于原生 fetch 实现。
 *  核心功能：
 *   1. 自动注入 JWT 认证头（Bearer Token，从 localStorage 读取）。
 *   2. 请求超时控制（默认 10s，基于 AbortController）。
 *   3. 失败重试机制（仅幂等方法默认重试 3 次，5xx 或网络错误触发）。
 *   4. 401 未授权自动清除 Token 并跳转登录页。
 *   5. 统一返回 ApiResponse 结构，避免上层处理异常分支。
 */

// API 基础地址：优先使用环境变量注入，回退到同源 /api 路径
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * 统一响应结构
 * @template T - data 字段的数据类型
 */
interface ApiResponse<T = unknown> {
  success: boolean;   // 业务是否成功
  data?: T;           // 业务数据
  message?: string;   // 提示信息（失败时必填）
  code?: string;      // 业务错误码（如 HUMAN_VERIFICATION_REQUIRED，供前端验证门识别）
}

// 错误类型枚举常量集合
const ErrorType = {
  NETWORK_ERROR: 'NETWORK_ERROR',       // 网络错误
  AUTH_ERROR: 'AUTH_ERROR',             // 认证失败
  SERVER_ERROR: 'SERVER_ERROR',         // 服务器错误
  VALIDATION_ERROR: 'VALIDATION_ERROR', // 参数校验错误
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',       // 请求超时
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',       // 未知错误
} as const;

type ErrorType = typeof ErrorType[keyof typeof ErrorType];

/**
 * 请求配置，扩展原生 RequestInit
 */
interface RequestOptions extends RequestInit {
  retryCount?: number; // 自定义重试次数（覆盖默认策略）
  timeout?: number;    // 超时时间（毫秒），默认 10000
}

/**
 * 核心请求方法
 * @description 封装 fetch，提供超时、重试、认证、错误归一化能力
 * @template T - 期望的响应数据类型
 * @param url - 相对 API_BASE_URL 的路径，例如 '/photos'
 * @param options - 请求配置（含重试、超时及原生 fetch 选项）
 * @returns 统一响应结构 ApiResponse<T>，永不抛错
 */
async function request<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { retryCount: customRetryCount, timeout = 10000, ...fetchOptions } = options;

  // 幂等方法才默认重试，避免 POST/PUT 等产生副作用重复提交
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isIdempotent = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const retryCount = customRetryCount !== undefined ? customRetryCount : (isIdempotent ? 3 : 0);

  try {
    // 超时控制：超时后通过 abort 中断 fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};

    // 非 FormData 请求统一 JSON Content-Type；FormData 由浏览器自动设置 boundary
    if (!(fetchOptions.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    // 合并调用方传入的 headers，过滤 null 值
    if (fetchOptions.headers) {
      if (typeof fetchOptions.headers === 'object' && !Array.isArray(fetchOptions.headers)) {
        for (const [key, value] of Object.entries(fetchOptions.headers)) {
          if (value !== null) {
            headers[key] = String(value);
          }
        }
      }
    }

    // 注入认证头
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    // 请求完成，清除超时定时器
    clearTimeout(timeoutId);

    // 401 未授权：清除本地 Token 并跳转登录页（避免在登录页重复跳转）
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

    // 非 2xx 响应处理
    if (!response.ok) {
      // 5xx 服务端错误且仍有重试次数：延迟 1s 后重试
      if (response.status >= 500 && retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return request(url, { ...options, retryCount: retryCount - 1 });
      }

      // 尝试解析响应体提取后端错误信息
      try {
        const text = await response.text();
        if (text) {
          try {
            const errorData = JSON.parse(text);
            return {
              success: false,
              code: errorData.code,
              message: errorData.message || `请求失败: ${response.status} ${response.statusText}`,
            };
          } catch {
            // 非 JSON 响应（如 Nginx 502/504 默认 HTML 页面）
            if (response.status >= 500) {
              return {
                success: false,
                message: `服务器暂时不可用（${response.status}），请稍后重试`,
              };
            }
          }
        }
      } catch {}

      // 空响应体或非 JSON：5xx 与其他错误给出不同提示
      if (response.status >= 500) {
        return {
          success: false,
          message: `服务器暂时不可用（${response.status}），请稍后重试`,
        };
      }
      return {
        success: false,
        message: `请求失败: ${response.status} ${response.statusText}`,
      };
    }

    // 成功响应：先读取文本再 JSON.parse，兼容空响应体场景
    try {
      const text = await response.text();
      if (!text) {
        // 走到这里说明 response.ok=true（2xx）但响应体为空
        return {
          success: false,
          message: '服务器未返回数据，请稍后重试',
        };
      }
      return JSON.parse(text);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return {
        success: false,
        message: '响应格式错误',
      };
    }
  } catch (error) {
    // 超时中断：AbortError 单独处理，不进入重试
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        message: '请求超时，请检查网络连接',
      };
    }

    // 其他网络错误：仍有重试次数则延迟 1s 后重试
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